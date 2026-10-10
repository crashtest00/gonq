//! Opening one authenticated SFTP session.
//!
//! [`connect`] either returns a [`Session`] or the one thing it needs to go on ([`ConnectResult`]):
//! the UI asks the user, then calls again with the answer in [`Answers`]. Order: host key check
//! against `known_hosts`, then ssh-agent, then key files that need no passphrase, then encrypted key
//! files (skippable), then a password if the server offers it.
//! Secrets are held in zeroising buffers and a decrypted key is dropped as soon as it has been
//! offered; nothing caches it.

use super::config::Resolved;
use super::known_hosts::{self, HostKeyStatus};
use russh::client::{self, Handle};
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::agent::AgentIdentity;
use russh::keys::{load_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate};
use russh::{MethodKind, MethodSet};
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use zeroize::Zeroizing;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// How long the whole agent phase may take, all keys together (a confirmation prompt, a touch on
/// a hardware key).
pub const AGENT_TIMEOUT: Duration = Duration::from_secs(30);
/// How long one `ssh_connect` call may take in all, not counting the time the user spends answering.
pub const OVERALL_TIMEOUT: Duration = Duration::from_secs(60);
/// Agent keys offered per connection, so a full agent cannot use up the server's `MaxAuthTries`
/// before the key files and the password get their turn.
const MAX_AGENT_KEYS: usize = 3;
pub const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);
pub const MAX_PASSWORD_ATTEMPTS: u8 = 3;
const DEFAULT_KEY_NAMES: [&str; 3] = ["id_ed25519", "id_ecdsa", "id_rsa"];

/// Where the pieces of the user's SSH setup live. Real runs use [`Env::from_home`]; tests point
/// these at a temp dir.
#[derive(Debug, Clone)]
pub struct Env {
    pub config_path: PathBuf,
    pub known_hosts_path: PathBuf,
    /// Where `id_ed25519`, `id_ecdsa` and `id_rsa` are looked for when the config names no `IdentityFile`.
    pub ssh_dir: PathBuf,
    pub agent: AgentSource,
    /// Bounds the dial, key exchange, each server reply during sign-in and the SFTP channel open.
    pub connect_timeout: Duration,
    /// Bounds the agent phase as a whole.
    pub agent_timeout: Duration,
    /// Bounds one call of [`connect`] from the dial to the open SFTP channel.
    pub overall_timeout: Duration,
    pub keepalive_interval: Duration,
}

#[derive(Debug, Clone)]
pub enum AgentSource {
    /// `SSH_AUTH_SOCK` on Linux and macOS; the OpenSSH named pipe, then Pageant, on Windows.
    System,
    /// An agent listening on this Unix socket.
    #[cfg(unix)]
    Socket(PathBuf),
    None,
}

impl Env {
    pub fn from_home() -> Env {
        let ssh_dir = dirs::home_dir().unwrap_or_default().join(".ssh");
        Env {
            config_path: ssh_dir.join("config"),
            known_hosts_path: ssh_dir.join("known_hosts"),
            ssh_dir,
            agent: AgentSource::System,
            connect_timeout: CONNECT_TIMEOUT,
            agent_timeout: AGENT_TIMEOUT,
            overall_timeout: OVERALL_TIMEOUT,
            keepalive_interval: KEEPALIVE_INTERVAL,
        }
    }
}

/// What the user has answered so far. The secrets are zeroised when dropped.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct Answers {
    /// The fingerprint the user confirmed for an unknown host.
    pub trust_fingerprint: Option<String>,
    pub passphrase: Option<Zeroizing<String>>,
    pub password: Option<Zeroizing<String>>,
    /// Encrypted key files the user chose not to unlock; they are left out so the flow moves on.
    pub skip_passphrase: Vec<String>,
}

/// The result of `ssh_connect`: connected, or the one thing needed to go on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectResult {
    /// `home` is the SFTP realpath of `.`; `authority` is the canonical `user@host[:port]`.
    Connected { home: String, authority: String },
    NeedsHostKey { key_type: String, fingerprint: String },
    HostKeyChanged { fingerprint: String, known_line: String },
    NeedsPassphrase { key_path: String },
    NeedsPassword { attempts_left: u8 },
    AuthFailed { tried: Vec<String> },
    Unreachable { reason: String },
}

