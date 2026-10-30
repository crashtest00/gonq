//! The device-flow half: `start` and `poll`.

use super::error::{network, GithubError};
use super::store::StoreError;
use super::{AuthStatus, Github, Pending, Secret, Storage, SCOPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Instant;
use tokio::sync::watch;

/// What JS gets from `start`: the code to type at `verification_uri`. No device code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct DeviceStart {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Deserialize)]
struct DeviceCodeReply {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    #[serde(default = "default_interval")]
    interval: u64,
}

fn default_interval() -> u64 {
    5
}

enum Step {
    Token(Secret),
    Pending,
    SlowDown,
    Done(GithubError),
}

/// A token-endpoint reply. GitHub answers 200 with an `error` field, but a non-2xx status with
/// one is handled the same way.
fn interpret(v: &Value) -> Step {
    if let Some(err) = v.get("error").and_then(Value::as_str) {
        return match err {
            "authorization_pending" => Step::Pending,
            "slow_down" => Step::SlowDown,
            "access_denied" => Step::Done(GithubError::AccessDenied),
            "expired_token" | "token_expired" => Step::Done(GithubError::Expired),
            "device_flow_disabled" => Step::Done(GithubError::DeviceFlowDisabled),
            "incorrect_device_code" => Step::Done(GithubError::IncorrectDeviceCode),
            other => Step::Done(GithubError::Unexpected { message: format!("sign-in error {:?}", other.chars().take(60).collect::<String>()) }),
        };
    }
    match v.get("access_token").and_then(Value::as_str) {
        Some(t) if !t.is_empty() => Step::Token(Secret::new(t)),
        _ => Step::Done(GithubError::Unexpected { message: "the token reply had no access_token".into() }),
    }
}

impl Github {
    /// Asks GitHub for a device + user code. Cancels any earlier sign-in. Opens nothing.
    pub async fn start(&self) -> Result<DeviceStart, GithubError> {
        let resp = self
            .http
            .post(&self.cfg.device_code_url)
            .header("Accept", "application/json")
            .json(&json!({ "client_id": self.cfg.client_id, "scope": SCOPE }))
            .send()
            .await
            .map_err(network)?;
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        if let Step::Done(e) = interpret_start_error(&body) {
            return Err(e);
        }
        if !status.is_success() {
            return Err(GithubError::Http { status: status.as_u16(), message: super::api::message_of(&body) });
        }
        let r: DeviceCodeReply = serde_json::from_value(body)
            .map_err(|_| GithubError::Unexpected { message: "the device-code reply was malformed".into() })?;
        let out = DeviceStart {
            user_code: r.user_code,
            verification_uri: r.verification_uri,
            expires_in: r.expires_in,
            interval: r.interval,
        };
        let (tx, _rx) = watch::channel(());
        let mut g = self.lock();
        g.next_id += 1;
        let id = g.next_id;
        g.pending = Some(Pending {
            device_code: Secret::new(r.device_code),
            interval: r.interval,
            deadline: Instant::now() + self.cfg.time_unit * r.expires_in as u32,
            id,
            cancel: tx,
        }); // the old Pending (if any) is dropped here, cancelling its poll
        Ok(out)
    }

    /// Polls until approved, refused or expired. A newer `start`, `poll` or `sign_out` ends this
    /// one with `Cancelled`.
    pub async fn poll(&self) -> Result<AuthStatus, GithubError> {
        let (device_code, mut interval, deadline, id, mut cancel) = {
            let mut g = self.lock();
            let p = g.pending.as_mut().ok_or(GithubError::NoSignInInProgress)?;
            // A fresh channel supersedes any poll already running for this code.
            let (tx, rx) = watch::channel(());
            p.cancel = tx;
            (p.device_code.clone(), p.interval, p.deadline, p.id, rx)
        };
        let unit = self.cfg.time_unit;
        let outcome: Result<Secret, GithubError> = loop {
            // Never faster than the interval (GitHub also wants a wait before the first poll).
            let wake = Instant::now() + unit * interval as u32;
            let sleep_until = wake.min(deadline);
            tokio::select! {
                _ = tokio::time::sleep_until(sleep_until.into()) => {}
                _ = cancel.changed() => return Err(GithubError::Cancelled),
            }
            if Instant::now() >= deadline {
                break Err(GithubError::Expired);
            }
            let sent = self
                .http
                .post(&self.cfg.token_url)
                .header("Accept", "application/json")
                .json(&json!({
                    "client_id": self.cfg.client_id,
                    "device_code": device_code.expose(),
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                }))
                .send();
            let resp = tokio::select! {
                r = sent => r,
                _ = cancel.changed() => return Err(GithubError::Cancelled),
            };
            // A dropped connection or a GitHub 5xx is not the end of sign-in: try again next tick.
            let Ok(resp) = resp else { continue };
            let status = resp.status();
            let Ok(body) = resp.json::<Value>().await else {
                if status.is_server_error() || status.is_success() { continue }
                break Err(GithubError::Http { status: status.as_u16(), message: "unreadable reply".into() });
            };
            match interpret(&body) {
                Step::Token(t) => break Ok(t),
                Step::Pending => {}
                Step::SlowDown => {
                    interval += 5;
                    if let Some(p) = self.lock().pending.as_mut().filter(|p| p.id == id) {
                        p.interval = interval;
                    }
                }
                Step::Done(e) => break Err(e),
            }
        };
        // Superseded while the last request was in flight: leave the newer sign-in alone.
        if cancel.has_changed().is_err() {
            return Err(GithubError::Cancelled);
        }
        {
            let mut g = self.lock();
            if g.pending.as_ref().map(|p| p.id) == Some(id) {
                g.pending = None;
            }
        }
        let token = outcome?;
        self.finish_sign_in(token).await
    }

    /// Keeps the token (keychain, else this session's memory) and reports who signed in.
    async fn finish_sign_in(&self, token: Secret) -> Result<AuthStatus, GithubError> {
        let to_store = token.clone();
        let storage = match self.blocking_store(move |s| s.set(to_store.expose())).await {
            Ok(()) => {
                self.lock().session = None;
                Storage::Keychain
            }
            Err(StoreError::Unavailable) => {
                self.lock().session = Some(token);
                Storage::SessionOnly
            }
            Err(e) => return Err(e.into()), // locked/denied: the token is dropped, not kept anywhere
        };
        let login = self.get_json::<super::User>("/user").await.ok().map(|u| u.login);
        self.lock().login = login.clone();
        Ok(AuthStatus { signed_in: true, login, storage: Some(storage) })
    }
}

/// `start` can be refused the same way `poll` is (e.g. `device_flow_disabled`).
fn interpret_start_error(body: &Value) -> Step {
    match body.get("error").and_then(Value::as_str) {
        Some("device_flow_disabled") => Step::Done(GithubError::DeviceFlowDisabled),
        Some(other) => Step::Done(GithubError::Unexpected { message: format!("sign-in error {:?}", other.chars().take(60).collect::<String>()) }),
        None => Step::Pending,
    }
}

