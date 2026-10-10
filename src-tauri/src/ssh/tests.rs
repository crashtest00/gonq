//! Auth and pool tests against the in-process server in `test_server`.

use super::auth::{AgentSource, Answers, ConnectResult, Env};
use super::known_hosts;
use super::pool::{Pool, PoolError};
use super::test_server::{new_key, Policy, TestServer};
use super::uri::ConnKey;
use russh::keys::ssh_key::{LineEnding, PrivateKey, PublicKey};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::Duration;
use zeroize::Zeroizing;

pub(super) struct Fixture {
    pub(super) dir: tempfile::TempDir,
    pub(super) server: TestServer,
    pub(super) pool: Pool,
}

impl Fixture {
    pub(super) fn ssh_dir(&self) -> PathBuf {
        self.dir.path().join(".ssh")
    }
    pub(super) fn known_hosts(&self) -> PathBuf {
        self.ssh_dir().join("known_hosts")
    }
    pub(super) fn target(&self) -> String {
        format!("me@127.0.0.1:{}", self.server.port)
    }
    pub(super) fn key(&self) -> ConnKey {
        ConnKey::new("me", "127.0.0.1", self.server.port)
    }
    fn known_hosts_text(&self) -> String {
        std::fs::read_to_string(self.known_hosts()).unwrap_or_default()
    }
    pub(super) async fn connect(&self, answers: Answers) -> ConnectResult {
        self.pool.connect(&self.target(), answers).await
    }
    pub(super) fn fingerprint(&self) -> String {
        known_hosts::fingerprint(self.server.host_key.public_key())
    }
}

#[derive(Default)]
pub(super) struct Setup {
    pub(super) allowed: Vec<PublicKey>,
    pub(super) password: Option<&'static str>,
    pub(super) agent: Option<AgentSource>,
    pub(super) trusted: bool,
    pub(super) idle: Option<Duration>,
    pub(super) max_auth_attempts: Option<usize>,
    pub(super) stall_auth: bool,
    pub(super) no_posix_rename: bool,
    pub(super) no_fsync: bool,
    pub(super) kill_on_write: Option<usize>,
    pub(super) exclude_collisions: usize,
    pub(super) kill_after_rename: bool,
}

fn answers(trust: Option<&str>, passphrase: Option<&str>, password: Option<&str>) -> Answers {
    Answers {
        trust_fingerprint: trust.map(String::from),
        passphrase: passphrase.map(|p| Zeroizing::new(p.to_string())),
        password: password.map(|p| Zeroizing::new(p.to_string())),
        ..Default::default()
    }
}

pub(super) fn none() -> Answers {
    Answers::default()
}

pub(super) async fn fixture(setup: Setup) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let ssh_dir = dir.path().join(".ssh");
    std::fs::create_dir_all(&ssh_dir).unwrap();
    let policy = Policy {
        allowed_keys: setup.allowed,
        password: setup.password.map(String::from),
        root: dir.path().join("home"),
        max_auth_attempts: setup.max_auth_attempts,
        stall_auth: setup.stall_auth,
        no_posix_rename: setup.no_posix_rename,
        no_fsync: setup.no_fsync,
        kill_on_write: setup.kill_on_write,
        exclude_collisions: setup.exclude_collisions,
        kill_after_rename: setup.kill_after_rename,
    };
    std::fs::create_dir_all(dir.path().join("home")).unwrap();
    let server = TestServer::start(new_key(), policy).await;
    if setup.trusted {
        known_hosts::append(&ssh_dir.join("known_hosts"), "127.0.0.1", server.port, server.host_key.public_key()).unwrap();
    }
    let env = Env {
        config_path: ssh_dir.join("config"),
        known_hosts_path: ssh_dir.join("known_hosts"),
        ssh_dir,
        agent: setup.agent.unwrap_or(AgentSource::None),
        connect_timeout: Duration::from_secs(10),
        agent_timeout: Duration::from_secs(30),
        overall_timeout: Duration::from_secs(60),
        keepalive_interval: Duration::from_secs(30),
    };
    let pool = Pool::with_idle_timeout(env, setup.idle.unwrap_or(super::pool::IDLE_TIMEOUT));
    Fixture { dir, server, pool }
}

pub(super) fn write_key(path: &Path, key: &PrivateKey) {
    std::fs::write(path, key.to_openssh(LineEnding::LF).unwrap().as_bytes()).unwrap();
}

pub(super) fn is_connected(r: &ConnectResult) -> bool {
    matches!(r, ConnectResult::Connected { .. })
}

// ---- host keys ------------------------------------------------------------------------------

#[tokio::test]
async fn unknown_host_asks_then_trusting_it_appends_exactly_one_line() {
    let client = new_key();
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], ..Default::default() }).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &client);

    let first = f.connect(none()).await;
    assert_eq!(first, ConnectResult::NeedsHostKey { key_type: "ssh-ed25519".into(), fingerprint: f.fingerprint() });
    assert_eq!(f.known_hosts_text(), "", "asking must not write anything");

    let trusted = f.connect(answers(Some(&f.fingerprint()), None, None)).await;
    assert!(is_connected(&trusted), "{trusted:?}");
    let text = f.known_hosts_text();
    assert_eq!(text.lines().count(), 1, "{text}");
    assert!(text.starts_with(&format!("[127.0.0.1]:{} ssh-ed25519 ", f.server.port)), "{text}");

    // Known now: connecting again needs no answer and adds nothing.
    f.pool.disconnect(&f.key()).await;
    assert!(is_connected(&f.connect(none()).await));
    assert_eq!(f.known_hosts_text(), text);
}

