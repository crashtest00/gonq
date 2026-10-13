//! One live session plus one SFTP channel per [`ConnKey`], shared by every caller.
//!
//! Sessions open on demand. A keepalive goes out every 30 s (set in `auth::connect`), so a dead
//! link is noticed before the user saves. A session idle for 15 minutes is closed. A lost session
//! is reopened once per command, silently: only when the agent or an unencrypted key works,
//! otherwise the caller gets the prompt the connection needs ([`ConnectResult`]).

use super::auth::{self, Answers, ConnectResult, Env, Progress, Session};
use super::config::SshConfigFile;
use super::uri::{ConnKey, Target, UriError};
use russh::Disconnect;
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::StatusCode;
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

pub const IDLE_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// A wrong-password count is forgotten after this long, so a fresh Connect starts at 3 attempts.
const FAILURE_MEMORY: Duration = Duration::from_secs(120);

/// An authenticated session with its SFTP channel, shared through the pool.
pub struct Conn {
    pub key: ConnKey,
    session: Session,
    last_used: Mutex<Instant>,
    in_flight: AtomicUsize,
}

impl Conn {
    pub fn sftp(&self) -> &SftpSession {
        &self.session.sftp
    }

    /// The SFTP realpath of `.` when the session was opened.
    pub fn home(&self) -> &str {
        &self.session.home
    }

    /// The second SFTP channel, with the extensions the server announced.
    pub fn ext(&self) -> Option<&super::auth::SftpExt> {
        self.session.ext.as_ref()
    }

    pub fn is_alive(&self) -> bool {
        !self.session.handle.is_closed()
    }

    fn touch(&self) {
        *self.last_used.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
    }

    fn idle_for(&self) -> Duration {
        self.last_used.lock().unwrap_or_else(|e| e.into_inner()).elapsed()
    }

    async fn close(&self) {
        let _ = self.session.sftp.close().await;
        let _ = self.session.handle.disconnect(Disconnect::ByApplication, "", "en").await;
    }
}

/// Counts a command as using the connection, so the idle reaper leaves it alone.
struct InUse(Arc<Conn>);

impl InUse {
    fn new(conn: Arc<Conn>) -> Self {
        conn.in_flight.fetch_add(1, Ordering::SeqCst);
        InUse(conn)
    }
}

impl Drop for InUse {
    fn drop(&mut self) {
        self.0.touch();
        self.0.in_flight.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(Debug)]
pub enum PoolError<E> {
    /// The session could not be (re)opened without asking the user; this is what it needs.
    Connect(ConnectResult),
    /// The command itself failed on a healthy session.
    Op(E),
}

type Slot = Arc<tokio::sync::Mutex<Option<Arc<Conn>>>>;

struct Inner {
    env: Env,
    idle_timeout: Duration,
    slots: Mutex<HashMap<ConnKey, Slot>>,
    progress: Mutex<HashMap<ConnKey, (Progress, Instant)>>,
    reaper_started: AtomicBool,
}

/// Held in Tauri state.
#[derive(Clone)]
pub struct Pool {
    inner: Arc<Inner>,
}

impl Pool {
    pub fn new(env: Env) -> Pool {
        Pool::with_idle_timeout(env, IDLE_TIMEOUT)
    }

    pub fn with_idle_timeout(env: Env, idle_timeout: Duration) -> Pool {
        Pool {
            inner: Arc::new(Inner {
                env,
                idle_timeout,
                slots: Mutex::new(HashMap::new()),
                progress: Mutex::new(HashMap::new()),
                reaper_started: AtomicBool::new(false),
            }),
        }
    }

    pub fn env(&self) -> &Env {
        &self.inner.env
    }

    /// `ssh_connect`: opens (or reuses) the session for `target`, or says what is needed to go on.
    pub async fn connect(&self, target: &str, answers: Answers) -> ConnectResult {
        let target = match Target::parse(target) {
            Ok(t) => t,
            Err(e) => return ConnectResult::Unreachable { reason: e.to_string() },
        };
        let key = self.key_of(&target);
        self.open(&key, answers).await
    }

    /// The connection a typed target (`user@host`, an alias, an `ssh://` address) names.
    pub fn key_for(&self, target: &str) -> Result<ConnKey, UriError> {
        Ok(self.key_of(&Target::parse(target)?))
    }

    fn key_of(&self, target: &Target) -> ConnKey {
        let resolved = SshConfigFile::load(&self.inner.env.config_path).resolve(target);
        ConnKey::new(&resolved.user, &resolved.alias, resolved.port)
    }

    async fn open(&self, key: &ConnKey, answers: Answers) -> ConnectResult {
        self.start_reaper();
        let slot = self.slot(key);
        let mut held = slot.lock().await;
        if let Some(conn) = held.as_ref().filter(|c| c.is_alive()) {
            conn.touch();
            return connected(conn);
        }
        *held = None;

        let target = SshConfigFile::load(&self.inner.env.config_path).resolve(&Target {
            user: Some(key.user.clone()),
            host: key.host.clone(),
            port: Some(key.port),
        });
        let mut progress = self.progress(key);
        match auth::connect(&self.inner.env, &target, &answers, &mut progress).await {
            Ok(session) => {
                self.set_progress(key, Progress::default());
                let conn = Arc::new(Conn {
                    key: key.clone(),
                    session,
                    last_used: Mutex::new(Instant::now()),
                    in_flight: AtomicUsize::new(0),
                });
                let result = connected(&conn);
                *held = Some(conn);
                result
            }
            Err(result) => {
                // The count carries over while the user is still being asked; any other end starts over.
                let carry = matches!(result, ConnectResult::NeedsPassword { .. } | ConnectResult::NeedsPassphrase { .. });
                self.set_progress(key, if carry { progress } else { Progress::default() });
                result
            }
        }
    }