/// A live, authenticated connection with its SFTP channel open.
pub struct Session {
    pub handle: Handle<HostKeyHandler>,
    pub sftp: SftpSession,
    pub home: String,
}

pub struct HostKeyHandler {
    known_hosts_path: PathBuf,
    host: String,
    port: u16,
    trust: Option<String>,
    verdict: Arc<Mutex<Option<ConnectResult>>>,
}

impl client::Handler for HostKeyHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let PublicKeyOrCertificate::PublicKey { key, .. } = key else {
            // Certificates are out of scope; never trust what cannot be checked.
            return Ok(false);
        };
        let fingerprint = known_hosts::fingerprint(key);
        let reject = |result: ConnectResult| {
            *self.verdict.lock().unwrap_or_else(|e| e.into_inner()) = Some(result);
            Ok(false)
        };
        match known_hosts::check(&self.known_hosts_path, &self.host, self.port, key) {
            HostKeyStatus::Known => Ok(true),
            HostKeyStatus::Changed { known_line, .. } => reject(ConnectResult::HostKeyChanged { fingerprint, known_line }),
            HostKeyStatus::Unknown if self.trust.as_deref() == Some(fingerprint.as_str()) => {
                match known_hosts::append(&self.known_hosts_path, &self.host, self.port, key) {
                    Ok(()) => Ok(true),
                    Err(e) => reject(ConnectResult::Unreachable {
                        reason: format!("could not record the host key in known_hosts: {e}"),
                    }),
                }
            }
            HostKeyStatus::Unknown => {
                reject(ConnectResult::NeedsHostKey { key_type: known_hosts::key_type(key), fingerprint })
            }
        }
    }
}

fn unreachable(reason: impl ToString) -> ConnectResult {
    ConnectResult::Unreachable { reason: reason.to_string() }
}

/// Why a connection attempt stopped.
enum Stop {
    Result(ConnectResult),
    /// An agent signature did not arrive in time. The session cannot be used any more (its task
    /// is still waiting for that signature), so the attempt restarts without the agent.
    AgentStalled,
}

impl From<ConnectResult> for Stop {
    fn from(r: ConnectResult) -> Self {
        Stop::Result(r)
    }
}

/// Runs one step that waits on the server; a stall is `Unreachable`.
async fn bounded<T>(env: &Env, step: impl std::future::Future<Output = T>) -> Result<T, ConnectResult> {
    tokio::time::timeout(env.connect_timeout, step)
        .await
        .map_err(|_| unreachable(format!("the server stopped answering (no reply within {} s)", env.connect_timeout.as_secs())))
}

/// Whether the agent is used on this attempt.
#[derive(Clone, Copy, PartialEq, Eq)]
enum AgentMode {
    Use,
    /// It stalled on the first attempt: leave it out, but say so in `tried`.
    TimedOut,
}

/// Connects and authenticates. `password_failures` is how many wrong passwords the user has
/// already given this host; it is updated, and the caller keeps it between calls. The whole call
/// is bounded by `overall_timeout`.
pub async fn connect(
    env: &Env,
    target: &Resolved,
    answers: &Answers,
    password_failures: &mut u8,
) -> Result<Session, ConnectResult> {
    let attempt = async {
        match connect_once(env, target, answers, password_failures, AgentMode::Use).await {
            Ok(session) => Ok(session),
            Err(Stop::Result(r)) => Err(r),
            // Drop the stuck session and start again on a fresh one, leaving the agent out.
            Err(Stop::AgentStalled) => match connect_once(env, target, answers, password_failures, AgentMode::TimedOut).await {
                Ok(session) => Ok(session),
                Err(Stop::Result(r)) => Err(r),
                Err(Stop::AgentStalled) => Err(unreachable("ssh-agent did not answer")),
            },
        }
    };
    match tokio::time::timeout(env.overall_timeout, attempt).await {
        Ok(result) => result,
        Err(_) => Err(unreachable(format!("connecting took longer than {} s", env.overall_timeout.as_secs()))),
    }
}

