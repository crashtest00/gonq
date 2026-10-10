//! SSH remote files: connection foundation (config, known_hosts, auth, connection pool).
//!
//! The Tauri commands live here; everything else is in the submodules. Connecting grants no
//! folder access — that is the remote file commands' allow-list.

// The pool and `RemotePath` are consumed by the remote file commands (next story).
#![allow(dead_code)]

pub mod auth;
pub mod config;
pub mod known_hosts;
pub mod pool;
pub mod uri;

#[cfg(test)]
mod test_server;
#[cfg(test)]
mod tests;

use auth::{Answers, ConnectResult, Env};
use config::SshConfigFile;
use pool::Pool;
use tauri::State;

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

pub fn new_pool() -> Pool {
    Pool::new(Env::from_home())
}