#[tokio::test]
async fn a_wrong_fingerprint_does_not_trust_the_host() {
    let client = new_key();
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], ..Default::default() }).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &client);
    let r = f.connect(answers(Some("SHA256:notthekey"), None, None)).await;
    assert!(matches!(r, ConnectResult::NeedsHostKey { .. }), "{r:?}");
    assert_eq!(f.known_hosts_text(), "");
}

#[tokio::test]
async fn a_changed_host_key_is_a_hard_stop() {
    let client = new_key();
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], ..Default::default() }).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &client);
    let old = new_key();
    known_hosts::append(&f.known_hosts(), "127.0.0.1", f.server.port, old.public_key()).unwrap();
    let before = f.known_hosts_text();

    let r = f.connect(none()).await;
    assert_eq!(
        r,
        ConnectResult::HostKeyChanged { fingerprint: f.fingerprint(), known_line: before.lines().next().unwrap().to_string() }
    );
    // No answer gets past it.
    for a in [answers(Some(&f.fingerprint()), None, None), answers(Some(&f.fingerprint()), Some("x"), Some("x"))] {
        assert!(matches!(f.connect(a).await, ConnectResult::HostKeyChanged { .. }));
    }
    assert_eq!(f.known_hosts_text(), before);
}

#[tokio::test]
async fn a_hashed_known_hosts_entry_is_honoured() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use hmac::{Hmac, KeyInit, Mac};
    let client = new_key();
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], ..Default::default() }).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &client);
    let salt = [3u8; 20];
    let mut mac = Hmac::<sha1::Sha1>::new_from_slice(&salt).unwrap();
    mac.update(format!("[127.0.0.1]:{}", f.server.port).as_bytes());
    let hash = mac.finalize().into_bytes();
    let o = f.server.host_key.public_key().to_openssh().unwrap();
    let mut parts = o.split_whitespace();
    let line = format!("|1|{}|{} {} {}\n", STANDARD.encode(salt), STANDARD.encode(hash), parts.next().unwrap(), parts.next().unwrap());
    std::fs::write(f.known_hosts(), &line).unwrap();
    assert!(is_connected(&f.connect(none()).await));
    assert_eq!(f.known_hosts_text(), line);
}

// ---- keys and agent -------------------------------------------------------------------------

#[tokio::test]
async fn an_unencrypted_key_file_connects_without_prompts() {
    let client = new_key();
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], trusted: true, ..Default::default() }).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &client);
    let r = f.connect(none()).await;
    assert!(
        matches!(&r, ConnectResult::Connected { home, authority } if home.ends_with("home") && authority == &format!("me@127.0.0.1:{}", f.server.port)),
        "{r:?}"
    );
}

#[tokio::test]
async fn identity_file_from_the_config_is_used_instead_of_the_defaults() {
    let (client, decoy) = (new_key(), new_key());
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], trusted: true, ..Default::default() }).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &decoy);
    let custom = f.dir.path().join("custom_key");
    write_key(&custom, &client);
    std::fs::write(
        f.ssh_dir().join("config"),
        format!("Host box\n  HostName 127.0.0.1\n  Port {}\n  User me\n  IdentityFile {}\n", f.server.port, custom.display()),
    )
    .unwrap();
    let r = f.pool.connect("box", none()).await;
    assert!(is_connected(&r), "{r:?}");
    // The alias is its own host: the connection is filed under it.
    assert_eq!(f.pool.open_keys().await, vec![ConnKey::new("me", "box", f.server.port)]);
}

#[tokio::test]
async fn an_encrypted_key_asks_for_its_passphrase() {
    let client = new_key();
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], trusted: true, ..Default::default() }).await;
    let path = f.ssh_dir().join("id_ed25519");
    write_key(&path, &client.encrypt(&mut rand::rng(), "hunter2").unwrap());

    let key_path = path.to_string_lossy().into_owned();
    assert_eq!(f.connect(none()).await, ConnectResult::NeedsPassphrase { key_path: key_path.clone() });
    assert_eq!(f.connect(answers(None, Some("wrong"), None)).await, ConnectResult::NeedsPassphrase { key_path });
    assert!(is_connected(&f.connect(answers(None, Some("hunter2"), None)).await));
    // Nothing is remembered: a fresh connection asks again.
    f.pool.disconnect(&f.key()).await;
    assert!(matches!(f.connect(none()).await, ConnectResult::NeedsPassphrase { .. }));
}


fn skipping(paths: &[&Path]) -> Answers {
    Answers { skip_passphrase: paths.iter().map(|p| p.to_string_lossy().into_owned()).collect(), ..Default::default() }
}

#[tokio::test]
async fn host_names_in_the_config_match_regardless_of_case() {
    let client = new_key();
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], trusted: true, ..Default::default() }).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &client);
    std::fs::write(
        f.ssh_dir().join("config"),
        format!("Host MyNas\n  HostName 127.0.0.1\n  Port {}\n  User me\n", f.server.port),
    )
    .unwrap();
    let r = f.pool.connect("MyNas", none()).await;
    assert!(is_connected(&r), "{r:?}");
    assert_eq!(f.pool.open_keys().await, vec![ConnKey::new("me", "mynas", f.server.port)]);
}

#[tokio::test]
async fn an_old_known_hosts_line_beside_the_current_one_is_not_a_changed_key() {
    let client = new_key();
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], ..Default::default() }).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &client);
    known_hosts::append(&f.known_hosts(), "127.0.0.1", f.server.port, new_key().public_key()).unwrap();
    known_hosts::append(&f.known_hosts(), "127.0.0.1", f.server.port, f.server.host_key.public_key()).unwrap();
    let r = f.connect(none()).await;
    assert!(is_connected(&r), "{r:?}");
}