async fn connect_once(
    env: &Env,
    target: &Resolved,
    answers: &Answers,
    password_failures: &mut u8,
    agent: AgentMode,
) -> Result<Session, Stop> {
    let verdict = Arc::new(Mutex::new(None));
    let handler = HostKeyHandler {
        known_hosts_path: env.known_hosts_path.clone(),
        host: target.hostname.clone(),
        port: target.port,
        trust: answers.trust_fingerprint.clone(),
        verdict: verdict.clone(),
    };
    let config = Arc::new(client::Config {
        keepalive_interval: Some(env.keepalive_interval),
        keepalive_max: 3,
        nodelay: true,
        ..Default::default()
    });
    let addr = (target.hostname.clone(), target.port);
    let dialed = tokio::time::timeout(env.connect_timeout, client::connect(config, addr, handler)).await;
    let mut handle = match dialed {
        Err(_) => return Err(unreachable(format!("no answer within {} s", env.connect_timeout.as_secs())).into()),
        Ok(Err(e)) => {
            let said = verdict.lock().unwrap_or_else(|e| e.into_inner()).take();
            return Err(said.unwrap_or_else(|| unreachable(e)).into());
        }
        Ok(Ok(handle)) => handle,
    };

    authenticate(&mut handle, env, target, answers, password_failures, agent).await?;

    let opened = async {
        let channel = handle.channel_open_session().await.map_err(|e| e.to_string())?;
        channel.request_subsystem(true, "sftp").await.map_err(|e| e.to_string())?;
        let sftp = SftpSession::new(channel.into_stream()).await.map_err(|e| e.to_string())?;
        let home = sftp.canonicalize(".").await.map_err(|e| e.to_string())?;
        Ok::<_, String>((sftp, home))
    };
    match tokio::time::timeout(env.connect_timeout, opened).await {
        Ok(Ok((sftp, home))) => Ok(Session { handle, sftp, home }),
        Ok(Err(e)) => Err(unreachable(format!("the server did not open an SFTP channel: {e}")).into()),
        Err(_) => Err(unreachable("the server did not open an SFTP channel in time").into()),
    }
}

/// Order, like OpenSSH: agent keys, key files that open without a question, encrypted key files
/// (a passphrase is asked for, one key at a time, and can be skipped), then the password if the
/// server offers it. Every step that waits on the server is bounded.
async fn authenticate(
    handle: &mut Handle<HostKeyHandler>,
    env: &Env,
    target: &Resolved,
    answers: &Answers,
    password_failures: &mut u8,
    agent: AgentMode,
) -> Result<(), Stop> {
    let user = target.user.as_str();
    let mut tried: Vec<String> = Vec::new();
    // A server that drops us once sign-in is under way (MaxAuthTries) is a failed sign-in.
    let disconnected = |tried: &[String]| Stop::Result(ConnectResult::AuthFailed { tried: tried.to_vec() });

    // Asking for "none" is how the server tells us which methods it offers.
    let offered = match bounded(env, handle.authenticate_none(user)).await? {
        Ok(client::AuthResult::Success) => return Ok(()),
        Ok(client::AuthResult::Failure { remaining_methods, .. }) => remaining_methods,
        Err(e) => return Err(unreachable(e).into()),
    };

    if agent == AgentMode::TimedOut {
        tried.push("ssh-agent (timed out)".into());
    }
    if offers(&offered, MethodKind::PublicKey) {
        let hash = rsa_hash(handle, env).await;
        // The agent keys already offered; a key file holding the same key is not offered again.
        let mut from_agent: Vec<PublicKey> = Vec::new();
        if agent == AgentMode::Use {
            match try_agent(handle, env, target, hash).await? {
                AgentOutcome::Authenticated => return Ok(()),
                AgentOutcome::Rejected(keys) => {
                    tried.push("ssh-agent".into());
                    from_agent = keys;
                }
                AgentOutcome::Unavailable => {}
            }
            if handle.is_closed() {
                return Err(disconnected(&tried));
            }
        }
        let mut locked: Vec<PathBuf> = Vec::new();
        if try_plain_keys(handle, env, target, hash, &from_agent, &mut tried, &mut locked).await? {
            return Ok(());
        }
        if handle.is_closed() {
            return Err(disconnected(&tried));
        }
        if try_locked_keys(handle, env, target, answers, hash, &locked, &mut tried).await? {
            return Ok(());
        }
        if handle.is_closed() {
            return Err(disconnected(&tried));
        }
    }

    // A server that offers only public keys is never asked for a password.
    if offers(&offered, MethodKind::Password) {
        if *password_failures >= MAX_PASSWORD_ATTEMPTS {
            // The attempts were used up on an earlier call.
            tried.push("password".into());
        } else {
            match try_password(handle, env, user, answers, password_failures, &mut tried).await? {
                PasswordOutcome::Connected => return Ok(()),
                PasswordOutcome::Ask { attempts_left } => return Err(ConnectResult::NeedsPassword { attempts_left }.into()),
                PasswordOutcome::Exhausted => {}
            }
        }
    }
    Err(ConnectResult::AuthFailed { tried }.into())
}

