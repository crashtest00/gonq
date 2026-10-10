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
use russh::keys::{load_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{MethodKind, MethodSet};
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use zeroize::Zeroizing;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
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
    pub connect_timeout: Duration,
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

/// Connects and authenticates. `password_failures` is how many wrong passwords the user has
/// already given this host (the caller keeps that count between calls).
pub async fn connect(
    env: &Env,
    target: &Resolved,
    answers: &Answers,
    password_failures: u8,
) -> Result<Session, ConnectResult> {
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
        Err(_) => return Err(unreachable(format!("no answer within {} s", env.connect_timeout.as_secs()))),
        Ok(Err(e)) => {
            let said = verdict.lock().unwrap_or_else(|e| e.into_inner()).take();
            return Err(said.unwrap_or_else(|| unreachable(e)));
        }
        Ok(Ok(handle)) => handle,
    };

    authenticate(&mut handle, env, target, answers, password_failures).await?;

    let opened = async {
        let channel = handle.channel_open_session().await.map_err(|e| e.to_string())?;
        channel.request_subsystem(true, "sftp").await.map_err(|e| e.to_string())?;
        let sftp = SftpSession::new(channel.into_stream()).await.map_err(|e| e.to_string())?;
        let home = sftp.canonicalize(".").await.map_err(|e| e.to_string())?;
        Ok::<_, String>((sftp, home))
    };
    match tokio::time::timeout(env.connect_timeout, opened).await {
        Ok(Ok((sftp, home))) => Ok(Session { handle, sftp, home }),
        Ok(Err(e)) => Err(unreachable(format!("the server did not open an SFTP channel: {e}"))),
        Err(_) => Err(unreachable("the server did not open an SFTP channel in time")),
    }
}

async fn authenticate(
    handle: &mut Handle<HostKeyHandler>,
    env: &Env,
    target: &Resolved,
    answers: &Answers,
    password_failures: u8,
) -> Result<(), ConnectResult> {
    let user = target.user.as_str();
    let mut tried: Vec<String> = Vec::new();

    // Asking for "none" is how the server tells us which methods it offers.
    let offered = match handle.authenticate_none(user).await {
        Ok(client::AuthResult::Success) => return Ok(()),
        Ok(client::AuthResult::Failure { remaining_methods, .. }) => remaining_methods,
        Err(e) => return Err(unreachable(e)),
    };

    if offers(&offered, MethodKind::PublicKey) {
        let hash = rsa_hash(handle).await;
        match try_agent(handle, env, user, hash).await {
            AgentOutcome::Authenticated => return Ok(()),
            AgentOutcome::Rejected => tried.push("ssh-agent".into()),
            AgentOutcome::Unavailable => {}
        }
        if try_key_files(handle, env, target, answers, hash, &mut tried).await? {
            return Ok(());
        }
    }

    // A server that offers only public keys is never asked for a password.
    if offers(&offered, MethodKind::Password) {
        return try_password(handle, user, answers, password_failures, &mut tried).await;
    }
    Err(ConnectResult::AuthFailed { tried })
}

fn offers(set: &MethodSet, kind: MethodKind) -> bool {
    set.contains(&kind)
}

