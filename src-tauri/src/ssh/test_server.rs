//! An in-process SSH server with SFTP for tests: a random port, host key, accepted client keys
//! and password chosen per test, no real `sshd` and no Docker. Its SFTP handler (`Sftp`) serves the
//! real file system under `root`.

use russh::keys::ssh_key::{Algorithm, PrivateKey, PublicKey};
use russh::server::{Auth, Handler, Msg, Server, Session};
use russh::{Channel, ChannelId, MethodKind, MethodSet};
use russh_sftp::protocol::{Attrs, Data, File, FileAttributes, Handle, Name, OpenFlags, Packet, Status, StatusCode, Version};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;

#[derive(Clone, Default)]
pub struct Policy {
    /// Client keys the server accepts for public key login.
    pub allowed_keys: Vec<PublicKey>,
    /// The password the server accepts, if it offers password login at all.
    pub password: Option<String>,
    /// What `realpath(".")` answers, and the folder SFTP paths are served from.
    pub root: PathBuf,
    /// Failed attempts after which the server hangs up (`MaxAuthTries`); the library default when `None`.
    pub max_auth_attempts: Option<usize>,
    /// Never answer the first authentication request, as a server stalling after key exchange.
    pub stall_auth: bool,
    /// Leave `posix-rename@openssh.com` out of the SFTP version reply.
    pub no_posix_rename: bool,
    /// Leave `fsync@openssh.com` out of the SFTP version reply.
    pub no_fsync: bool,
    /// Drop every session when the Nth SFTP write arrives (counted over the server's life), unanswered.
    pub kill_on_write: Option<usize>,
    /// Fail this many `EXCLUDE` opens per session as a taken name, whatever the real file system says.
    pub exclude_collisions: usize,
    /// Perform a `posix-rename` and then drop every session before answering it.
    pub kill_after_rename: bool,
}

pub struct TestServer {
    pub port: u16,
    pub host_key: PrivateKey,
    /// Sessions that completed key exchange and asked for authentication.
    pub connections: Arc<AtomicUsize>,
    /// Every `auth_password` call the server has seen.
    pub password_tries: Arc<AtomicUsize>,
    /// SFTP writes received.
    pub writes: Arc<AtomicUsize>,
    handle: KillHandle,
}

struct KillHandle(Arc<tokio::sync::Notify>);

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
            max_auth_attempts: policy.max_auth_attempts.unwrap_or(10),
            ..Default::default()
        };
        let connections = Arc::new(AtomicUsize::new(0));
        let password_tries = Arc::new(AtomicUsize::new(0));
        let writes = Arc::new(AtomicUsize::new(0));
        let kill = Arc::new(tokio::sync::Notify::new());
        let mut server =
            Srv { policy, connections: connections.clone(), password_tries: password_tries.clone(), writes: writes.clone(), kill: kill.clone() };
        let (up_tx, up_rx) = tokio::sync::oneshot::channel();
        let stopper = kill.clone();
        tokio::spawn(async move {
            let running = server.run_on_socket(Arc::new(config), &listener);
            let handle = running.handle();
            let _ = up_tx.send(());
            tokio::spawn(async move {
                stopper.notified().await;
                handle.shutdown("test server stopped".into());
            });
            let _ = running.await;
        });
        up_rx.await.unwrap();
        TestServer { port, host_key, connections, password_tries, writes, handle: KillHandle(kill) }
    }

    /// Stops listening and drops every open session.
    pub fn stop(&self) {
        self.handle.0.notify_one();
    }
}

#[derive(Clone)]
struct Srv {
    policy: Policy,
    connections: Arc<AtomicUsize>,
    password_tries: Arc<AtomicUsize>,
    writes: Arc<AtomicUsize>,
    kill: Arc<tokio::sync::Notify>,
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

    async fn auth_none(&mut self, _user: &str) -> Result<Auth, Self::Error> {
        if self.srv.policy.stall_auth {
            std::future::pending::<()>().await;
        }
        Ok(Auth::reject())
    }

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
                let sftp = Sftp::new(&self.srv);
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

/// SFTP over the real file system: absolute paths are served as they are, relative ones from `root`.
struct Sftp {
    root: PathBuf,
    posix_rename: bool,
    fsync: bool,
    kill_on_write: Option<usize>,
    collisions: AtomicUsize,
    kill_after_rename: bool,
    writes: Arc<AtomicUsize>,
    kill: Arc<tokio::sync::Notify>,
    next_handle: u32,
    handles: HashMap<String, Open>,
}

enum Open {
    File(std::fs::File),
    Dir(Vec<(String, std::fs::Metadata)>),
}

impl Sftp {
    fn new(srv: &Srv) -> Sftp {
        Sftp {
            root: srv.policy.root.clone(),
            posix_rename: !srv.policy.no_posix_rename,
            fsync: !srv.policy.no_fsync,
            kill_on_write: srv.policy.kill_on_write,
            collisions: AtomicUsize::new(srv.policy.exclude_collisions),
            kill_after_rename: srv.policy.kill_after_rename,
            writes: srv.writes.clone(),
            kill: srv.kill.clone(),
            next_handle: 0,
            handles: HashMap::new(),
        }
    }