fn offers(set: &MethodSet, kind: MethodKind) -> bool {
    set.contains(&kind)
}

/// The signature hash to use for RSA keys: the best one the server accepts.
async fn rsa_hash(handle: &Handle<HostKeyHandler>, env: &Env) -> Option<HashAlg> {
    match bounded(env, handle.best_supported_rsa_hash()).await {
        Ok(Ok(Some(hash))) => hash,
        _ => Some(HashAlg::Sha256),
    }
}

enum AgentOutcome {
    Authenticated,
    /// The agent answered but none of the keys offered (these) was accepted.
    Rejected(Vec<PublicKey>),
    /// No agent to talk to (not running, no socket set, no keys): not worth mentioning.
    Unavailable,
}

/// The whole agent phase, all keys together, is bounded by `agent_timeout`. If that runs out the
/// session is unusable (a signature was abandoned) and the caller starts over without the agent.
async fn try_agent(
    handle: &mut Handle<HostKeyHandler>,
    env: &Env,
    target: &Resolved,
    hash: Option<HashAlg>,
) -> Result<AgentOutcome, Stop> {
    match tokio::time::timeout(env.agent_timeout, try_agent_inner(handle, env, target, hash)).await {
        Ok(outcome) => outcome,
        Err(_) => Err(Stop::AgentStalled),
    }
}

async fn try_agent_inner(
    handle: &mut Handle<HostKeyHandler>,
    env: &Env,
    target: &Resolved,
    hash: Option<HashAlg>,
) -> Result<AgentOutcome, Stop> {
    let hints = identity_hints(env, target);
    let limit = env.connect_timeout;
    // Only reaching the agent is bounded by `connect_timeout`; a signature is not a server wait.
    match &env.agent {
        AgentSource::None => Ok(AgentOutcome::Unavailable),
        #[cfg(unix)]
        AgentSource::Socket(path) => match tokio::time::timeout(limit, AgentClient::connect_uds(path)).await {
            Ok(Ok(agent)) => offer_agent_keys(handle, env, &target.user, hash, &hints, agent).await,
            _ => Ok(AgentOutcome::Unavailable),
        },
        #[cfg(unix)]
        AgentSource::System => match tokio::time::timeout(limit, AgentClient::connect_env()).await {
            Ok(Ok(agent)) => offer_agent_keys(handle, env, &target.user, hash, &hints, agent).await,
            _ => Ok(AgentOutcome::Unavailable),
        },
        #[cfg(windows)]
        AgentSource::System => {
            const PIPE: &str = r"\\.\pipe\openssh-ssh-agent";
            if let Ok(Ok(agent)) = tokio::time::timeout(limit, AgentClient::connect_named_pipe(PIPE)).await {
                match offer_agent_keys(handle, env, &target.user, hash, &hints, agent).await? {
                    AgentOutcome::Unavailable => {}
                    done => return Ok(done),
                }
            }
            match tokio::time::timeout(limit, AgentClient::connect_pageant()).await {
                Ok(Ok(agent)) => offer_agent_keys(handle, env, &target.user, hash, &hints, agent).await,
                _ => Ok(AgentOutcome::Unavailable),
            }
        }
    }
}

