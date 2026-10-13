//! Remote files over SFTP: list, read, save, with the allow-list checked on every path.
//!
//! Each function takes the shared [`Pool`] and [`Remote`] state and a `ssh://` URI, and runs on the
//! pooled session, which is reopened once if it was lost. Failures are [`RemoteError`], serialised
//! like `ListError` (`{kind, message}`). A save never leaves a half-written file: the text goes to a
//! temporary file in the same folder and is renamed over the original, and nothing is written when
//! the file changed on the server since it was opened.

use super::allow::{normalize, Allow};
use super::auth::ConnectResult;
use super::pool::{connection_lost, Conn, Pool, PoolError};
use super::uri::{ConnKey, RemotePath};
use crate::folder::{is_markdown, sort_entries, FolderEntry};
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::fs::Metadata;
use russh_sftp::protocol::{FileAttributes, OpenFlags, Packet, StatusCode};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Bigger files are refused rather than read into memory.
pub const MAX_READ: u64 = 32 * 1024 * 1024;
const POSIX_RENAME: &str = "posix-rename@openssh.com";

/// What the server reports for a file. SFTP v3 times are whole seconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteStat {
    pub mtime: u32,
    pub size: u64,
}

impl RemoteStat {
    fn of(m: &Metadata) -> RemoteStat {
        RemoteStat { mtime: m.mtime.unwrap_or(0), size: m.len() }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum RemoteError {
    /// DNS, refused, timeout, or the host could not be reached again after a loss.
    Unreachable(String),
    /// The session needs the user (passphrase, password, host key); the message is `user@host`.
    AuthRequired(String),
    /// The host key differs from `known_hosts`; the message is the line to remove.
    HostKeyChanged(String),
    Disconnected(String),
    NotFound(String),
    PermissionDenied(String),
    /// A folder was expected and the path is something else (not part of the original contract).
    NotAFolder(String),
    /// Outside the folders the user opened, or not a Markdown file where one is required.
    NotAllowed(String),
    Io(String),
}

/// How a save ended. A conflict is an expected answer, not a failure: nothing was written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum WriteOutcome {
    Saved {
        stat: RemoteStat,
        /// Written over the original (truncate and write), so a dropped link could have left it half written.
        in_place: bool,
        /// First in-place save on this host since Gonq started: tell the user once.
        warn: bool,
    },
    Conflict {
        /// The file is gone from the server.
        deleted: bool,
        current: Option<RemoteStat>,
    },
}

/// A folder for the picker: the canonical address of what was listed, and its subfolders' names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FolderListing {
    pub uri: String,
    pub folders: Vec<String>,
}

/// Held in Tauri state beside the pool.
#[derive(Default)]
pub struct Remote {
    pub allow: Allow,
    warned_in_place: Mutex<HashSet<ConnKey>>,
}

impl Remote {
    fn first_in_place(&self, key: &ConnKey) -> bool {
        self.warned_in_place.lock().unwrap_or_else(|e| e.into_inner()).insert(key.clone())
    }
}

type Op<T> = Result<Result<T, RemoteError>, SftpError>;

fn not_allowed(what: &str) -> RemoteError {
    RemoteError::NotAllowed(what.to_string())
}

/// A failed read or write on an open file. `Err` means the link itself failed (the pool reopens it);
/// `Ok` is the command's own failure.
fn file_failure(conn: &Conn, e: std::io::Error, shown: &str) -> Result<RemoteError, SftpError> {
    let inner = e.get_ref().and_then(|i| i.downcast_ref::<SftpError>()).cloned();
    match inner {
        Some(SftpError::Status(s)) => Ok(sftp_error(&SftpError::Status(s), shown)),
        Some(other) => Err(other),
        None if !conn.is_alive() => Err(SftpError::IO(e.to_string())),
        None => Ok(RemoteError::Io(e.to_string())),
    }
}