    fn path(&self, p: &str) -> PathBuf {
        let p = std::path::Path::new(p);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            self.root.join(p)
        }
    }

    fn new_handle(&mut self, open: Open) -> String {
        self.next_handle += 1;
        let h = format!("h{}", self.next_handle);
        self.handles.insert(h.clone(), open);
        h
    }
}

fn ok(id: u32) -> Status {
    Status { id, status_code: StatusCode::Ok, error_message: "Ok".into(), language_tag: "en-US".into() }
}

fn code(e: std::io::Error) -> StatusCode {
    match e.kind() {
        std::io::ErrorKind::NotFound => StatusCode::NoSuchFile,
        std::io::ErrorKind::PermissionDenied => StatusCode::PermissionDenied,
        _ => StatusCode::Failure,
    }
}

#[cfg(unix)]
fn read_at(f: &std::fs::File, buf: &mut [u8], offset: u64) -> std::io::Result<usize> {
    std::os::unix::fs::FileExt::read_at(f, buf, offset)
}

#[cfg(not(unix))]
fn read_at(f: &std::fs::File, buf: &mut [u8], offset: u64) -> std::io::Result<usize> {
    std::os::windows::fs::FileExt::seek_read(f, buf, offset)
}

#[cfg(unix)]
fn write_all_at(f: &std::fs::File, data: &[u8], offset: u64) -> std::io::Result<()> {
    std::os::unix::fs::FileExt::write_all_at(f, data, offset)
}

#[cfg(not(unix))]
fn write_all_at(f: &std::fs::File, mut data: &[u8], mut offset: u64) -> std::io::Result<()> {
    while !data.is_empty() {
        let n = std::os::windows::fs::FileExt::seek_write(f, data, offset)?;
        data = &data[n..];
        offset += n as u64;
    }
    Ok(())
}

fn attrs_of(m: &std::fs::Metadata) -> FileAttributes {
    FileAttributes::from(m)
}

fn strings(data: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = data;
    while rest.len() >= 4 {
        let n = u32::from_be_bytes(rest[..4].try_into().unwrap()) as usize;
        out.push(String::from_utf8_lossy(&rest[4..4 + n]).into_owned());
        rest = &rest[4 + n..];
    }
    out
}

impl russh_sftp::server::Handler for Sftp {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn init(&mut self, _version: u32, _extensions: HashMap<String, String>) -> Result<Version, Self::Error> {
        let mut v = Version::new();
        if self.posix_rename {
            v.extensions.insert("posix-rename@openssh.com".into(), "1".into());
        }
        if self.fsync {
            v.extensions.insert("fsync@openssh.com".into(), "1".into());
        }
        Ok(v)
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, Self::Error> {
        self.handles.remove(&handle);
        Ok(ok(id))
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        let answer = if path == "." {
            self.root.to_string_lossy().replace('\\', "/")
        } else {
            let full = self.path(&path);
            // Like OpenSSH: a path that exists is resolved (symlinks, `..`); one that does not is only cleaned.
            match std::fs::canonicalize(&full) {
                Ok(real) => real.to_string_lossy().replace('\\', "/"),
                Err(_) if full.parent().is_some_and(|p| p.exists()) => full.to_string_lossy().into_owned(),
                Err(e) => return Err(code(e)),
            }
        };
        Ok(Name { id, files: vec![File::dummy(answer)] })
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let m = std::fs::metadata(self.path(&path)).map_err(code)?;
        Ok(Attrs { id, attrs: attrs_of(&m) })
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let m = std::fs::symlink_metadata(self.path(&path)).map_err(code)?;
        Ok(Attrs { id, attrs: attrs_of(&m) })
    }

    async fn fstat(&mut self, id: u32, handle: String) -> Result<Attrs, Self::Error> {
        match self.handles.get(&handle) {
            Some(Open::File(f)) => Ok(Attrs { id, attrs: attrs_of(&f.metadata().map_err(code)?) }),
            _ => Err(StatusCode::Failure),
        }
    }

    async fn setstat(&mut self, id: u32, path: String, attrs: FileAttributes) -> Result<Status, Self::Error> {
        #[cfg(unix)]
        if let Some(mode) = attrs.permissions {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(self.path(&path), std::fs::Permissions::from_mode(mode & 0o7777)).map_err(code)?;
        }
        #[cfg(not(unix))]
        let _ = (&path, &attrs);
        Ok(ok(id))
    }

    async fn fsetstat(&mut self, id: u32, handle: String, attrs: FileAttributes) -> Result<Status, Self::Error> {
        match self.handles.get(&handle) {
            Some(Open::File(f)) => {
                #[cfg(unix)]
                if let Some(mode) = attrs.permissions {
                    use std::os::unix::fs::PermissionsExt;
                    f.set_permissions(std::fs::Permissions::from_mode(mode & 0o7777)).map_err(code)?;
                }
                #[cfg(not(unix))]
                let _ = (f, &attrs);
                Ok(ok(id))
            }
            _ => Err(StatusCode::Failure),
        }
    }