/// The public halves of the keys the config (or the defaults) points at, read from `<key>.pub`.
fn identity_hints(env: &Env, target: &Resolved) -> Vec<PublicKey> {
    named_keys(env, target)
        .into_iter()
        .filter_map(|p| {
            let mut pub_path = p.into_os_string();
            pub_path.push(".pub");
            PublicKey::read_openssh_file(Path::new(&pub_path)).ok()
        })
        .collect()
}

async fn offer_agent_keys<S>(
    handle: &mut Handle<HostKeyHandler>,
    env: &Env,
    user: &str,
    hash: Option<HashAlg>,
    hints: &[PublicKey],
    mut agent: AgentClient<S>,
) -> Result<AgentOutcome, Stop>
where
    S: AgentStream + Unpin + Send + 'static,
{
    let Ok(Ok(identities)) = tokio::time::timeout(env.connect_timeout, agent.request_identities()).await else {
        return Ok(AgentOutcome::Unavailable);
    };
    let mut keys: Vec<_> = identities
        .into_iter()
        .filter_map(|id| match id {
            AgentIdentity::PublicKey { key, .. } => Some(key),
            _ => None,
        })
        .collect();
    if keys.is_empty() {
        return Ok(AgentOutcome::Unavailable);
    }
    // The keys the config names go first (stable, so the rest keep the agent's order).
    keys.sort_by_key(|k| !hints.iter().any(|h| h.key_data() == k.key_data()));
    keys.truncate(MAX_AGENT_KEYS);
    let mut offered = Vec::new();
    for key in keys {
        let hash = if key.algorithm().is_rsa() { hash } else { None };
        // No timeout of its own: abandoning a signature would leave the session's task waiting
        // for it. `try_agent` bounds the phase as a whole.
        let signed = handle.authenticate_publickey_with(user, key.clone(), hash, &mut agent).await;
        offered.push(key);
        match signed {
            Ok(result) if result.success() => return Ok(AgentOutcome::Authenticated),
            Ok(_) => {}
            // The agent went away or refused to sign (or the server hung up): move on.
            Err(_) => {
                return Ok(if handle.is_closed() { AgentOutcome::Rejected(offered) } else { AgentOutcome::Unavailable });
            }
        }
    }
    Ok(AgentOutcome::Rejected(offered))
}

/// The key files to look at, whether or not they exist.
fn named_keys(env: &Env, target: &Resolved) -> Vec<PathBuf> {
    if target.identity_files.is_empty() {
        DEFAULT_KEY_NAMES.iter().map(|n| env.ssh_dir.join(n)).collect()
    } else {
        target.identity_files.clone()
    }
}

fn key_candidates(env: &Env, target: &Resolved) -> Vec<PathBuf> {
    named_keys(env, target).into_iter().filter(|p| p.is_file()).collect()
}

fn same_key(a: &PublicKey, b: &PublicKey) -> bool {
    a.key_data() == b.key_data()
}

/// The `<key>.pub` next to a key file, if there is one.
fn public_half(path: &Path) -> Option<PublicKey> {
    let mut pub_path = path.to_path_buf().into_os_string();
    pub_path.push(".pub");
    PublicKey::read_openssh_file(Path::new(&pub_path)).ok()
}

/// Offers one decrypted key; Ok(true) when the server accepted it.
async fn offer_key(
    handle: &mut Handle<HostKeyHandler>,
    env: &Env,
    target: &Resolved,
    hash: Option<HashAlg>,
    key: russh::keys::PrivateKey,
    path: &Path,
    tried: &mut Vec<String>,
) -> Result<bool, Stop> {
    tried.push(format!("key {}", display_path(path)));
    let offered = PrivateKeyWithHashAlg::new(Arc::new(key), hash);
    // `offered` (and the decrypted key in it) is moved into the request and dropped there.
    match bounded(env, handle.authenticate_publickey(target.user.as_str(), offered)).await? {
        Ok(result) => Ok(result.success()),
        // The server hung up on us.
        Err(_) => Err(ConnectResult::AuthFailed { tried: tried.clone() }.into()),
    }
}

