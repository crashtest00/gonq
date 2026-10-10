//! An in-process SSH server with SFTP for tests: a random port, host key, accepted client keys
//! and password chosen per test, no real `sshd` and no Docker. The remote file commands extend
//! its SFTP handler (`Sftp`) with file operations over `root`.

use russh::keys::ssh_key::{Algorithm, PrivateKey, PublicKey};
use russh::server::{Auth, Handler, Msg, Server, Session};
use russh::{Channel, ChannelId, MethodKind, MethodSet};
use russh_sftp::protocol::{File, Name, Status, StatusCode, Version};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;

#[derive(Clone)]
pub struct Policy {
    /// Client keys the server accepts for public key login.
    pub allowed_keys: Vec<PublicKey>,
    /// The password the server accepts, if it offers password login at all.
    pub password: Option<String>,
    /// What `realpath(".")` answers, and the folder SFTP paths are served from.
    pub root: PathBuf,
}

pub struct TestServer {
    pub port: u16,
    pub host_key: PrivateKey,
    /// Sessions that completed key exchange and asked for authentication.
    pub connections: Arc<AtomicUsize>,
    /// Every `auth_password` call the server has seen.
    pub password_tries: Arc<AtomicUsize>,
    handle: russh::server::RunningServerHandle,
}

pub fn new_key() -> PrivateKey {
    PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap()
}

impl TestServer {
    pub async fn start(host_key: PrivateKey, policy: Policy) -> TestServer {
        Self::start_on(0, host_key, policy).await
    }

    /// Starts on `port` (0 for any free port). Used to bring a stopped server back at the same address.
    pub async fn start_on(port: u16, host_key: PrivateKey, policy: Policy) -> TestServer {
        let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let mut methods = Vec::new();
        if !policy.allowed_keys.is_empty() {
            methods.push(MethodKind::PublicKey);
        }
        if policy.password.is_some() {
            methods.push(MethodKind::Password);
        }
        let config = russh::server::Config {
            keys: vec![host_key.clone()],
            methods: MethodSet::from(methods.as_slice()),
            auth_rejection_time: Duration::from_millis(1),
            auth_rejection_time_initial: Some(Duration::ZERO),
            ..Default::default()
        };
        let connections = Arc::new(AtomicUsize::new(0));
        let password_tries = Arc::new(AtomicUsize::new(0));
        let mut server = Srv { policy, connections: connections.clone(), password_tries: password_tries.clone() };
        let (handle_tx, handle_rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let running = server.run_on_socket(Arc::new(config), &listener);
            let _ = handle_tx.send(running.handle());
            let _ = running.await;
        });
        let handle = handle_rx.await.unwrap();
        TestServer { port, host_key, connections, password_tries, handle }
    }

    /// Stops listening and drops every open session.
    pub fn stop(&self) {
        self.handle.shutdown("test server stopped".into());
    }
}

#[derive(Clone)]
struct Srv {
    policy: Policy,
    connections: Arc<AtomicUsize>,
    password_tries: Arc<AtomicUsize>,
}

impl Server for Srv {
    type Handler = Conn;

    fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Conn {
        self.connections.fetch_add(1, Ordering::SeqCst);
        Conn { srv: self.clone(), channels: HashMap::new() }
    }
}

struct Conn {
    srv: Srv,
    channels: HashMap<ChannelId, Channel<Msg>>,
}

impl Handler for Conn {
    type Error = test_error::Error;

    async fn auth_password(&mut self, _user: &str, password: &str) -> Result<Auth, Self::Error> {
        self.srv.password_tries.fetch_add(1, Ordering::SeqCst);
        if self.srv.policy.password.as_deref() == Some(password) {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn auth_publickey_offered(&mut self, _user: &str, key: &PublicKey) -> Result<Auth, Self::Error> {
        Ok(self.key_verdict(key))
    }

    async fn auth_publickey(&mut self, _user: &str, key: &PublicKey) -> Result<Auth, Self::Error> {
        Ok(self.key_verdict(key))
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }

    async fn subsystem_request(&mut self, id: ChannelId, name: &str, session: &mut Session) -> Result<(), Self::Error> {
        if name == "sftp" {
            if let Some(channel) = self.channels.remove(&id) {
                session.channel_success(id)?;
                let sftp = Sftp { root: self.srv.policy.root.clone() };
                russh_sftp::server::run(channel.into_stream(), sftp).await;
                return Ok(());
            }
        }
        session.channel_failure(id)?;
        Ok(())
    }
}

impl Conn {
    fn key_verdict(&self, key: &PublicKey) -> Auth {
        if self.srv.policy.allowed_keys.iter().any(|k| k.key_data() == key.key_data()) {
            Auth::Accept
        } else {
            Auth::reject()
        }
    }
}

struct Sftp {
    root: PathBuf,
}

impl russh_sftp::server::Handler for Sftp {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn init(&mut self, _version: u32, _extensions: HashMap<String, String>) -> Result<Version, Self::Error> {
        Ok(Version::new())
    }

    async fn close(&mut self, id: u32, _handle: String) -> Result<Status, Self::Error> {
        Ok(Status { id, status_code: StatusCode::Ok, error_message: "Ok".into(), language_tag: "en-US".into() })
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        let answer = if path == "." { self.root.to_string_lossy().replace('\\', "/") } else { path };
        Ok(Name { id, files: vec![File::dummy(answer)] })
    }
}

/// The server handler only needs an error type that russh can build from its own errors.
mod test_error {
    #[derive(Debug)]
    pub struct Error(pub String);

    impl From<russh::Error> for Error {
        fn from(e: russh::Error) -> Self {
            Error(e.to_string())
        }
    }
}