    /// A live connection for `key`, reopened silently if it was lost. `Err` carries the prompt
    /// the user would have to answer.
    pub async fn acquire(&self, key: &ConnKey) -> Result<Arc<Conn>, ConnectResult> {
        let slot = self.slot(key);
        {
            let held = slot.lock().await;
            if let Some(conn) = held.as_ref().filter(|c| c.is_alive()) {
                conn.touch();
                return Ok(conn.clone());
            }
        }
        match self.open(key, Answers::default()).await {
            ConnectResult::Connected { .. } => {
                let held = slot.lock().await;
                held.clone().ok_or_else(|| ConnectResult::Unreachable { reason: "connection closed".into() })
            }
            other => Err(other),
        }
    }

    /// Runs one SFTP command on the shared session. If the session turns out to be lost, it is
    /// reopened once and the command is run again; a second loss is returned as the error.
    pub async fn with_sftp<T, F, Fut>(&self, key: &ConnKey, op: F) -> Result<T, PoolError<SftpError>>
    where
        F: Fn(Arc<Conn>) -> Fut,
        Fut: Future<Output = Result<T, SftpError>>,
    {
        let mut reopened = false;
        loop {
            let conn = self.acquire(key).await.map_err(PoolError::Connect)?;
            let guard = InUse::new(conn.clone());
            let outcome = op(conn.clone()).await;
            drop(guard);
            match outcome {
                Ok(v) => return Ok(v),
                Err(e) if connection_lost(&e) || !conn.is_alive() => {
                    self.forget(key, &conn).await;
                    if reopened {
                        return Err(PoolError::Op(e));
                    }
                    reopened = true;
                }
                Err(e) => return Err(PoolError::Op(e)),
            }
        }
    }

    /// `ssh_disconnect`: closes the session for `key`, if any.
    pub async fn disconnect(&self, key: &ConnKey) {
        let slot = self.slot(key);
        let conn = slot.lock().await.take();
        if let Some(conn) = conn {
            conn.close().await;
        }
    }

    /// Hosts with an open session.
    pub async fn open_keys(&self) -> Vec<ConnKey> {
        let slots: Vec<(ConnKey, Slot)> =
            self.inner.slots.lock().unwrap_or_else(|e| e.into_inner()).iter().map(|(k, s)| (k.clone(), s.clone())).collect();
        let mut keys = Vec::new();
        for (key, slot) in slots {
            if slot.lock().await.as_ref().is_some_and(|c| c.is_alive()) {
                keys.push(key);
            }
        }
        keys
    }

    async fn forget(&self, key: &ConnKey, dead: &Arc<Conn>) {
        let slot = self.slot(key);
        let mut held = slot.lock().await;
        if held.as_ref().is_some_and(|c| Arc::ptr_eq(c, dead)) {
            *held = None;
        }
        drop(held);
        dead.close().await;
    }

    fn slot(&self, key: &ConnKey) -> Slot {
        self.inner.slots.lock().unwrap_or_else(|e| e.into_inner()).entry(key.clone()).or_default().clone()
    }

    fn progress(&self, key: &ConnKey) -> Progress {
        let mut map = self.inner.progress.lock().unwrap_or_else(|e| e.into_inner());
        match map.get(key) {
            Some((p, at)) if at.elapsed() < FAILURE_MEMORY => p.clone(),
            Some(_) => {
                map.remove(key);
                Progress::default()
            }
            None => Progress::default(),
        }
    }

    fn set_progress(&self, key: &ConnKey, progress: Progress) {
        let mut map = self.inner.progress.lock().unwrap_or_else(|e| e.into_inner());
        if progress == Progress::default() {
            map.remove(key);
        } else {
            map.insert(key.clone(), (progress, Instant::now()));
        }
    }

    /// Closes idle sessions in the background. Started with the first connection, because it
    /// needs the async runtime.
    fn start_reaper(&self) {
        if self.inner.reaper_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let weak: Weak<Inner> = Arc::downgrade(&self.inner);
        let tick = (self.inner.idle_timeout / 4).clamp(Duration::from_millis(10), Duration::from_secs(60));
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tick).await;
                let Some(inner) = weak.upgrade() else { return };
                let slots: Vec<Slot> = inner.slots.lock().unwrap_or_else(|e| e.into_inner()).values().cloned().collect();
                for slot in slots {
                    let Ok(mut held) = slot.try_lock() else { continue };
                    let idle = held
                        .as_ref()
                        .is_some_and(|c| c.in_flight.load(Ordering::SeqCst) == 0 && c.idle_for() >= inner.idle_timeout);
                    if idle {
                        if let Some(conn) = held.take() {
                            conn.close().await;
                        }
                    }
                }
            }
        });
    }
}

fn connected(conn: &Conn) -> ConnectResult {
    ConnectResult::Connected { home: conn.home().to_string(), authority: conn.key.authority() }
}

/// An SFTP error that means the session is gone rather than that the command was refused.
pub(super) fn connection_lost(e: &SftpError) -> bool {
    match e {
        SftpError::Status(s) => matches!(s.status_code, StatusCode::NoConnection | StatusCode::ConnectionLost),
        _ => true,
    }
}