macro_rules! sem {
    ($e:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => return Ok(Err(e)),
        }
    };
}

macro_rules! file_try {
    ($conn:expr, $shown:expr, $e:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                return match file_failure($conn, e, $shown) {
                    Ok(re) => Ok(Err(re)),
                    Err(lost) => Err(lost),
                }
            }
        }
    };
}

fn sftp_error(e: &SftpError, shown: &str) -> RemoteError {
    match e {
        SftpError::Status(s) if s.status_code == StatusCode::NoSuchFile => RemoteError::NotFound(shown.to_string()),
        SftpError::Status(s) if s.status_code == StatusCode::PermissionDenied => RemoteError::PermissionDenied(shown.to_string()),
        e if connection_lost(e) => RemoteError::Disconnected(format!("Lost connection to {shown}")),
        e => RemoteError::Io(e.to_string()),
    }
}

fn connect_error(result: ConnectResult, key: &ConnKey, was_lost: bool) -> RemoteError {
    match result {
        ConnectResult::HostKeyChanged { known_line, .. } => RemoteError::HostKeyChanged(known_line),
        ConnectResult::Unreachable { .. } if was_lost => RemoteError::Disconnected(format!("Lost connection to {}", key.host)),
        ConnectResult::Unreachable { reason } => RemoteError::Unreachable(reason),
        _ => RemoteError::AuthRequired(key.authority()),
    }
}

fn parse(uri: &str) -> Result<RemotePath, RemoteError> {
    RemotePath::parse(uri).map_err(|e| RemoteError::Io(format!("{uri}: {e}")))
}

/// Runs `op` on the pooled session for `key`.
async fn run<T, F, Fut>(pool: &Pool, key: &ConnKey, op: F) -> Result<T, RemoteError>
where
    F: Fn(Arc<Conn>) -> Fut,
    Fut: Future<Output = Op<T>>,
{
    let started = AtomicBool::new(false);
    let shown = key.authority();
    let outcome = pool
        .with_sftp(key, |conn| {
            started.store(true, Ordering::SeqCst);
            op(conn)
        })
        .await;
    match outcome {
        Ok(inner) => inner,
        Err(PoolError::Op(e)) => Err(sftp_error(&e, &shown)),
        Err(PoolError::Connect(r)) => Err(connect_error(r, key, started.load(Ordering::SeqCst))),
    }
}

/// The path on this host once `~` is resolved, and checked against the allow-list.
fn allowed(conn: &Conn, remote: &Remote, p: &RemotePath, uri: &str) -> Result<RemotePath, RemoteError> {
    let p = p.resolve_home(conn.home());
    if remote.allow.permits(&p) {
        Ok(p)
    } else {
        Err(not_allowed(uri))
    }
}

/// Refuses early, without a connection, what can already be seen to be outside the allow-list.
fn precheck(remote: &Remote, p: &RemotePath, uri: &str) -> Result<(), RemoteError> {
    if !p.needs_home() && !remote.allow.permits(p) {
        return Err(not_allowed(uri));
    }
    Ok(())
}

/// The server's resolved path for `p`, which must still be inside the allow-list.
async fn resolved(conn: &Conn, remote: &Remote, p: &RemotePath, uri: &str) -> Op<String> {
    let real = match conn.sftp().canonicalize(p.path.clone()).await {
        Ok(real) => real,
        Err(SftpError::Status(s)) if s.status_code == StatusCode::NoSuchFile => return Ok(Err(RemoteError::NotFound(uri.to_string()))),
        Err(e) => return Err(e),
    };
    if !remote.allow.permits_real(&p.key, &real) {
        return Ok(Err(not_allowed(uri)));
    }
    Ok(Ok(real))
}

fn join(base: &str, name: &str) -> String {
    if base.ends_with('/') {
        format!("{base}{name}")
    } else {
        format!("{base}/{name}")
    }
}

fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn folder_of(path: &str) -> &str {
    match path.rsplit_once('/') {
        Some(("", _)) => "/",
        Some((dir, _)) => dir,
        None => "/",
    }
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// `remote_open_root`: the folder joins the allow-list and becomes the navigator root.
pub async fn open_root(pool: &Pool, remote: &Remote, uri: &str) -> Result<(), RemoteError> {
    let origin = parse(uri)?;
    let p = &origin;
    run(pool, &p.key, |conn| async move {
        let p = p.resolve_home(conn.home());
        let real = sem!(unfiltered_real(&conn, &p, uri).await?);
        let meta = conn.sftp().metadata(real.clone()).await?;
        if !meta.is_dir() {
            return Ok(Err(RemoteError::NotAFolder(uri.to_string())));
        }
        remote.allow.grant_folder(&p, &real);
        Ok(Ok(()))
    })
    .await
}

/// Like [`resolved`] but without the allow-list: for the folder picker and for granting a root.
async fn unfiltered_real(conn: &Conn, p: &RemotePath, uri: &str) -> Op<String> {
    match conn.sftp().canonicalize(p.path.clone()).await {
        Ok(real) => Ok(Ok(real)),
        Err(SftpError::Status(s)) if s.status_code == StatusCode::NoSuchFile => Ok(Err(RemoteError::NotFound(uri.to_string()))),
        Err(e) => Err(e),
    }
}

/// Whether a directory entry is a folder, following a symlink; `None` when it cannot be told.
async fn entry_is_dir(conn: &Conn, path: &str, attrs: &FileAttributes) -> Option<bool> {
    if attrs.is_symlink() {
        conn.sftp().metadata(path.to_string()).await.ok().map(|m| m.is_dir())
    } else {
        Some(attrs.is_dir())
    }
}

async fn read_entries(conn: &Conn, real: &str, uri: &str) -> Op<Vec<(String, bool)>> {
    let meta = conn.sftp().metadata(real.to_string()).await?;
    if !meta.is_dir() {
        return Ok(Err(RemoteError::NotAFolder(uri.to_string())));
    }
    let mut rows = Vec::new();
    for entry in conn.sftp().read_dir(real.to_string()).await? {
        let name = entry.file_name();
        if is_hidden(&name) {
            continue;
        }
        let attrs = entry.metadata();
        // An entry that vanished or cannot be statted is skipped, not fatal.
        let Some(is_dir) = entry_is_dir(conn, &join(real, &name), &attrs).await else { continue };
        rows.push((name, is_dir));
    }
    Ok(Ok(rows))
}

/// `remote_list_folders`: subfolder names only, anywhere on a connected host. Never files.
pub async fn list_folders(pool: &Pool, uri: &str) -> Result<FolderListing, RemoteError> {
    let origin = parse(uri)?;
    let p = &origin;
    run(pool, &p.key, |conn| async move {
        let p = p.resolve_home(conn.home());
        let real = sem!(unfiltered_real(&conn, &p, uri).await?);
        let rows = sem!(read_entries(&conn, &real, uri).await?);
        let mut folders: Vec<String> = rows.into_iter().filter(|(_, is_dir)| *is_dir).map(|(n, _)| n).collect();
        folders.sort_by_cached_key(|n| n.to_lowercase());
        let canonical = RemotePath { key: p.key.clone(), path: real };
        Ok(Ok(FolderListing { uri: canonical.to_string(), folders }))
    })
    .await
}

/// `remote_list_directory`: the navigator's rows, the same filter and order as a local folder.
pub async fn list_directory(pool: &Pool, remote: &Remote, uri: &str) -> Result<Vec<FolderEntry>, RemoteError> {
    let origin = parse(uri)?;
    let p = &origin;
    precheck(remote, &p, uri)?;
    run(pool, &p.key, |conn| async move {
        let p = sem!(allowed(&conn, remote, &p, uri));
        let real = sem!(resolved(&conn, remote, &p, uri).await?);
        let rows = sem!(read_entries(&conn, &real, uri).await?);
        let base = normalize(&p.path);
        let mut entries: Vec<FolderEntry> = rows
            .into_iter()
            .filter(|(name, is_dir)| *is_dir || is_markdown(name))
            .map(|(name, is_dir)| {
                let path = RemotePath { key: p.key.clone(), path: join(&base, &name) }.to_string();
                FolderEntry { name, path, is_dir }
            })
            .collect();
        sort_entries(&mut entries);
        Ok(Ok(entries))
    })
    .await
}

/// `remote_read`: the file's bytes exactly as stored, with the stat they were read at.
pub async fn read(pool: &Pool, remote: &Remote, uri: &str) -> Result<(RemoteStat, Vec<u8>), RemoteError> {
    let origin = parse(uri)?;
    let p = &origin;
    precheck(remote, &p, uri)?;
    run(pool, &p.key, |conn| async move {
        let p = sem!(allowed(&conn, remote, &p, uri));
        let real = sem!(resolved(&conn, remote, &p, uri).await?);
        // Gonq opens Markdown only: a recorded recent cannot be used to read other files, and a
        // link cannot lead to one.
        if !is_markdown(base_name(&real)) {
            return Ok(Err(not_allowed(&format!("{uri}: only Markdown files can be read"))));
        }
        let mut file = conn.sftp().open(real).await?;
        let meta = file.metadata().await?;
        if meta.is_dir() {
            return Ok(Err(RemoteError::Io(format!("{uri} is a folder"))));
        }
        if meta.len() > MAX_READ {
            return Ok(Err(RemoteError::Io(format!("{uri} is larger than {} MB", MAX_READ / 1024 / 1024))));
        }
        let mut bytes = Vec::with_capacity(meta.len() as usize);
        file_try!(&conn, uri, (&mut file).take(MAX_READ + 1).read_to_end(&mut bytes).await);
        let _ = file.close().await;
        if bytes.len() as u64 > MAX_READ {
            return Ok(Err(RemoteError::Io(format!("{uri} is larger than {} MB", MAX_READ / 1024 / 1024))));
        }
        Ok(Ok((RemoteStat::of(&meta), bytes)))
    })
    .await
}

/// `remote_exists`: false when the file is not there or the host cannot be reached without asking
/// the user anything.
pub async fn exists(pool: &Pool, remote: &Remote, uri: &str, recorded: bool) -> bool {
    let Ok(origin) = parse(uri) else { return false };
    let p = &origin;
    if !recorded && !p.needs_home() && !remote.allow.permits(&p) {
        return false;
    }
    let found = run(pool, &p.key, |conn| async move {
        let p = p.resolve_home(conn.home());
        if !recorded && !remote.allow.permits(&p) {
            return Ok(Ok(false));
        }
        match conn.sftp().metadata(p.path.clone()).await {
            Ok(_) => Ok(Ok(true)),
            Err(SftpError::Status(s)) if s.status_code == StatusCode::NoSuchFile => Ok(Ok(false)),
            Err(e) => Err(e),
        }
    })
    .await;
    found.unwrap_or(false)
}

/// `remote_write`: see the module docs. `expected` is the stat the tab last saw; `force` skips the
/// comparison (the user chose Overwrite).
pub async fn write(
    pool: &Pool,
    remote: &Remote,
    uri: &str,
    text: &str,
    expected: RemoteStat,
    force: bool,
) -> Result<WriteOutcome, RemoteError> {
    let origin = parse(uri)?;
    let p = &origin;
    if !is_markdown(base_name(&p.path)) {
        return Err(not_allowed(&format!("{uri}: only Markdown files can be written")));
    }
    precheck(remote, &p, uri)?;
    // Set once the rename (or the in-place write) may have reached the server: a lost link after
    // that point cannot be retried, since the retry would see our own change as a conflict.
    let committed = AtomicBool::new(false);
    let committed = &committed;
    run(pool, &p.key, |conn| async move {
        committed.store(false, Ordering::SeqCst);
        let p = sem!(allowed(&conn, remote, &p, uri));
        let sftp = conn.sftp();
        // A link is followed, so the target is replaced and the link stays a link.
        let target = match sftp.canonicalize(p.path.clone()).await {
            Ok(real) => real,
            Err(SftpError::Status(s)) if s.status_code == StatusCode::NoSuchFile => normalize(&p.path),
            Err(e) => return Err(e),
        };
        if !remote.allow.permits_real(&p.key, &target) {
            return Ok(Err(not_allowed(uri)));
        }
        if !is_markdown(base_name(&target)) {
            return Ok(Err(not_allowed(&format!("{uri}: only Markdown files can be written"))));
        }
        let current = match sftp.metadata(target.clone()).await {
            Ok(m) if m.is_dir() => return Ok(Err(RemoteError::Io(format!("{uri} is a folder")))),
            Ok(m) => Some(m),
            Err(SftpError::Status(s)) if s.status_code == StatusCode::NoSuchFile => None,
            Err(e) => return Err(e),
        };
        if !force {
            match &current {
                None => return Ok(Ok(WriteOutcome::Conflict { deleted: true, current: None })),
                Some(m) if RemoteStat::of(m) != expected => {
                    return Ok(Ok(WriteOutcome::Conflict { deleted: false, current: Some(RemoteStat::of(m)) }))
                }
                Some(_) => {}
            }
        }
        let mode = current.as_ref().and_then(|m| m.permissions).map(|m| m & 0o7777);
        // A read-only file is not silently replaced by a writable copy.
        if mode.is_some_and(|m| m & 0o200 == 0) {
            return Ok(Err(RemoteError::PermissionDenied(uri.to_string())));
        }
        let atomic = sem!(save_atomically(&conn, &target, text.as_bytes(), mode, uri, committed).await?);
        let in_place = !atomic;
        if in_place {
            committed.store(true, Ordering::SeqCst);
            match save_in_place(&conn, &target, text.as_bytes(), mode, uri).await {
                Ok(done) => sem!(done),
                Err(e) => return Ok(Err(sftp_error(&e, uri))),
            }
        }
        let after = match sftp.metadata(target.clone()).await {
            Ok(m) => m,
            Err(e) if committed.load(Ordering::SeqCst) => return Ok(Err(sftp_error(&e, uri))),
            Err(e) => return Err(e),
        };
        if !in_place {
            remove_stale_temps(&conn, &target, after.mtime.unwrap_or(0)).await;
        }
        let warn = in_place && remote.first_in_place(&p.key);
        Ok(Ok(WriteOutcome::Saved { stat: RemoteStat::of(&after), in_place, warn }))
    })
    .await
}

/// Unpredictable enough for a temporary name; `EXCLUDE` at creation catches the rest.
fn random_suffix() -> u32 {
    use std::hash::{BuildHasher, Hasher};
    std::collections::hash_map::RandomState::new().build_hasher().finish() as u32
}

fn temp_prefix(name: &str) -> String {
    format!(".{name}.gonq-")
}

/// Writes to a temporary file beside `target` and renames it into place. `Ok(false)` means this
/// server or folder cannot do that and nothing was written, so the caller writes in place.
async fn save_atomically(conn: &Conn, target: &str, bytes: &[u8], mode: Option<u32>, uri: &str, committed: &AtomicBool) -> Op<bool> {
    let Some(ext) = conn.ext().filter(|e| e.offers(POSIX_RENAME)) else { return Ok(Ok(false)) };
    let sftp = conn.sftp();
    let attrs = FileAttributes { permissions: mode, ..FileAttributes::empty() };
    let mut tries = 0;
    let (temp, mut file) = loop {
        let temp = format!("{}{:08x}.tmp", join(folder_of(target), &temp_prefix(base_name(target))), random_suffix());
        let flags = OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUDE;
        match sftp.open_with_flags_and_attributes(temp.clone(), flags, attrs.clone()).await {
            Ok(f) => break (temp, f),
            // The folder is not writable (the file may be): no temporary file can be made there.
            Err(SftpError::Status(s)) if s.status_code == StatusCode::PermissionDenied => return Ok(Ok(false)),
            // The name is taken (EXCLUDE failed): try once more with a fresh one.
            Err(SftpError::Status(s)) if tries == 0 && s.status_code != StatusCode::NoSuchFile => tries += 1,
            Err(e) => return Err(e),
        }
    };
    let written: Op<()> = async {
        file_try!(conn, uri, file.write_all(bytes).await);
        // Flushes to disk when the server offers fsync (a no-op otherwise).
        file.sync_all().await?;
        file_try!(conn, uri, file.close().await);
        // The server's umask may have trimmed the bits asked for at creation.
        if mode.is_some() {
            let _ = sftp.set_metadata(temp.clone(), attrs.clone()).await;
        }
        committed.store(true, Ordering::SeqCst);
        if let Err(e) = posix_rename(&ext.raw, &temp, target).await {
            return Ok(Err(sftp_error(&e, uri)));
        }
        Ok(Ok(()))
    }
    .await;
    match written {
        Ok(Ok(())) => Ok(Ok(true)),
        // The original is untouched; the temporary file goes.
        Ok(Err(e)) => {
            let _ = sftp.remove_file(temp).await;
            Ok(Err(e))
        }
        Err(e) => {
            let _ = sftp.remove_file(temp).await;
            Err(e)
        }
    }
}

#[derive(Serialize)]
struct PosixRename<'a> {
    oldpath: &'a str,
    newpath: &'a str,
}