#[tokio::test]
async fn a_locked_key_does_not_hide_an_unencrypted_one() {
    let (locked, good) = (new_key(), new_key());
    let f = fixture(Setup { allowed: vec![good.public_key().clone()], trusted: true, ..Default::default() }).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &locked.encrypt(&mut rand::rng(), "pw").unwrap());
    write_key(&f.ssh_dir().join("id_rsa"), &good);
    let r = f.connect(none()).await;
    assert!(is_connected(&r), "{r:?}");
}

fn locked_key(f: &Fixture, name: &str, key: &PrivateKey) -> String {
    locked_key_with(f, name, key, "pw")
}

fn locked_key_with(f: &Fixture, name: &str, key: &PrivateKey, passphrase: &str) -> String {
    let path = f.ssh_dir().join(name);
    write_key(&path, &key.encrypt(&mut rand::rng(), passphrase).unwrap());
    path.to_string_lossy().into_owned()
}

#[tokio::test]
async fn the_passphrase_is_asked_before_the_password_on_a_server_that_offers_both() {
    let client = new_key();
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], password: Some("secret"), trusted: true, ..Default::default() }).await;
    let key_path = locked_key(&f, "id_ed25519", &client);
    assert_eq!(f.connect(none()).await, ConnectResult::NeedsPassphrase { key_path: key_path.clone() });
    assert_eq!(f.connect(answers(None, Some("wrong"), None)).await, ConnectResult::NeedsPassphrase { key_path });
    // Not one password reached the server.
    assert_eq!(f.server.password_tries.load(Ordering::SeqCst), 0);
    let r = f.connect(answers(None, Some("pw"), None)).await;
    assert!(is_connected(&r), "{r:?}");
}

