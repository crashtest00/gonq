//! GitHub sign-in (OAuth device flow), token storage and a small REST client.
//!
//! Native on purpose: GitHub's token endpoints send no CORS headers, and the token must never
//! reach JS. `device_code` and the access token stay in Rust; commands return only the user
//! code, the verification URL, timings, the login and a signed-in/out status.
//!
//! The token lives in the OS keychain ([`store`]). Without one (Linux without a secret service)
//! it is held in memory for the running session only ("session_only"). It is never written to a
//! file, never logged, and never part of an error ([`error`]).

// Parts of the REST client are for later stories (repo/branch/file/PR endpoints).
#![allow(dead_code)]

pub mod api;
pub mod error;
pub mod flow;
pub mod repos;
pub mod store;

#[cfg(test)]
mod fake_github;
#[cfg(test)]
mod tests;

use error::GithubError;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use store::{KeyringStore, TokenStore};
use tauri::State;
use tokio::sync::watch;
use zeroize::Zeroizing;

/// Public OAuth app id (device flow needs no client secret).
pub const CLIENT_ID: &str = "Ov23liKabMQhRPtbIDiu";
pub const SCOPE: &str = "repo";

/// A token or device code: zeroed on drop, and never printed by `Debug`.
#[derive(Clone)]
pub struct Secret(Zeroizing<String>);

impl Secret {
    pub fn new(s: impl Into<String>) -> Self {
        Secret(Zeroizing::new(s.into()))
    }
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret([redacted])")
    }
}

/// Endpoints and timing, injectable so tests can point at a local server.
#[derive(Debug, Clone)]
pub struct Config {
    pub client_id: String,
    pub device_code_url: String,
    pub token_url: String,
    /// The only origin the token is ever sent to (and pagination links must stay on).
    pub api_base: String,
    /// One "second" of GitHub's `interval`/`expires_in`/`slow_down` arithmetic.
    pub time_unit: Duration,
}

impl Config {
    pub fn production() -> Self {
        Config {
            client_id: CLIENT_ID.into(),
            device_code_url: "https://github.com/login/device/code".into(),
            token_url: "https://github.com/login/oauth/access_token".into(),
            api_base: "https://api.github.com".into(),
            time_unit: Duration::from_secs(1),
        }
    }
}

struct Pending {
    device_code: Secret,
    interval: u64,
    deadline: Instant,
    id: u64,
    /// Dropping the sender (a newer start/poll, or sign out) cancels the poll loop.
    cancel: watch::Sender<()>,
}

#[derive(Default)]
struct Inner {
    pending: Option<Pending>,
    next_id: u64,
    /// The token when no keychain could hold it.
    session: Option<Secret>,
    /// The login last seen from `GET /user`, for when GitHub cannot be reached.
    login: Option<String>,
}

pub struct Github {
    cfg: Config,
    http: reqwest::Client,
    store: Arc<dyn TokenStore>,
    inner: Mutex<Inner>,
}

impl Github {
    pub fn new(cfg: Config, store: Arc<dyn TokenStore>) -> Self {
        // Pin the ring provider (no C toolchain needed); ignore "already installed".
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = reqwest::Client::builder()
            .user_agent(concat!("Gonq/", env!("CARGO_PKG_VERSION")))
            // A redirect must never carry the token to another host.
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(30))
            .build()
            .expect("http client");
        Github { cfg, http, store, inner: Mutex::new(Inner::default()) }
    }

    pub fn production() -> Self {
        Self::new(Config::production(), Arc::new(KeyringStore))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// The token in use: this session's, else the keychain's. `None` when signed out or there is
    /// no keychain.
    async fn token(&self) -> Result<Option<Secret>, GithubError> {
        if let Some(t) = self.lock().session.clone() {
            return Ok(Some(t));
        }
        match self.blocking_store(|s| s.get()).await {
            Ok(t) => Ok(t.map(Secret::new)),
            Err(store::StoreError::Unavailable) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Keychain calls can block (D-Bus, user prompts): keep them off the async threads.
    async fn blocking_store<T: Send + 'static>(
        &self,
        f: impl FnOnce(&dyn TokenStore) -> Result<T, store::StoreError> + Send + 'static,
    ) -> Result<T, store::StoreError> {
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || f(store.as_ref()))
            .await
            .unwrap_or_else(|_| Err(store::StoreError::Failed("the keychain call failed".into())))
    }

    /// Forgets the token everywhere. Succeeds when already signed out; a keychain that is
    /// missing counts as nothing to delete.
    async fn clear_token(&self) -> Result<(), GithubError> {
        {
            let mut g = self.lock();
            g.session = None;
            g.login = None;
        }
        match self.blocking_store(|s| s.delete()).await {
            Ok(()) | Err(store::StoreError::Unavailable) => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn sign_out(&self) -> Result<(), GithubError> {
        self.lock().pending = None; // cancels a running poll
        self.clear_token().await
    }

    pub async fn status(&self) -> Result<AuthStatus, GithubError> {
        let session_only = self.lock().session.is_some();
        if self.token().await?.is_none() {
            return Ok(AuthStatus::signed_out());
        }
        let login = match self.get_json::<User>("/user").await {
            Ok(u) => {
                self.lock().login = Some(u.login.clone());
                Some(u.login)
            }
            Err(GithubError::NotSignedIn) => return Ok(AuthStatus::signed_out()),
            // Offline or rate limited: still signed in, login from the last look.
            Err(_) => self.lock().login.clone(),
        };
        Ok(AuthStatus { signed_in: true, login, storage: Some(if session_only { Storage::SessionOnly } else { Storage::Keychain }) })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Storage {
    Keychain,
    SessionOnly,
}

/// What JS may know: never the token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AuthStatus {
    pub signed_in: bool,
    pub login: Option<String>,
    pub storage: Option<Storage>,
}

impl AuthStatus {
    pub fn signed_out() -> Self {
        AuthStatus { signed_in: false, login: None, storage: None }
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct User {
    pub login: String,
}

#[tauri::command]
pub async fn github_start(gh: State<'_, Github>) -> Result<flow::DeviceStart, GithubError> {
    gh.start().await
}

/// Waits (cancellably) until the code is approved, refused or expired.
#[tauri::command]
pub async fn github_poll(gh: State<'_, Github>) -> Result<AuthStatus, GithubError> {
    gh.poll().await
}

#[tauri::command]
pub async fn github_status(gh: State<'_, Github>) -> Result<AuthStatus, GithubError> {
    gh.status().await
}

#[tauri::command]
pub async fn github_list_repos(gh: State<'_, Github>, page: Option<u32>) -> Result<repos::RepoPage, GithubError> {
    gh.list_repos(page).await
}

#[tauri::command]
pub async fn github_sign_out(gh: State<'_, Github>) -> Result<(), GithubError> {
    gh.sign_out().await
}
