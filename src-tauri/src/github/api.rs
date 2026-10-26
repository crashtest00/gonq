//! A small GitHub REST client: token, headers, pagination and typed errors.
//! The token is sent only to the configured API origin (api.github.com over HTTPS in
//! production); redirects are off, and a pagination link to any other origin is refused.

use super::error::{network, GithubError};
use super::{Github, Secret};
use serde::de::DeserializeOwned;
use serde_json::Value;
use url::Url;

pub const API_VERSION: &str = "2022-11-28";
const MAX_MESSAGE: usize = 300;

/// GitHub's own `message` from an error body, shortened.
pub fn message_of(body: &Value) -> String {
    let m = body.get("message").and_then(Value::as_str).unwrap_or("no message");
    m.chars().take(MAX_MESSAGE).collect()
}

/// The `rel="next"` target of a `Link` header.
pub fn next_link(header: &str) -> Option<String> {
    header.split(',').find_map(|part| {
        let mut bits = part.split(';');
        let target = bits.next()?.trim().strip_prefix('<')?.strip_suffix('>')?.to_string();
        bits.any(|b| b.trim().replace(' ', "") == "rel=\"next\"").then_some(target)
    })
}

fn header_u64(resp: &reqwest::Response, name: &str) -> Option<u64> {
    resp.headers().get(name)?.to_str().ok()?.trim().parse().ok()
}

impl Github {
    /// The absolute URL for `path_or_url`, only if it is on the API origin.
    fn api_url(&self, path_or_url: &str) -> Result<Url, GithubError> {
        let base = Url::parse(&self.cfg.api_base).map_err(|_| unexpected("the API address is invalid"))?;
        let url = if path_or_url.starts_with("http://") || path_or_url.starts_with("https://") {
            Url::parse(path_or_url).map_err(|_| unexpected("a link from GitHub was not a URL"))?
        } else {
            base.join(path_or_url.trim_start_matches('/')).map_err(|_| unexpected("the request path is invalid"))?
        };
        if url.origin() != base.origin() {
            return Err(unexpected("refusing to send the token to another address"));
        }
        Ok(url)
    }

    /// One authenticated GET. 401 forgets the stored token and answers `NotSignedIn`.
    async fn get(&self, path_or_url: &str) -> Result<reqwest::Response, GithubError> {
        let url = self.api_url(path_or_url)?;
        let token: Secret = self.token().await?.ok_or(GithubError::NotSignedIn)?;
        let resp = self
            .http
            .get(url)
            .bearer_auth(token.expose())
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
            .send()
            .await
            .map_err(network)?;
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }
        let code = status.as_u16();
        let reset_at = header_u64(&resp, "x-ratelimit-reset");
        let remaining_zero = resp.headers().get("x-ratelimit-remaining").and_then(|v| v.to_str().ok()) == Some("0");
        let retry_after = header_u64(&resp, "retry-after");
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        let message = message_of(&body);
        if code == 401 {
            // A failed delete must not hide the sign-out: the token is rejected either way.
            let _ = self.clear_token().await;
            return Err(GithubError::NotSignedIn);
        }
        if code == 429 || (code == 403 && (remaining_zero || retry_after.is_some() || message.to_lowercase().contains("rate limit"))) {
            let reset_at = reset_at.or_else(|| retry_after.map(|s| now_unix() + s));
            return Err(GithubError::RateLimited { reset_at, message });
        }
        Err(GithubError::Http { status: code, message })
    }

    pub async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T, GithubError> {
        self.get(path).await?.json().await.map_err(|_| unexpected("the reply was not the expected JSON"))
    }

    /// GETs one page of a list: its items and the `rel="next"` link, if any.
    pub async fn get_page<T: DeserializeOwned>(&self, path: &str) -> Result<(Vec<T>, Option<String>), GithubError> {
        let resp = self.get(path).await?;
        let next = resp.headers().get("link").and_then(|v| v.to_str().ok()).and_then(next_link);
        let items = resp.json().await.map_err(|_| unexpected("the page was not the expected JSON"))?;
        Ok((items, next))
    }

    /// GETs each page of a list, following `Link: rel="next"`. `on_page` returns `false` to stop
    /// early (no further request is made).
    pub async fn get_paginated<T, F>(&self, path: &str, mut on_page: F) -> Result<(), GithubError>
    where
        T: DeserializeOwned,
        F: FnMut(Vec<T>) -> bool,
    {
        let mut next = Some(path.to_string());
        while let Some(target) = next.take() {
            let resp = self.get(&target).await?;
            next = resp.headers().get("link").and_then(|v| v.to_str().ok()).and_then(next_link);
            let items: Vec<T> = resp.json().await.map_err(|_| unexpected("the page was not the expected JSON"))?;
            if !on_page(items) {
                break;
            }
        }
        Ok(())
    }
}

fn unexpected(m: &str) -> GithubError {
    GithubError::Unexpected { message: m.into() }
}

fn now_unix() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}