#[tokio::test]
async fn a_skipped_passphrase_moves_on_to_the_password() {
    let f = fixture(Setup { allowed: vec![new_key().public_key().clone()], password: Some("secret"), trusted: true, ..Default::default() }).await;
    let key_path = locked_key(&f, "id_ed25519", &new_key());
    let path = PathBuf::from(&key_path);
    assert_eq!(f.connect(none()).await, ConnectResult::NeedsPassphrase { key_path });
    let skip = |password: Option<&str>| Answers {
        password: password.map(|p| Zeroizing::new(p.to_string())),
        ..skipping(&[&path])
    };
    // AC5 with an encrypted key present: passphrase, skip, then the password 3, 2, 1, then failure.
    assert_eq!(f.connect(skip(None)).await, ConnectResult::NeedsPassword { attempts_left: 3 });
    assert_eq!(f.connect(skip(Some("bad"))).await, ConnectResult::NeedsPassword { attempts_left: 2 });
    assert_eq!(f.connect(skip(Some("bad"))).await, ConnectResult::NeedsPassword { attempts_left: 1 });
    assert_eq!(f.connect(skip(Some("bad"))).await, ConnectResult::AuthFailed { tried: vec!["password".into()] });
    assert_eq!(f.server.password_tries.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn a_skipped_passphrase_still_lets_the_right_password_connect() {
    let f = fixture(Setup { allowed: vec![new_key().public_key().clone()], password: Some("secret"), trusted: true, ..Default::default() }).await;
    let path = PathBuf::from(locked_key(&f, "id_ed25519", &new_key()));
    let r = f.connect(Answers { password: Some(Zeroizing::new("secret".into())), ..skipping(&[&path]) }).await;
    assert!(is_connected(&r), "{r:?}");
}

#[tokio::test]
async fn a_locked_key_does_not_hide_an_unencrypted_one_behind_a_prompt() {
    let (locked, good) = (new_key(), new_key());
    let f = fixture(Setup { allowed: vec![good.public_key().clone()], password: Some("secret"), trusted: true, ..Default::default() }).await;
    locked_key(&f, "id_ed25519", &locked);
    write_key(&f.ssh_dir().join("id_rsa"), &good);
    let r = f.connect(none()).await;
    assert!(is_connected(&r), "{r:?}");
}

#[tokio::test]
async fn each_locked_key_is_asked_in_turn_and_skipping_moves_to_the_next() {
    let wanted = new_key();
    let f = fixture(Setup { allowed: vec![wanted.public_key().clone()], trusted: true, ..Default::default() }).await;
    let first = locked_key(&f, "id_ed25519", &new_key());
    let second = locked_key(&f, "id_ecdsa", &wanted);
    assert_eq!(f.connect(none()).await, ConnectResult::NeedsPassphrase { key_path: first.clone() });
    let r = f.connect(Answers { passphrase: None, ..skipping(&[Path::new(&first)]) }).await;
    assert_eq!(r, ConnectResult::NeedsPassphrase { key_path: second.clone() });
    let r = f.connect(Answers { passphrase: Some(Zeroizing::new("pw".into())), ..skipping(&[Path::new(&first)]) }).await;
    assert!(is_connected(&r), "{r:?}");
}

#[tokio::test]
async fn two_locked_keys_both_opened_and_refused_move_on_to_the_password() {
    let f = fixture(Setup { allowed: vec![new_key().public_key().clone()], password: Some("secret"), trusted: true, ..Default::default() }).await;
    let first = locked_key_with(&f, "id_ed25519", &new_key(), "passA");
    let second = locked_key_with(&f, "id_ecdsa", &new_key(), "passB");
    assert_eq!(f.connect(none()).await, ConnectResult::NeedsPassphrase { key_path: first.clone() });
    // The first opens and is refused; the second is asked for, once.
    assert_eq!(f.connect(answers(None, Some("passA"), None)).await, ConnectResult::NeedsPassphrase { key_path: second.clone() });
    // The second opens and is refused: no further passphrase prompt.
    assert_eq!(f.connect(answers(None, Some("passB"), None)).await, ConnectResult::NeedsPassword { attempts_left: 3 });
    assert_eq!(f.connect(answers(None, None, Some("bad"))).await, ConnectResult::NeedsPassword { attempts_left: 2 });
    assert_eq!(f.connect(answers(None, None, Some("bad"))).await, ConnectResult::NeedsPassword { attempts_left: 1 });
    let r = f.connect(answers(None, None, Some("bad"))).await;
    assert_eq!(
        r,
        ConnectResult::AuthFailed { tried: vec![format!("key {first}"), format!("key {second}"), "password".into()] }
    );
}

#[tokio::test]
async fn two_locked_keys_the_second_authorized_connects_after_the_second_passphrase() {
    let wanted = new_key();
    let f = fixture(Setup { allowed: vec![wanted.public_key().clone()], password: Some("secret"), trusted: true, ..Default::default() }).await;
    let first = locked_key_with(&f, "id_ed25519", &new_key(), "passA");
    let second = locked_key_with(&f, "id_ecdsa", &wanted, "passB");
    assert_eq!(f.connect(none()).await, ConnectResult::NeedsPassphrase { key_path: first });
    assert_eq!(f.connect(answers(None, Some("passA"), None)).await, ConnectResult::NeedsPassphrase { key_path: second });
    let r = f.connect(answers(None, Some("passB"), None)).await;
    assert!(is_connected(&r), "{r:?}");
    assert_eq!(f.server.password_tries.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn one_locked_key_refused_and_one_skipped_move_on_to_the_password() {
    let f = fixture(Setup { allowed: vec![new_key().public_key().clone()], password: Some("secret"), trusted: true, ..Default::default() }).await;
    let first = locked_key_with(&f, "id_ed25519", &new_key(), "passA");
    let second = locked_key_with(&f, "id_ecdsa", &new_key(), "passB");
    assert_eq!(f.connect(none()).await, ConnectResult::NeedsPassphrase { key_path: first.clone() });
    assert_eq!(f.connect(answers(None, Some("passA"), None)).await, ConnectResult::NeedsPassphrase { key_path: second.clone() });
    let r = f.connect(skipping(&[Path::new(&second)])).await;
    assert_eq!(r, ConnectResult::NeedsPassword { attempts_left: 3 });
}

#[tokio::test]
async fn a_locked_key_that_is_the_only_option_asks_and_can_be_skipped() {
    let client = new_key();
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], trusted: true, ..Default::default() }).await;
    let key_path = locked_key(&f, "id_ed25519", &client);
    assert_eq!(f.connect(none()).await, ConnectResult::NeedsPassphrase { key_path: key_path.clone() });
    assert_eq!(f.connect(skipping(&[Path::new(&key_path)])).await, ConnectResult::AuthFailed { tried: vec![] });
}

#[tokio::test]
async fn a_server_that_hangs_up_during_sign_in_is_auth_failed_not_unreachable() {
    let f = fixture(Setup {
        allowed: vec![new_key().public_key().clone()],
        trusted: true,
        max_auth_attempts: Some(2),
        ..Default::default()
    })
    .await;
    for name in ["id_ed25519", "id_ecdsa", "id_rsa"] {
        write_key(&f.ssh_dir().join(name), &new_key());
    }
    let r = f.connect(none()).await;
    let ConnectResult::AuthFailed { tried } = &r else { panic!("{r:?}") };
    assert!(!tried.is_empty(), "{tried:?}");
}

#[tokio::test]
async fn a_server_that_stalls_after_key_exchange_is_unreachable_promptly() {
    let mut f = fixture(Setup { trusted: true, stall_auth: true, ..Default::default() }).await;
    let mut env = f.pool.env().clone();
    env.connect_timeout = Duration::from_millis(400);
    f.pool = Pool::new(env);
    let started = std::time::Instant::now();
    let r = tokio::time::timeout(Duration::from_secs(8), f.connect(none())).await.expect("connect hung");
    assert!(matches!(r, ConnectResult::Unreachable { .. }), "{r:?}");
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[cfg(unix)]
mod agent {
    use super::*;
    use russh::keys::agent::client::AgentClient;
    use russh::keys::agent::server::serve;
    use tokio_stream::wrappers::UnixListenerStream;

    /// Starts an agent holding `keys` on a socket in `dir`.
    async fn start_agent(dir: &Path, keys: Vec<PrivateKey>) -> PathBuf {
        let sock = dir.join("agent.sock");
        let listener = tokio::net::UnixListener::bind(&sock).unwrap();
        tokio::spawn(async move {
            let _ = serve(UnixListenerStream::new(listener), ()).await;
        });
        let mut client = AgentClient::connect_uds(&sock).await.unwrap();
        for key in keys {
            client.add_identity(&key, &[]).await.unwrap();
        }
        sock
    }


    /// An agent that holds its keys but never gets around to signing (a confirmation prompt, a
    /// hardware key waiting for a touch).
    #[derive(Clone)]
    struct NeverSigns;

    impl russh::keys::agent::server::Agent for NeverSigns {
        async fn confirm_request(&self, msg: russh::keys::agent::server::MessageType) -> bool {
            if matches!(msg, russh::keys::agent::server::MessageType::Sign) {
                std::future::pending::<()>().await;
            }
            true
        }
    }

    #[tokio::test]
    async fn an_agent_that_never_signs_does_not_hang_the_connection() {
        let client = new_key();
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("agent.sock");
        let listener = tokio::net::UnixListener::bind(&sock).unwrap();
        tokio::spawn(async move {
            let _ = serve(UnixListenerStream::new(listener), NeverSigns).await;
        });
        AgentClient::connect_uds(&sock).await.unwrap().add_identity(&client, &[]).await.unwrap();

        let mut f = fixture(Setup {
            allowed: vec![client.public_key().clone()],
            password: Some("secret"),
            trusted: true,
            agent: Some(AgentSource::Socket(sock)),
            ..Default::default()
        })
        .await;
        write_key(&f.ssh_dir().join("id_ed25519"), &client);
        let mut env = f.pool.env().clone();
        env.agent_timeout = Duration::from_millis(500);
        f.pool = Pool::new(env);

        // The key file is used on a fresh connection once the agent has been given up on...
        let r = tokio::time::timeout(Duration::from_secs(8), f.connect(none())).await.expect("connect hung");
        assert!(is_connected(&r), "{r:?}");
        // ...and the host's slot is not left locked.
        let again = tokio::time::timeout(Duration::from_secs(8), f.pool.acquire(&f.key())).await.expect("slot stuck");
        assert!(again.is_ok());
    }

    async fn start_custom_agent<A: russh::keys::agent::server::Agent + Send + Sync + 'static>(
        dir: &Path,
        agent: A,
        keys: Vec<PrivateKey>,
    ) -> PathBuf {
        let sock = dir.join("agent.sock");
        let listener = tokio::net::UnixListener::bind(&sock).unwrap();
        tokio::spawn(async move {
            let _ = serve(UnixListenerStream::new(listener), agent).await;
        });
        let mut client = AgentClient::connect_uds(&sock).await.unwrap();
        for key in keys {
            client.add_identity(&key, &[]).await.unwrap();
        }
        sock
    }

    async fn with_agent_timeouts(f: &mut Fixture, agent: Duration, overall: Duration) {
        let mut env = f.pool.env().clone();
        env.agent_timeout = agent;
        env.overall_timeout = overall;
        f.pool = Pool::new(env);
    }

    #[tokio::test]
    async fn a_never_signing_agent_with_three_keys_returns_within_the_bound() {
        let dir = tempfile::tempdir().unwrap();
        let keys: Vec<PrivateKey> = (0..3).map(|_| new_key()).collect();
        let allowed = keys.iter().map(|k| k.public_key().clone()).collect();
        let sock = start_custom_agent(dir.path(), NeverSigns, keys).await;
        let mut f = fixture(Setup {
            allowed,
            trusted: true,
            agent: Some(AgentSource::Socket(sock)),
            ..Default::default()
        })
        .await;
        with_agent_timeouts(&mut f, Duration::from_millis(600), Duration::from_secs(20)).await;
        let started = std::time::Instant::now();
        let r = tokio::time::timeout(Duration::from_secs(10), f.connect(none())).await.expect("connect hung");
        assert_eq!(r, ConnectResult::AuthFailed { tried: vec!["ssh-agent (timed out)".into()] });
        assert!(started.elapsed() < Duration::from_millis(3000), "{:?}", started.elapsed());
    }

    #[tokio::test]
    async fn one_connect_call_has_an_overall_bound() {
        let dir = tempfile::tempdir().unwrap();
        let key = new_key();
        let sock = start_custom_agent(dir.path(), NeverSigns, vec![key.clone()]).await;
        let mut f = fixture(Setup {
            allowed: vec![key.public_key().clone()],
            trusted: true,
            agent: Some(AgentSource::Socket(sock)),
            ..Default::default()
        })
        .await;
        // The agent phase alone (30 s) is longer than the call may take.
        with_agent_timeouts(&mut f, Duration::from_secs(30), Duration::from_millis(700)).await;
        let started = std::time::Instant::now();
        let r = tokio::time::timeout(Duration::from_secs(8), f.connect(none())).await.expect("connect hung");
        assert!(matches!(r, ConnectResult::Unreachable { .. }), "{r:?}");
        assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
        // And the slot is free afterwards.
        let slot = tokio::time::timeout(Duration::from_secs(8), f.pool.acquire(&f.key())).await.expect("slot stuck");
        assert!(slot.is_err());
    }

    #[tokio::test]
    async fn a_key_in_the_agent_and_on_disk_is_offered_once() {
        let dir = tempfile::tempdir().unwrap();
        let keys: Vec<PrivateKey> = (0..3).map(|_| new_key()).collect();
        let sock = start_agent(dir.path(), keys.clone()).await;
        // MaxAuthTries 5: three agent keys leave room for the password only if the files are not offered again.
        let f = fixture(Setup {
            allowed: vec![new_key().public_key().clone()],
            password: Some("secret"),
            trusted: true,
            agent: Some(AgentSource::Socket(sock)),
            max_auth_attempts: Some(5),
            ..Default::default()
        })
        .await;
        for (name, key) in ["id_ed25519", "id_ecdsa", "id_rsa"].iter().zip(&keys) {
            write_key(&f.ssh_dir().join(name), key);
        }
        assert_eq!(f.connect(none()).await, ConnectResult::NeedsPassword { attempts_left: 3 });
    }

    #[tokio::test]
    async fn a_locked_key_the_agent_already_offered_is_not_asked_for() {
        let dir = tempfile::tempdir().unwrap();
        let key = new_key();
        let sock = start_agent(dir.path(), vec![key.clone()]).await;
        let f = fixture(Setup {
            allowed: vec![new_key().public_key().clone()],
            trusted: true,
            agent: Some(AgentSource::Socket(sock)),
            ..Default::default()
        })
        .await;
        write_key(&f.ssh_dir().join("id_ed25519"), &key.encrypt(&mut rand::rng(), "pw").unwrap());
        std::fs::write(f.ssh_dir().join("id_ed25519.pub"), key.public_key().to_openssh().unwrap()).unwrap();
        assert_eq!(f.connect(none()).await, ConnectResult::AuthFailed { tried: vec!["ssh-agent".into()] });
    }

    #[tokio::test]
    async fn an_agent_that_never_signs_still_lets_the_password_through() {
        let client = new_key();
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("agent.sock");
        let listener = tokio::net::UnixListener::bind(&sock).unwrap();
        tokio::spawn(async move {
            let _ = serve(UnixListenerStream::new(listener), NeverSigns).await;
        });
        AgentClient::connect_uds(&sock).await.unwrap().add_identity(&client, &[]).await.unwrap();
        let mut f = fixture(Setup {
            allowed: vec![client.public_key().clone()],
            password: Some("secret"),
            trusted: true,
            agent: Some(AgentSource::Socket(sock)),
            ..Default::default()
        })
        .await;
        let mut env = f.pool.env().clone();
        env.agent_timeout = Duration::from_millis(500);
        f.pool = Pool::new(env);
        let r = tokio::time::timeout(Duration::from_secs(8), f.connect(none())).await.expect("connect hung");
        assert_eq!(r, ConnectResult::NeedsPassword { attempts_left: 3 });
        let r = tokio::time::timeout(Duration::from_secs(8), f.connect(answers(None, None, Some("secret")))).await.expect("hung");
        assert!(is_connected(&r), "{r:?}");
    }

    #[tokio::test]
    async fn a_full_agent_does_not_use_up_the_servers_attempts() {
        let client = new_key();
        let dir = tempfile::tempdir().unwrap();
        let junk: Vec<PrivateKey> = (0..8).map(|_| new_key()).collect();
        let sock = start_agent(dir.path(), junk).await;
        let f = fixture(Setup {
            allowed: vec![client.public_key().clone()],
            trusted: true,
            agent: Some(AgentSource::Socket(sock)),
            max_auth_attempts: Some(6),
            ..Default::default()
        })
        .await;
        write_key(&f.ssh_dir().join("id_ed25519"), &client);
        let r = f.connect(none()).await;
        assert!(is_connected(&r), "{r:?}");
    }

    #[tokio::test]
    async fn the_agent_key_the_config_names_is_offered_first() {
        let client = new_key();
        let dir = tempfile::tempdir().unwrap();
        let mut keys: Vec<PrivateKey> = (0..8).map(|_| new_key()).collect();
        keys.push(client.clone());
        let sock = start_agent(dir.path(), keys).await;
        let f = fixture(Setup {
            allowed: vec![client.public_key().clone()],
            trusted: true,
            agent: Some(AgentSource::Socket(sock)),
            max_auth_attempts: Some(6),
            ..Default::default()
        })
        .await;
        // Only the public half is on disk (the private key lives in the agent).
        let named = f.dir.path().join("work_key");
        std::fs::write(named.with_extension("pub"), client.public_key().to_openssh().unwrap()).unwrap();
        std::fs::write(
            f.ssh_dir().join("config"),
            format!("Host box\n  HostName 127.0.0.1\n  Port {}\n  User me\n  IdentityFile {}\n", f.server.port, named.with_extension("").display()),
        )
        .unwrap();
        let r = f.pool.connect("box", none()).await;
        assert!(is_connected(&r), "{r:?}");
    }

    #[tokio::test]
    async fn a_key_in_the_agent_connects_with_no_prompts() {
        let client = new_key();
        let dir = tempfile::tempdir().unwrap();
        let sock = start_agent(dir.path(), vec![new_key(), client.clone()]).await;
        let f = fixture(Setup {
            allowed: vec![client.public_key().clone()],
            trusted: true,
            agent: Some(AgentSource::Socket(sock)),
            ..Default::default()
        })
        .await;
        // No key files at all: the agent alone does it.
        let r = f.connect(none()).await;
        assert!(is_connected(&r), "{r:?}");
    }

    #[tokio::test]
    async fn an_agent_that_is_not_running_is_skipped() {
        let client = new_key();
        let f = fixture(Setup {
            allowed: vec![client.public_key().clone()],
            trusted: true,
            agent: Some(AgentSource::Socket(PathBuf::from("/nonexistent/agent.sock"))),
            ..Default::default()
        })
        .await;
        write_key(&f.ssh_dir().join("id_ed25519"), &client);
        assert!(is_connected(&f.connect(none()).await));
    }

    #[tokio::test]
    async fn an_agent_without_the_right_key_is_listed_as_tried() {
        let dir = tempfile::tempdir().unwrap();
        let sock = start_agent(dir.path(), vec![new_key()]).await;
        let f = fixture(Setup {
            allowed: vec![new_key().public_key().clone()],
            trusted: true,
            agent: Some(AgentSource::Socket(sock)),
            ..Default::default()
        })
        .await;
        assert_eq!(f.connect(none()).await, ConnectResult::AuthFailed { tried: vec!["ssh-agent".into()] });
    }
}

// ---- password -------------------------------------------------------------------------------

#[tokio::test]
async fn password_gets_three_attempts_then_auth_failed() {
    let f = fixture(Setup { password: Some("secret"), trusted: true, ..Default::default() }).await;
    assert_eq!(f.connect(none()).await, ConnectResult::NeedsPassword { attempts_left: 3 });
    assert_eq!(f.connect(answers(None, None, Some("bad"))).await, ConnectResult::NeedsPassword { attempts_left: 2 });
    assert_eq!(f.connect(answers(None, None, Some("bad"))).await, ConnectResult::NeedsPassword { attempts_left: 1 });
    assert_eq!(f.connect(answers(None, None, Some("bad"))).await, ConnectResult::AuthFailed { tried: vec!["password".into()] });
    assert_eq!(f.server.password_tries.load(Ordering::SeqCst), 3);
    // A new Connect starts over.
    assert_eq!(f.connect(none()).await, ConnectResult::NeedsPassword { attempts_left: 3 });
}

#[tokio::test]
async fn the_right_password_connects() {
    let f = fixture(Setup { password: Some("secret"), trusted: true, ..Default::default() }).await;
    assert_eq!(f.connect(answers(None, None, Some("bad"))).await, ConnectResult::NeedsPassword { attempts_left: 2 });
    assert!(is_connected(&f.connect(answers(None, None, Some("secret"))).await));
    // The count was cleared by the success.
    f.pool.disconnect(&f.key()).await;
    assert_eq!(f.connect(none()).await, ConnectResult::NeedsPassword { attempts_left: 3 });
}

#[tokio::test]
async fn a_key_that_works_means_the_password_is_never_asked() {
    let client = new_key();
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], password: Some("secret"), trusted: true, ..Default::default() }).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &client);
    assert!(is_connected(&f.connect(none()).await));
    assert_eq!(f.server.password_tries.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_publickey_only_server_with_no_usable_key_is_auth_failed_never_a_password_prompt() {
    let f = fixture(Setup { allowed: vec![new_key().public_key().clone()], trusted: true, ..Default::default() }).await;
    let stranger = new_key();
    write_key(&f.ssh_dir().join("id_ed25519"), &stranger);
    let r = f.connect(none()).await;
    let ConnectResult::AuthFailed { tried } = &r else { panic!("{r:?}") };
    assert_eq!(tried.len(), 1);
    assert!(tried[0].starts_with("key ") && tried[0].ends_with("id_ed25519"), "{tried:?}");
    assert_eq!(f.server.password_tries.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_password_server_with_a_rejected_key_falls_through_to_the_password() {
    let f = fixture(Setup { allowed: vec![new_key().public_key().clone()], password: Some("secret"), trusted: true, ..Default::default() }).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &new_key());
    assert_eq!(f.connect(none()).await, ConnectResult::NeedsPassword { attempts_left: 3 });
}

// ---- unreachable ----------------------------------------------------------------------------

#[tokio::test]
async fn a_refused_connection_is_unreachable() {
    let f = fixture(Setup::default()).await;
    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let started = std::time::Instant::now();
    let r = f.pool.connect(&format!("me@127.0.0.1:{port}"), none()).await;
    assert!(matches!(r, ConnectResult::Unreachable { .. }), "{r:?}");
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[tokio::test]
async fn a_silent_server_times_out_as_unreachable() {
    let silent = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = silent.local_addr().unwrap().port();
    tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((s, _)) = silent.accept().await {
            held.push(s);
        }
    });
    let mut f = fixture(Setup::default()).await;
    let mut env = f.pool.env().clone();
    env.connect_timeout = Duration::from_millis(400);
    f.pool = Pool::new(env);
    let started = std::time::Instant::now();
    let r = f.pool.connect(&format!("me@127.0.0.1:{port}"), none()).await;
    assert!(matches!(&r, ConnectResult::Unreachable { reason } if reason.contains("no answer")), "{r:?}");
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[tokio::test]
async fn the_real_timeout_is_ten_seconds() {
    assert_eq!(Env::from_home().connect_timeout, Duration::from_secs(10));
    assert_eq!(Env::from_home().keepalive_interval, Duration::from_secs(30));
}

#[tokio::test]
async fn an_unparseable_target_is_reported() {
    let f = fixture(Setup::default()).await;
    assert!(matches!(f.pool.connect("", none()).await, ConnectResult::Unreachable { .. }));
}

// ---- pool -----------------------------------------------------------------------------------

pub(super) async fn keyed_fixture(idle: Option<Duration>) -> (Fixture, PrivateKey) {
    let client = new_key();
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], trusted: true, idle, ..Default::default() }).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &client);
    (f, client)
}

