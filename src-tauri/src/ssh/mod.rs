//! SSH remote files: connection foundation (config, known_hosts, auth, connection pool).
//!
//! The Tauri commands live here; everything else is in the submodules. Connecting grants no
//! folder access — that is the remote file commands' allow-list.

// Parts of the connection foundation are not used by a command yet (the Connect dialog story).
#![allow(dead_code)]

pub mod allow;
pub mod auth;
pub mod config;
pub mod fs;
pub mod known_hosts;
pub mod pool;
pub mod uri;

#[cfg(test)]
mod test_server;
#[cfg(test)]
mod remote_tests;
#[cfg(test)]
mod tests;

use auth::{Answers, ConnectResult, Env};
use config::SshConfigFile;
use fs::{FolderListing, Remote, RemoteError, RemoteStat, WriteOutcome};
use crate::folder::FolderEntry;
use pool::Pool;
use tauri::{AppHandle, Runtime, State};
use uri::RemotePath;

/// `Host` names from `~/.ssh/config` (wildcard patterns left out); empty when there is no file.
#[tauri::command]
pub async fn ssh_list_hosts(pool: State<'_, Pool>) -> Result<Vec<String>, String> {
    Ok(SshConfigFile::load(&pool.env().config_path).list_hosts())
}

/// Connects and opens an SFTP channel, or returns the one answer still needed (see [`ConnectResult`]).
#[tauri::command]
pub async fn ssh_connect(pool: State<'_, Pool>, target: String, answers: Option<Answers>) -> Result<ConnectResult, String> {
    Ok(pool.connect(&target, answers.unwrap_or_default()).await)
}

/// Closes the session for `host` (what was typed in the Connect box) and takes back its folder grants.
#[tauri::command]
pub async fn ssh_disconnect(pool: State<'_, Pool>, remote: State<'_, Remote>, host: String) -> Result<(), String> {
    let key = pool.key_for(&host).map_err(|e| e.to_string())?;
    remote.allow.revoke(&key);
    pool.disconnect(&key).await;
    Ok(())
}

/// Subfolder names of a folder anywhere on a connected host, for the folder picker. Never files.
#[tauri::command]
pub async fn remote_list_folders(pool: State<'_, Pool>, uri: String) -> Result<FolderListing, RemoteError> {
    fs::list_folders(&pool, &uri).await
}

/// The picked folder joins the allow-list and becomes the navigator root.
#[tauri::command]
pub async fn remote_open_root(pool: State<'_, Pool>, remote: State<'_, Remote>, uri: String) -> Result<(), RemoteError> {
    fs::open_root(&pool, &remote, &uri).await
}

/// Same rows and order as `list_directory`; inside an allowed folder only.
#[tauri::command]
pub async fn remote_list_directory(pool: State<'_, Pool>, remote: State<'_, Remote>, uri: String) -> Result<Vec<FolderEntry>, RemoteError> {
    fs::list_directory(&pool, &remote, &uri).await
}

/// The file's raw bytes, behind a 12-byte header: the server mtime (u32) and size (u64), big-endian.
/// A raw response avoids turning the bytes into a JSON array.
#[tauri::command]
pub async fn remote_read(pool: State<'_, Pool>, remote: State<'_, Remote>, uri: String) -> Result<tauri::ipc::Response, RemoteError> {
    let (stat, bytes) = fs::read(&pool, &remote, &uri).await?;
    Ok(tauri::ipc::Response::new(read_payload(stat, bytes)))
}

pub fn read_payload(stat: RemoteStat, bytes: Vec<u8>) -> Vec<u8> {
    let mut out = Vec::with_capacity(12 + bytes.len());
    out.extend_from_slice(&stat.mtime.to_be_bytes());
    out.extend_from_slice(&stat.size.to_be_bytes());
    out.extend_from_slice(&bytes);
    out
}

/// Saves `text` exactly as given. `expected` is the stat from the last read or save; `force` is Overwrite.
#[tauri::command]
pub async fn remote_write(
    pool: State<'_, Pool>,
    remote: State<'_, Remote>,
    uri: String,
    text: String,
    expected: RemoteStat,
    force: bool,
) -> Result<WriteOutcome, RemoteError> {
    fs::write(&pool, &remote, &uri, &text, expected, force).await
}

/// Backs `pathExists` for remote recents: false when the file is gone or the host cannot be reached.
#[tauri::command]
pub async fn remote_exists<R: Runtime>(app: AppHandle<R>, pool: State<'_, Pool>, remote: State<'_, Remote>, uri: String) -> Result<bool, String> {
    let recorded = crate::is_recent(&app, &uri)?;
    Ok(fs::exists(&pool, &remote, &uri, recorded).await)
}

pub fn is_ssh_path(path: &str) -> bool {
    path.get(..6).is_some_and(|s| s.eq_ignore_ascii_case("ssh://"))
}

/// A recent remote document from an earlier session: its file (only that file) joins the allow-list.
pub fn allow_recent(remote: &Remote, path: &str) -> Result<(), String> {
    let file = RemotePath::parse(path).map_err(|e| e.to_string())?;
    if file.needs_home() {
        return Err("not a resolved path".into());
    }
    remote.allow.grant_file(&file);
    Ok(())
}

pub fn new_pool() -> Pool {
    Pool::new(Env::from_home())
}