async fn posix_rename(raw: &russh_sftp::client::RawSftpSession, from: &str, to: &str) -> Result<(), SftpError> {
    let data = russh_sftp::ser::to_bytes(&PosixRename { oldpath: from, newpath: to })?.to_vec();
    match raw.extended(POSIX_RENAME, data).await? {
        Packet::Status(s) if s.status_code == StatusCode::Ok => Ok(()),
        Packet::Status(s) => Err(s.into()),
        _ => Err(SftpError::UnexpectedPacket),
    }
}

/// Truncate and write. Not atomic: the caller says so to the user.
async fn save_in_place(conn: &Conn, target: &str, bytes: &[u8], mode: Option<u32>, uri: &str) -> Op<()> {
    let attrs = FileAttributes { permissions: mode, ..FileAttributes::empty() };
    let mut file = conn
        .sftp()
        .open_with_flags_and_attributes(target.to_string(), OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE, attrs)
        .await?;
    file_try!(conn, uri, file.write_all(bytes).await);
    file.sync_all().await?;
    file_try!(conn, uri, file.close().await);
    Ok(Ok(()))
}

/// Temporary files earlier failed saves left in the folder of `target`: any `.*.gonq-*.tmp` more
/// than ten minutes older than the file just saved (`now`, the server's own clock), so a save in
/// flight from another window is left alone. Best effort.
async fn remove_stale_temps(conn: &Conn, target: &str, now: u32) {
    const STALE_SECS: u32 = 10 * 60;
    let folder = folder_of(target);
    let Ok(entries) = conn.sftp().read_dir(folder.to_string()).await else { return };
    for entry in entries {
        let name = entry.file_name();
        let is_temp = name.starts_with('.') && name.contains(".gonq-") && name.ends_with(".tmp");
        let old = entry.metadata().mtime.is_some_and(|m| m.saturating_add(STALE_SECS) < now);
        if is_temp && old {
            let _ = conn.sftp().remove_file(join(folder, &name)).await;
        }
    }
}