/// The signature hash to use for RSA keys: the best one the server accepts.
async fn rsa_hash(handle: &Handle<HostKeyHandler>) -> Option<HashAlg> {
    match handle.best_supported_rsa_hash().await {
        Ok(Some(hash)) => hash,
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

async fn try_agent(handle: &mut Handle<HostKeyHandler>, env: &Env, user: &str, hash: Option<HashAlg>) -> AgentOutcome {
    let limit = env.connect_timeout;
    let run = async {
        match &env.agent {
            AgentSource::None => AgentOutcome::Unavailable,
            #[cfg(unix)]
            AgentSource::Socket(path) => match AgentClient::connect_uds(path).await {
                Ok(agent) => offer_agent_keys(handle, user, hash, agent).await,
                Err(_) => AgentOutcome::Unavailable,
            },
            #[cfg(unix)]
            AgentSource::System => match AgentClient::connect_env().await {
                Ok(agent) => offer_agent_keys(handle, user, hash, agent).await,
                Err(_) => AgentOutcome::Unavailable,
            },
            #[cfg(windows)]
            AgentSource::System => {
                const PIPE: &str = r"\\.\pipe\openssh-ssh-agent";
                if let Ok(agent) = AgentClient::connect_named_pipe(PIPE).await {
                    match offer_agent_keys(handle, user, hash, agent).await {
                        AgentOutcome::Unavailable => {}
                        done => return done,
                    }
                }
                match AgentClient::connect_pageant().await {
                    Ok(agent) => offer_agent_keys(handle, user, hash, agent).await,
                    Err(_) => AgentOutcome::Unavailable,
                }
            }
        }
    };
    tokio::time::timeout(limit, run).await.unwrap_or(AgentOutcome::Unavailable)
}

async fn offer_agent_keys<S>(
    handle: &mut Handle<HostKeyHandler>,
    user: &str,
    hash: Option<HashAlg>,
    mut agent: AgentClient<S>,
) -> AgentOutcome
where
    S: AgentStream + Unpin + Send + 'static,
{
    let Ok(identities) = agent.request_identities().await else {
        return AgentOutcome::Unavailable;
    };
    let keys: Vec<_> = identities
        .into_iter()
        .filter_map(|id| match id {
            AgentIdentity::PublicKey { key, .. } => Some(key),
            _ => None,
        })
        .collect();
    if keys.is_empty() {
        return AgentOutcome::Unavailable;
    }
    for key in keys {
        let hash = if key.algorithm().is_rsa() { hash } else { None };
        match handle.authenticate_publickey_with(user, key, hash, &mut agent).await {
            Ok(result) if result.success() => return AgentOutcome::Authenticated,
            Ok(_) => {}
            // The agent went away or refused to sign: treat it as not there.
            Err(_) => return AgentOutcome::Unavailable,
        }
    }
    AgentOutcome::Rejected
}

fn key_candidates(env: &Env, target: &Resolved) -> Vec<PathBuf> {
    let named = if target.identity_files.is_empty() {
        DEFAULT_KEY_NAMES.iter().map(|n| env.ssh_dir.join(n)).collect()
    } else {
        target.identity_files.clone()
    };
    named.into_iter().filter(|p| p.is_file()).collect()
}

/// Ok(true) when a key file was accepted. Err is only ever `NeedsPassphrase`.
async fn try_key_files(
    handle: &mut Handle<HostKeyHandler>,
    env: &Env,
    target: &Resolved,
    answers: &Answers,
    hash: Option<HashAlg>,
    tried: &mut Vec<String>,
) -> Result<bool, ConnectResult> {
    let passphrase = answers.passphrase.as_ref();
    // Encrypted keys the supplied passphrase did not open, and whether it opened any.
    let mut not_opened: Vec<PathBuf> = Vec::new();
    let mut passphrase_worked = false;

    for path in key_candidates(env, target) {
        let key = match load_key(&path, None) {
            Ok(key) => key,
            Err(KeyError::Encrypted) => match &passphrase {
                None => return Err(ConnectResult::NeedsPassphrase { key_path: display_path(&path) }),
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
            },
            // Unreadable or unsupported: leave it out.
            Err(KeyError::Other) => continue,
        };
        tried.push(format!("key {}", display_path(&path)));
        let offered = PrivateKeyWithHashAlg::new(Arc::new(key), hash);
        // `offered` (and the decrypted key in it) is moved into the request and dropped there.
        match handle.authenticate_publickey(target.user.as_str(), offered).await {
            Ok(result) if result.success() => return Ok(true),
            Ok(_) => {}
            Err(e) => return Err(unreachable(e)),
        }
    }
    // A passphrase that opened nothing was wrong: ask again.
    if !passphrase_worked {
        if let Some(path) = not_opened.first() {
            return Err(ConnectResult::NeedsPassphrase { key_path: display_path(path) });
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

async fn try_password(
    handle: &mut Handle<HostKeyHandler>,
    user: &str,
    answers: &Answers,
    failures: u8,
    tried: &mut Vec<String>,
) -> Result<(), ConnectResult> {
    let Some(password) = answers.password.as_ref() else {
        return Err(ConnectResult::NeedsPassword { attempts_left: MAX_PASSWORD_ATTEMPTS.saturating_sub(failures) });
    };
    match handle.authenticate_password(user, password.as_str()).await {
        Ok(result) if result.success() => Ok(()),
        Ok(_) => {
            tried.push("password".into());
            let used = failures + 1;
            if used >= MAX_PASSWORD_ATTEMPTS {
                Err(ConnectResult::AuthFailed { tried: std::mem::take(tried) })
            } else {
                Err(ConnectResult::NeedsPassword { attempts_left: MAX_PASSWORD_ATTEMPTS - used })
            }
        }
        Err(e) => Err(unreachable(e)),
    }
}