/// Ok(true) when a key file that needs no passphrase was accepted. Encrypted ones are added to
/// `locked`. A key the agent already offered is not offered a second time.
async fn try_plain_keys(
    handle: &mut Handle<HostKeyHandler>,
    env: &Env,
    target: &Resolved,
    hash: Option<HashAlg>,
    from_agent: &[PublicKey],
    tried: &mut Vec<String>,
    locked: &mut Vec<PathBuf>,
) -> Result<bool, Stop> {
    for path in key_candidates(env, target) {
        match load_key(&path, None) {
            Ok(key) => {
                if from_agent.iter().any(|a| same_key(a, key.public_key())) {
                    continue;
                }
                if offer_key(handle, env, target, hash, key, &path, tried).await? {
                    return Ok(true);
                }
            }
            Err(KeyError::Encrypted) => {
                if !public_half(&path).is_some_and(|p| from_agent.iter().any(|a| same_key(a, &p))) {
                    locked.push(path);
                }
            }
            // Unreadable or unsupported: leave it out.
            Err(KeyError::Other) => {}
        }
    }
    Ok(false)
}

/// Encrypted key files, after everything that needs no question. With no passphrase given, the
/// first one not skipped is asked for (`NeedsPassphrase`). A given passphrase is tried on each of
/// them; if it opens none, the first is asked for again. Ok(true) when a key was accepted.
async fn try_locked_keys(
    handle: &mut Handle<HostKeyHandler>,
    env: &Env,
    target: &Resolved,
    answers: &Answers,
    hash: Option<HashAlg>,
    locked: &[PathBuf],
    tried: &mut Vec<String>,
) -> Result<bool, Stop> {
    let pending: Vec<&PathBuf> =
        locked.iter().filter(|p| !answers.skip_passphrase.iter().any(|s| Path::new(s) == p.as_path())).collect();
    let Some(first) = pending.first() else { return Ok(false) };
    let Some(passphrase) = answers.passphrase.as_ref() else {
        return Err(ConnectResult::NeedsPassphrase { key_path: display_path(first) }.into());
    };
    let mut not_opened: Vec<&PathBuf> = Vec::new();
    for path in pending {
        match load_key(path, Some(passphrase.as_str())) {
            Ok(key) => {
                if offer_key(handle, env, target, hash, key, path, tried).await? {
                    return Ok(true);
                }
            }
            Err(_) => not_opened.push(path),
        }
    }
    // A passphrase that did not open a key was wrong for it: ask again.
    if let Some(path) = not_opened.first() {
        return Err(ConnectResult::NeedsPassphrase { key_path: display_path(path) }.into());
    }
    Ok(false)
}

fn display_path(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

enum KeyError {
    Encrypted,
    Other,
}

fn load_key(path: &Path, passphrase: Option<&str>) -> Result<russh::keys::PrivateKey, KeyError> {
    match load_secret_key(path, passphrase) {
        Ok(key) => Ok(key),
        Err(russh::keys::Error::KeyIsEncrypted) if passphrase.is_none() => Err(KeyError::Encrypted),
        Err(_) => Err(KeyError::Other),
    }
}

enum PasswordOutcome {
    Connected,
    /// No password yet, or the last one was wrong.
    Ask { attempts_left: u8 },
    /// The last attempt was wrong too.
    Exhausted,
}

async fn try_password(
    handle: &mut Handle<HostKeyHandler>,
    env: &Env,
    user: &str,
    answers: &Answers,
    failures: &mut u8,
    tried: &mut Vec<String>,
) -> Result<PasswordOutcome, Stop> {
    let Some(password) = answers.password.as_ref() else {
        return Ok(PasswordOutcome::Ask { attempts_left: MAX_PASSWORD_ATTEMPTS.saturating_sub(*failures) });
    };
    match bounded(env, handle.authenticate_password(user, password.as_str())).await? {
        Ok(result) if result.success() => Ok(PasswordOutcome::Connected),
        Ok(_) => {
            tried.push("password".into());
            *failures += 1;
            if *failures >= MAX_PASSWORD_ATTEMPTS {
                Ok(PasswordOutcome::Exhausted)
            } else {
                Ok(PasswordOutcome::Ask { attempts_left: MAX_PASSWORD_ATTEMPTS - *failures })
            }
        }
        Err(_) => Err(ConnectResult::AuthFailed { tried: tried.clone() }.into()),
    }
}
