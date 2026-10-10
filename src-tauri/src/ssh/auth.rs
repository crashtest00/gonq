//! Opening one authenticated SFTP session.
//!
//! [`connect`] either returns a [`Session`] or the one thing it needs to go on ([`ConnectResult`]):
//! the UI asks the user, then calls again with the answer in [`Answers`]. Order: host key check
//! against `known_hosts`, then ssh-agent, then key files, then a password if the server offers it.
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
/// How long one agent signature may take (a confirmation prompt, a touch on a hardware key).
pub const AGENT_TIMEOUT: Duration = Duration::from_secs(60);
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
    pub agent_timeout: Duration,
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

/// Connects and authenticates. `password_failures` is how many wrong passwords the user has
/// already given this host; it is updated, and the caller keeps it between calls.
pub async fn connect(
    env: &Env,
    target: &Resolved,
    answers: &Answers,
    password_failures: &mut u8,
) -> Result<Session, ConnectResult> {
    match connect_once(env, target, answers, password_failures, false).await {
        Ok(session) => Ok(session),
        Err(Stop::Result(r)) => Err(r),
        // Drop the stuck session and start again on a fresh one, leaving the agent out.
        Err(Stop::AgentStalled) => match connect_once(env, target, answers, password_failures, true).await {
            Ok(session) => Ok(session),
            Err(Stop::Result(r)) => Err(r),
            Err(Stop::AgentStalled) => Err(unreachable("ssh-agent did not answer")),
        },
    }
}

async fn connect_once(
    env: &Env,
    target: &Resolved,
    answers: &Answers,
    password_failures: &mut u8,
    skip_agent: bool,
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

    authenticate(&mut handle, env, target, answers, password_failures, skip_agent).await?;

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

/// Order: agent, key files that open without a question, the password, and only then encrypted
/// keys that need a passphrase. Every step that waits on the server is bounded.
async fn authenticate(
    handle: &mut Handle<HostKeyHandler>,
    env: &Env,
    target: &Resolved,
    answers: &Answers,
    password_failures: &mut u8,
    skip_agent: bool,
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

    // Encrypted keys nobody has unlocked yet; asked about only when nothing else is left.
    let mut locked: Vec<PathBuf> = Vec::new();
    if offers(&offered, MethodKind::PublicKey) {
        let hash = rsa_hash(handle, env).await;
        if !skip_agent {
            match try_agent(handle, env, target, hash).await? {
                AgentOutcome::Authenticated => return Ok(()),
                AgentOutcome::Rejected => tried.push("ssh-agent".into()),
                AgentOutcome::Unavailable => {}
            }
            if handle.is_closed() {
                return Err(disconnected(&tried));
            }
        }
        if try_key_files(handle, env, target, answers, hash, &mut tried, &mut locked).await? {
            return Ok(());
        }
        if handle.is_closed() {
            return Err(disconnected(&tried));
        }
    }

    // A server that offers only public keys is never asked for a password.
    if offers(&offered, MethodKind::Password) {
        if *password_failures >= MAX_PASSWORD_ATTEMPTS {
            // The attempts were used up on an earlier call, which went on to ask for a passphrase.
            tried.push("password".into());
        } else {
            match try_password(handle, env, user, answers, password_failures, &mut tried).await? {
                PasswordOutcome::Connected => return Ok(()),
                PasswordOutcome::Ask { attempts_left } => return Err(ConnectResult::NeedsPassword { attempts_left }.into()),
                PasswordOutcome::Exhausted => {}
            }
        }
    }
    if let Some(path) = locked.first() {
        return Err(ConnectResult::NeedsPassphrase { key_path: display_path(path) }.into());
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
    /// The agent answered but none of its keys was accepted.
    Rejected,
    /// No agent to talk to (not running, no socket set, no keys): not worth mentioning.
    Unavailable,
}

async fn try_agent(
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
    for key in keys {
        let hash = if key.algorithm().is_rsa() { hash } else { None };
        // An agent that does not sign (a confirmation, a touch) is waited for, but not forever.
        // The signature must never be abandoned on a session we keep using: its task would stop
        // reading the socket until the signature arrives.
        let signed = tokio::time::timeout(env.agent_timeout, handle.authenticate_publickey_with(user, key, hash, &mut agent)).await;
        match signed {
            Err(_) => return Err(Stop::AgentStalled),
            Ok(Ok(result)) if result.success() => return Ok(AgentOutcome::Authenticated),
            Ok(Ok(_)) => {}
            // The agent went away or refused to sign (or the server hung up): move on.
            Ok(Err(_)) => return Ok(if handle.is_closed() { AgentOutcome::Rejected } else { AgentOutcome::Unavailable }),
        }
    }
    Ok(AgentOutcome::Rejected)
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

/// Ok(true) when a key file was accepted. Encrypted keys that were not opened (no passphrase
/// given, none skipped) are added to `locked`; the one error is `NeedsPassphrase` for a
/// passphrase that was given and opened nothing.
async fn try_key_files(
    handle: &mut Handle<HostKeyHandler>,
    env: &Env,
    target: &Resolved,
    answers: &Answers,
    hash: Option<HashAlg>,
    tried: &mut Vec<String>,
    locked: &mut Vec<PathBuf>,
) -> Result<bool, Stop> {
    let passphrase = answers.passphrase.as_ref();
    // Encrypted keys the supplied passphrase did not open, and whether it opened any.
    let mut not_opened: Vec<PathBuf> = Vec::new();
    let mut passphrase_worked = false;

    for path in key_candidates(env, target) {
        let key = match load_key(&path, None) {
            Ok(key) => key,
            Err(KeyError::Encrypted) => {
                if answers.skip_passphrase.iter().any(|s| Path::new(s) == path) {
                    continue;
                }
                match &passphrase {
                    None => {
                        locked.push(path);
                        continue;
                    }
                    Some(pass) => match load_key(&path, Some(pass.as_str())) {
                        Ok(key) => {
                            passphrase_worked = true;
                            key
                        }
                        Err(_) => {
                            not_opened.push(path);
                            continue;
                        }
                    },
                }
            }
            // Unreadable or unsupported: leave it out.
            Err(KeyError::Other) => continue,
        };
        tried.push(format!("key {}", display_path(&path)));
        let offered = PrivateKeyWithHashAlg::new(Arc::new(key), hash);
        // `offered` (and the decrypted key in it) is moved into the request and dropped there.
        match bounded(env, handle.authenticate_publickey(target.user.as_str(), offered)).await? {
            Ok(result) if result.success() => return Ok(true),
            Ok(_) => {}
            // The server hung up on us.
            Err(_) => return Err(ConnectResult::AuthFailed { tried: tried.clone() }.into()),
        }
    }
    // A passphrase that opened nothing was wrong: ask again.
    if !passphrase_worked {
        if let Some(path) = not_opened.first() {
            return Err(ConnectResult::NeedsPassphrase { key_path: display_path(path) }.into());
        }
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