    async fn open(&mut self, id: u32, filename: String, pflags: OpenFlags, attrs: FileAttributes) -> Result<Handle, Self::Error> {
        if pflags.contains(OpenFlags::EXCLUDE) && self.collisions.load(Ordering::SeqCst) > 0 {
            self.collisions.fetch_sub(1, Ordering::SeqCst);
            return Err(StatusCode::Failure);
        }
        let mut o = std::fs::OpenOptions::new();
        o.read(pflags.contains(OpenFlags::READ));
        o.write(pflags.contains(OpenFlags::WRITE));
        o.append(pflags.contains(OpenFlags::APPEND));
        o.truncate(pflags.contains(OpenFlags::TRUNCATE));
        if pflags.contains(OpenFlags::EXCLUDE) {
            o.create_new(true);
        } else {
            o.create(pflags.contains(OpenFlags::CREATE));
        }
        #[cfg(unix)]
        if let Some(mode) = attrs.permissions {
            use std::os::unix::fs::OpenOptionsExt;
            o.mode(mode & 0o7777);
        }
        #[cfg(not(unix))]
        let _ = &attrs;
        let file = o.open(self.path(&filename)).map_err(code)?;
        Ok(Handle { id, handle: self.new_handle(Open::File(file)) })
    }

    async fn read(&mut self, id: u32, handle: String, offset: u64, len: u32) -> Result<Data, Self::Error> {
        let Some(Open::File(f)) = self.handles.get(&handle) else { return Err(StatusCode::Failure) };
        let mut buf = vec![0u8; len as usize];
        let n = read_at(f, &mut buf, offset).map_err(code)?;
        if n == 0 {
            return Err(StatusCode::Eof);
        }
        buf.truncate(n);
        Ok(Data { id, data: buf })
    }

    async fn write(&mut self, id: u32, handle: String, offset: u64, data: Vec<u8>) -> Result<Status, Self::Error> {
        let seen = self.writes.fetch_add(1, Ordering::SeqCst) + 1;
        if self.kill_on_write == Some(seen) {
            self.kill.notify_one();
            std::future::pending::<()>().await;
        }
        let Some(Open::File(f)) = self.handles.get(&handle) else { return Err(StatusCode::Failure) };
        write_all_at(f, &data, offset).map_err(code)?;
        Ok(ok(id))
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, Self::Error> {
        let mut entries = Vec::new();
        for item in std::fs::read_dir(self.path(&path)).map_err(code)? {
            let item = item.map_err(code)?;
            let m = std::fs::symlink_metadata(item.path()).map_err(code)?;
            entries.push((item.file_name().to_string_lossy().into_owned(), m));
        }
        Ok(Handle { id, handle: self.new_handle(Open::Dir(entries)) })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        let Some(Open::Dir(entries)) = self.handles.get_mut(&handle) else { return Err(StatusCode::Failure) };
        if entries.is_empty() {
            return Err(StatusCode::Eof);
        }
        let files = entries.drain(..).map(|(name, m)| File::new(name, attrs_of(&m))).collect();
        Ok(Name { id, files })
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, Self::Error> {
        std::fs::remove_file(self.path(&filename)).map_err(code)?;
        Ok(ok(id))
    }

    async fn mkdir(&mut self, id: u32, path: String, _attrs: FileAttributes) -> Result<Status, Self::Error> {
        std::fs::create_dir(self.path(&path)).map_err(code)?;
        Ok(ok(id))
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, Self::Error> {
        std::fs::remove_dir(self.path(&path)).map_err(code)?;
        Ok(ok(id))
    }

    /// SFTP v3 `rename` refuses to replace an existing file, as OpenSSH does.
    async fn rename(&mut self, id: u32, oldpath: String, newpath: String) -> Result<Status, Self::Error> {
        let new = self.path(&newpath);
        if new.exists() {
            return Err(StatusCode::Failure);
        }
        std::fs::rename(self.path(&oldpath), new).map_err(code)?;
        Ok(ok(id))
    }

    async fn readlink(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        let target = std::fs::read_link(self.path(&path)).map_err(code)?;
        Ok(Name { id, files: vec![File::dummy(target.to_string_lossy().into_owned())] })
    }

    async fn extended(&mut self, id: u32, request: String, data: Vec<u8>) -> Result<Packet, Self::Error> {
        match request.as_str() {
            "posix-rename@openssh.com" if self.posix_rename => {
                let paths = strings(&data);
                std::fs::rename(self.path(&paths[0]), self.path(&paths[1])).map_err(code)?;
                if self.kill_after_rename {
                    self.kill.notify_one();
                    std::future::pending::<()>().await;
                }
                Ok(Packet::Status(ok(id)))
            }
            "fsync@openssh.com" if self.fsync => Ok(Packet::Status(ok(id))),
            _ => Err(StatusCode::OpUnsupported),
        }
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