async fn home_of(f: &Fixture) -> Result<String, PoolError<russh_sftp::client::error::Error>> {
    f.pool.with_sftp(&f.key(), |c| async move { c.sftp().canonicalize(".").await }).await
}

#[tokio::test]
async fn one_session_is_shared_by_every_caller() {
    let (f, _) = keyed_fixture(None).await;
    assert!(is_connected(&f.connect(none()).await));
    assert!(is_connected(&f.connect(none()).await));
    let key = f.key();
    let (a, b) = tokio::join!(f.pool.acquire(&key), f.pool.acquire(&key));
    assert!(std::sync::Arc::ptr_eq(&a.unwrap(), &b.unwrap()));
    assert_eq!(f.server.connections.load(Ordering::SeqCst), 1);
    assert!(home_of(&f).await.unwrap().ends_with("home"));
}

#[tokio::test]
async fn simultaneous_first_connects_open_one_session() {
    let (f, _) = keyed_fixture(None).await;
    let (a, b, c) = tokio::join!(f.connect(none()), f.connect(none()), f.connect(none()));
    assert!(is_connected(&a) && is_connected(&b) && is_connected(&c));
    assert_eq!(f.server.connections.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn aliases_for_one_server_are_separate_sessions() {
    let (f, _) = keyed_fixture(None).await;
    std::fs::write(f.ssh_dir().join("config"), format!("Host other\n  HostName 127.0.0.1\n  Port {}\n  User me\n", f.server.port)).unwrap();
    known_hosts::append(&f.known_hosts(), "127.0.0.1", f.server.port, f.server.host_key.public_key()).ok();
    assert!(is_connected(&f.connect(none()).await));
    assert!(is_connected(&f.pool.connect("other", none()).await));
    assert_eq!(f.pool.open_keys().await.len(), 2);
    assert_eq!(f.server.connections.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn disconnect_closes_the_session() {
    let (f, _) = keyed_fixture(None).await;
    assert!(is_connected(&f.connect(none()).await));
    f.pool.disconnect(&f.key()).await;
    assert!(f.pool.open_keys().await.is_empty());
}

#[tokio::test]
async fn an_idle_session_is_closed_and_reopens_silently() {
    let (f, _) = keyed_fixture(Some(Duration::from_millis(200))).await;
    assert!(is_connected(&f.connect(none()).await));
    tokio::time::sleep(Duration::from_millis(900)).await;
    assert!(f.pool.open_keys().await.is_empty(), "idle session should have been closed");
    assert!(home_of(&f).await.is_ok());
    assert_eq!(f.server.connections.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_session_in_use_is_not_closed_when_idle() {
    let (f, _) = keyed_fixture(Some(Duration::from_millis(200))).await;
    assert!(is_connected(&f.connect(none()).await));
    let held = f
        .pool
        .with_sftp(&f.key(), |c| async move {
            tokio::time::sleep(Duration::from_millis(900)).await;
            c.sftp().canonicalize(".").await
        })
        .await;
    assert!(held.is_ok());
    assert_eq!(f.server.connections.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_lost_session_is_reopened_once_silently() {
    let (f, client) = keyed_fixture(None).await;
    assert!(is_connected(&f.connect(none()).await));
    assert!(home_of(&f).await.is_ok());

    f.server.stop();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let policy = Policy { allowed_keys: vec![client.public_key().clone()], password: None, root: f.dir.path().join("home"), ..Default::default() };
    let again = TestServer::start_on(f.server.port, f.server.host_key.clone(), policy).await;

    assert!(home_of(&f).await.unwrap().ends_with("home"));
    assert_eq!(again.connections.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_lost_session_that_needs_a_passphrase_asks_instead_of_guessing() {
    let client = new_key();
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], trusted: true, ..Default::default() }).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &client.encrypt(&mut rand::rng(), "pw").unwrap());
    assert!(is_connected(&f.connect(answers(None, Some("pw"), None)).await));

    f.server.stop();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let policy = Policy { allowed_keys: vec![client.public_key().clone()], password: None, root: f.dir.path().join("home"), ..Default::default() };
    let _again = TestServer::start_on(f.server.port, f.server.host_key.clone(), policy).await;

    let r = home_of(&f).await;
    assert!(matches!(r, Err(PoolError::Connect(ConnectResult::NeedsPassphrase { .. }))), "{r:?}");
}

#[tokio::test]
async fn a_second_loss_is_returned_not_retried_forever() {
    let (f, _) = keyed_fixture(None).await;
    assert!(is_connected(&f.connect(none()).await));
    let calls = std::sync::atomic::AtomicUsize::new(0);
    let r: Result<(), _> = f
        .pool
        .with_sftp(&f.key(), |_c| {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Err(russh_sftp::client::error::Error::IO("link dropped".into())) }
        })
        .await;
    assert!(matches!(r, Err(PoolError::Op(_))));
    assert_eq!(calls.load(Ordering::SeqCst), 2, "one try plus one retry on a fresh session");
}

#[tokio::test]
async fn a_command_error_on_a_healthy_session_is_not_retried() {
    use russh_sftp::protocol::{Status, StatusCode};
    let (f, _) = keyed_fixture(None).await;
    assert!(is_connected(&f.connect(none()).await));
    let calls = std::sync::atomic::AtomicUsize::new(0);
    let r: Result<(), _> = f
        .pool
        .with_sftp(&f.key(), |_c| {
            calls.fetch_add(1, Ordering::SeqCst);
            async {
                Err(russh_sftp::client::error::Error::Status(Status {
                    id: 0,
                    status_code: StatusCode::NoSuchFile,
                    error_message: "nope".into(),
                    language_tag: String::new(),
                }))
            }
        })
        .await;
    assert!(matches!(r, Err(PoolError::Op(_))));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(f.server.connections.load(Ordering::SeqCst), 1);
}

// ---- command shapes -------------------------------------------------------------------------

#[test]
fn results_serialise_with_a_snake_case_kind() {
    let j = |r: ConnectResult| serde_json::to_value(r).unwrap();
    assert_eq!(
        j(ConnectResult::Connected { home: "/h".into(), authority: "me@nas".into() }),
        serde_json::json!({"kind": "connected", "home": "/h", "authority": "me@nas"})
    );
    assert_eq!(
        j(ConnectResult::NeedsHostKey { key_type: "ssh-ed25519".into(), fingerprint: "SHA256:x".into() }),
        serde_json::json!({"kind": "needs_host_key", "key_type": "ssh-ed25519", "fingerprint": "SHA256:x"})
    );
    assert_eq!(
        j(ConnectResult::HostKeyChanged { fingerprint: "f".into(), known_line: "l".into() }),
        serde_json::json!({"kind": "host_key_changed", "fingerprint": "f", "known_line": "l"})
    );
    assert_eq!(j(ConnectResult::NeedsPassphrase { key_path: "/k".into() }), serde_json::json!({"kind": "needs_passphrase", "key_path": "/k"}));
    assert_eq!(j(ConnectResult::NeedsPassword { attempts_left: 2 }), serde_json::json!({"kind": "needs_password", "attempts_left": 2}));
    assert_eq!(j(ConnectResult::AuthFailed { tried: vec!["password".into()] }), serde_json::json!({"kind": "auth_failed", "tried": ["password"]}));
    assert_eq!(j(ConnectResult::Unreachable { reason: "r".into() }), serde_json::json!({"kind": "unreachable", "reason": "r"}));
}

#[test]
fn answers_deserialise_from_the_webview_with_missing_fields() {
    let a: Answers = serde_json::from_str(r#"{"trust_fingerprint":"SHA256:x","password":"p"}"#).unwrap();
    assert_eq!(a.trust_fingerprint.as_deref(), Some("SHA256:x"));
    assert_eq!(a.password.as_ref().map(|p| p.as_str()), Some("p"));
    assert!(a.passphrase.is_none());
    let empty: Answers = serde_json::from_str("{}").unwrap();
    assert!(empty.password.is_none());
}
