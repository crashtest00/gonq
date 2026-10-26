//! Device flow, REST client and token handling against a local fake GitHub and a mock keychain.

use super::error::GithubError;
use super::fake_github::{Fake, Reply};
use super::store::{StoreError, TokenStore};
use super::{Config, Github, Storage};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const TOKEN: &str = "gho_SECRETTOKEN0123456789";
const DEVICE: &str = "devcode_SECRET_9876543210";
/// One GitHub "second" in these tests.
const UNIT: Duration = Duration::from_millis(20);

#[derive(Default)]
struct MockStore {
    token: Mutex<Option<String>>,
    mode: Mutex<Option<StoreError>>,
}

impl MockStore {
    fn broken(e: StoreError) -> Arc<Self> {
        let s = MockStore::default();
        *s.mode.lock().unwrap() = Some(e);
        Arc::new(s)
    }
    fn saved(&self) -> Option<String> {
        self.token.lock().unwrap().clone()
    }
    fn fail(&self) -> Result<(), StoreError> {
        self.mode.lock().unwrap().clone().map_or(Ok(()), Err)
    }
}

impl TokenStore for MockStore {
    fn get(&self) -> Result<Option<String>, StoreError> {
        self.fail()?;
        Ok(self.saved())
    }
    fn set(&self, token: &str) -> Result<(), StoreError> {
        self.fail()?;
        *self.token.lock().unwrap() = Some(token.into());
        Ok(())
    }
    fn delete(&self) -> Result<(), StoreError> {
        self.fail()?;
        *self.token.lock().unwrap() = None;
        Ok(())
    }
}

fn setup(fake: &Fake, store: Arc<MockStore>) -> Arc<Github> {
    let mut cfg = Config::production();
    cfg.device_code_url = format!("{}/login/device/code", fake.base);
    cfg.token_url = format!("{}/login/oauth/access_token", fake.base);
    cfg.api_base = fake.base.clone();
    cfg.time_unit = UNIT;
    Arc::new(Github::new(cfg, store))
}

fn device_reply(expires_in: u64, interval: u64) -> Reply {
    Reply::json(200, json!({
        "device_code": DEVICE, "user_code": "ABCD-1234", "verification_uri": "https://github.com/login/device",
        "expires_in": expires_in, "interval": interval,
    }))
}

fn err(error: &str) -> Reply {
    Reply::json(200, json!({ "error": error, "error_description": "x" }))
}

fn granted() -> Reply {
    Reply::json(200, json!({ "access_token": TOKEN, "token_type": "bearer", "scope": "repo" }))
}

fn user() -> Reply {
    Reply::json(200, json!({ "login": "octocat" }))
}

const CODE: &str = "/login/device/code";
const TOKEN_PATH: &str = "/login/oauth/access_token";

async fn started(replies: Vec<Reply>, store: Arc<MockStore>) -> (Fake, Arc<Github>) {
    let fake = Fake::start().await;
    fake.script(CODE, vec![device_reply(1000, 1)]);
    fake.script(TOKEN_PATH, replies);
    fake.script("/user", vec![user()]);
    let gh = setup(&fake, store);
    gh.start().await.unwrap();
    (fake, gh)
}

#[tokio::test]
async fn start_returns_user_code_but_not_device_code() {
    let fake = Fake::start().await;
    fake.script(CODE, vec![device_reply(900, 5)]);
    let gh = setup(&fake, Arc::new(MockStore::default()));
    let s = gh.start().await.unwrap();
    assert_eq!((s.user_code.as_str(), s.expires_in, s.interval), ("ABCD-1234", 900, 5));
    assert!(!serde_json::to_string(&s).unwrap().contains(DEVICE));
    let req = &fake.hits(CODE)[0];
    assert_eq!(req.method, "POST");
    assert_eq!(req.header("accept"), Some("application/json"));
    let body: serde_json::Value = serde_json::from_str(&req.body).unwrap();
    assert_eq!(body, json!({"client_id": "Ov23liKabMQhRPtbIDiu", "scope": "repo"}));
}

#[tokio::test]
async fn poll_without_start_is_an_error() {
    let fake = Fake::start().await;
    let gh = setup(&fake, Arc::new(MockStore::default()));
    assert_eq!(gh.poll().await.unwrap_err(), GithubError::NoSignInInProgress);
}

#[tokio::test]
async fn pending_then_approved_signs_in_and_saves_the_token() {
    let store = Arc::new(MockStore::default());
    let (fake, gh) = started(vec![err("authorization_pending"), err("authorization_pending"), granted()], store.clone()).await;
    let status = gh.poll().await.unwrap();
    assert!(status.signed_in);
    assert_eq!(status.login.as_deref(), Some("octocat"));
    assert_eq!(status.storage, Some(Storage::Keychain));
    assert_eq!(store.saved().as_deref(), Some(TOKEN));
    let hits = fake.hits(TOKEN_PATH);
    assert_eq!(hits.len(), 3);
    let body: serde_json::Value = serde_json::from_str(&hits[0].body).unwrap();
    assert_eq!(body["grant_type"], "urn:ietf:params:oauth:grant-type:device_code");
    assert_eq!(body["device_code"], DEVICE);
    assert_eq!(body["client_id"], "Ov23liKabMQhRPtbIDiu");
    for w in hits.windows(2) {
        assert!(w[1].at - w[0].at >= UNIT, "polled faster than the interval");
    }
    // The next launch reads it back from the keychain.
    let again = setup(&fake, store);
    let s = again.status().await.unwrap();
    assert_eq!((s.signed_in, s.login.as_deref(), s.storage), (true, Some("octocat"), Some(Storage::Keychain)));
}

#[tokio::test]
async fn slow_down_adds_five_seconds() {
    let (fake, gh) = started(vec![err("slow_down"), granted()], Arc::new(MockStore::default())).await;
    gh.poll().await.unwrap();
    let hits = fake.hits(TOKEN_PATH);
    assert!(hits[1].at - hits[0].at >= UNIT * 6, "interval should be 1 + 5 units");
}

#[tokio::test]
async fn terminal_errors_are_distinct() {
    let cases = [
        ("access_denied", GithubError::AccessDenied),
        ("expired_token", GithubError::Expired),
        ("token_expired", GithubError::Expired),
        ("device_flow_disabled", GithubError::DeviceFlowDisabled),
        ("incorrect_device_code", GithubError::IncorrectDeviceCode),
    ];
    for (code, want) in cases {
        let (_f, gh) = started(vec![err("authorization_pending"), err(code)], Arc::new(MockStore::default())).await;
        assert_eq!(gh.poll().await.unwrap_err(), want, "{code}");
        // The sign-in is over.
        assert_eq!(gh.poll().await.unwrap_err(), GithubError::NoSignInInProgress);
    }
}

#[tokio::test]
async fn error_field_on_a_non_200_status_is_still_an_error() {
    let (_f, gh) = started(vec![Reply::json(400, json!({"error": "access_denied"}))], Arc::new(MockStore::default())).await;
    assert_eq!(gh.poll().await.unwrap_err(), GithubError::AccessDenied);
}

#[tokio::test]
async fn never_approved_stops_at_expires_in() {
    let fake = Fake::start().await;
    fake.script(CODE, vec![device_reply(10, 1)]);
    fake.script(TOKEN_PATH, vec![err("authorization_pending")]);
    let gh = setup(&fake, Arc::new(MockStore::default()));
    gh.start().await.unwrap();
    assert_eq!(gh.poll().await.unwrap_err(), GithubError::Expired);
    let n = fake.hits(TOKEN_PATH).len();
    assert!((1..=10).contains(&n), "polled {n} times");
}

#[tokio::test]
async fn network_errors_and_5xx_mid_poll_do_not_end_sign_in() {
    let (fake, gh) = started(
        vec![Reply::drop_connection(), Reply { status: 502, headers: vec![], body: "<html>bad gateway</html>".into(), drop: false }, granted()],
        Arc::new(MockStore::default()),
    )
    .await;
    assert!(gh.poll().await.unwrap().signed_in);
    assert_eq!(fake.hits(TOKEN_PATH).len(), 3);
}

#[tokio::test]
async fn a_second_start_cancels_the_first_poll() {
    let (fake, gh) = started(vec![err("authorization_pending")], Arc::new(MockStore::default())).await;
    let first = tokio::spawn({
        let gh = gh.clone();
        async move { gh.poll().await }
    });
    tokio::time::sleep(UNIT * 3).await;
    fake.script(TOKEN_PATH, vec![granted()]);
    gh.start().await.unwrap();
    assert_eq!(first.await.unwrap().unwrap_err(), GithubError::Cancelled);
    assert!(gh.poll().await.unwrap().signed_in);
}

#[tokio::test]
async fn sign_out_cancels_a_running_poll() {
    let (_f, gh) = started(vec![err("authorization_pending")], Arc::new(MockStore::default())).await;
    let poll = tokio::spawn({
        let gh = gh.clone();
        async move { gh.poll().await }
    });
    tokio::time::sleep(UNIT * 3).await;
    gh.sign_out().await.unwrap();
    assert_eq!(poll.await.unwrap().unwrap_err(), GithubError::Cancelled);
}

#[tokio::test]
async fn sign_out_deletes_the_token_and_is_idempotent() {
    let store = Arc::new(MockStore::default());
    let (_f, gh) = started(vec![granted()], store.clone()).await;
    gh.poll().await.unwrap();
    gh.sign_out().await.unwrap();
    assert_eq!(store.saved(), None);
    assert_eq!(gh.status().await.unwrap(), super::AuthStatus::signed_out());
    gh.sign_out().await.unwrap();
}

#[tokio::test]
async fn without_a_keychain_the_token_lives_in_memory_only() {
    let store = MockStore::broken(StoreError::Unavailable);
    let (fake, gh) = started(vec![granted()], store.clone()).await;
    let s = gh.poll().await.unwrap();
    assert_eq!((s.signed_in, s.storage), (true, Some(Storage::SessionOnly)));
    let s = gh.status().await.unwrap();
    assert_eq!((s.signed_in, s.login.as_deref(), s.storage), (true, Some("octocat"), Some(Storage::SessionOnly)));
    assert_eq!(fake.hits("/user").last().unwrap().header("authorization"), Some(format!("Bearer {TOKEN}").as_str()));
    gh.sign_out().await.unwrap();
    assert!(!gh.status().await.unwrap().signed_in);
    // A new run has nothing.
    assert!(!setup(&fake, store).status().await.unwrap().signed_in);
}

#[tokio::test]
async fn a_locked_keychain_is_a_typed_error_naming_the_keychain() {
    let store = MockStore::broken(StoreError::Failed("the keychain is locked or access was denied".into()));
    let (_f, gh) = started(vec![granted()], store.clone()).await;
    match gh.poll().await.unwrap_err() {
        GithubError::Keychain { message } => assert!(message.contains("keychain")),
        other => panic!("{other:?}"),
    }
    assert!(matches!(gh.status().await.unwrap_err(), GithubError::Keychain { .. }));
}

async fn signed_in() -> (Fake, Arc<Github>, Arc<MockStore>) {
    let store = Arc::new(MockStore::default());
    let (fake, gh) = started(vec![granted()], store.clone()).await;
    gh.poll().await.unwrap();
    (fake, gh, store)
}

#[tokio::test]
async fn requests_carry_token_user_agent_and_api_version() {
    let (fake, gh, _s) = signed_in().await;
    fake.script("/thing", vec![Reply::json(200, json!({"login": "x"}))]);
    gh.get_json::<super::User>("/thing").await.unwrap();
    let r = &fake.hits("/thing")[0];
    assert_eq!(r.header("authorization"), Some(format!("Bearer {TOKEN}").as_str()));
    assert!(r.header("user-agent").unwrap().starts_with("Gonq/"));
    assert_eq!(r.header("x-github-api-version"), Some("2022-11-28"));
    assert_eq!(r.header("accept"), Some("application/vnd.github+json"));
}

#[tokio::test]
async fn unauthorized_deletes_the_token_and_reports_signed_out() {
    let (fake, gh, store) = signed_in().await;
    fake.script("/user", vec![Reply::json(401, json!({"message": "Bad credentials"}))]);
    assert_eq!(gh.get_json::<super::User>("/user").await.unwrap_err(), GithubError::NotSignedIn);
    assert_eq!(store.saved(), None);
    assert_eq!(gh.status().await.unwrap(), super::AuthStatus::signed_out());
}

#[tokio::test]
async fn http_errors_carry_status_and_github_message() {
    let (fake, gh, _s) = signed_in().await;
    for (status, msg) in [(404, "Not Found"), (422, "Validation Failed"), (403, "Resource not accessible by integration")] {
        fake.script("/x", vec![Reply::json(status, json!({"message": msg}))]);
        assert_eq!(
            gh.get_json::<serde_json::Value>("/x").await.unwrap_err(),
            GithubError::Http { status, message: msg.into() }
        );
    }
}

#[tokio::test]
async fn rate_limits_name_the_reset_time() {
    let (fake, gh, store) = signed_in().await;
    fake.script("/x", vec![Reply::json(403, json!({"message": "API rate limit exceeded"}))
        .header("x-ratelimit-remaining", "0").header("x-ratelimit-reset", "1700000000")]);
    assert_eq!(
        gh.get_json::<serde_json::Value>("/x").await.unwrap_err(),
        GithubError::RateLimited { reset_at: Some(1_700_000_000), message: "API rate limit exceeded".into() }
    );
    fake.script("/x", vec![Reply::json(429, json!({"message": "slow"})).header("retry-after", "60")]);
    match gh.get_json::<serde_json::Value>("/x").await.unwrap_err() {
        GithubError::RateLimited { reset_at: Some(t), .. } => assert!(t > 1_700_000_000),
        other => panic!("{other:?}"),
    }
    assert_eq!(store.saved().as_deref(), Some(TOKEN), "a rate limit keeps the token");
}

#[tokio::test]
async fn pagination_follows_next_links_and_can_stop_early() {
    let (fake, gh, _s) = signed_in().await;
    let link = |n: u32| format!("<{}/items?page={n}>; rel=\"next\", <{}/items?page=9>; rel=\"last\"", fake.base, fake.base);
    fake.script("/items", vec![
        Reply::json(200, json!([1, 2])).header("link", &link(2)),
        Reply::json(200, json!([3, 4])).header("link", &link(3)),
        Reply::json(200, json!([5])),
    ]);
    let mut all = vec![];
    gh.get_paginated::<u32, _>("/items?page=1", |p| { all.extend(p); true }).await.unwrap();
    assert_eq!(all, [1, 2, 3, 4, 5]);

    fake.script("/items", vec![
        Reply::json(200, json!([1, 2])).header("link", &link(2)),
        Reply::json(200, json!([3, 4])).header("link", &link(3)),
        Reply::json(200, json!([5])),
    ]);
    let before = fake.hits("/items?page=2").len();
    let mut got = vec![];
    gh.get_paginated::<u32, _>("/items?page=1", |p| { got.extend(p); got.len() < 2 }).await.unwrap();
    assert_eq!(got, [1, 2]);
    assert_eq!(fake.hits("/items?page=2").len(), before, "stopped before the next page");
}

#[tokio::test]
async fn the_token_is_never_sent_to_another_origin() {
    let (fake, gh, _s) = signed_in().await;
    let other = Fake::start().await;
    other.script("/steal", vec![Reply::json(200, json!([]))]);
    fake.script("/items", vec![Reply::json(200, json!([1])).header("link", &format!("<{}/steal>; rel=\"next\"", other.base))]);
    let e = gh.get_paginated::<u32, _>("/items", |_| true).await.unwrap_err();
    assert!(matches!(e, GithubError::Unexpected { .. }));
    assert!(other.requests.lock().unwrap().is_empty());
    assert!(gh.get_json::<serde_json::Value>(&format!("{}/steal", other.base)).await.is_err());
    // Redirects are not followed either.
    fake.script("/r", vec![Reply::json(302, json!({})).header("location", &format!("{}/steal", other.base))]);
    assert!(gh.get_json::<serde_json::Value>("/r").await.is_err());
    assert!(other.requests.lock().unwrap().is_empty());
}

#[test]
fn production_config_targets_github_over_https() {
    let c = Config::production();
    assert_eq!(c.api_base, "https://api.github.com");
    assert!(c.device_code_url.starts_with("https://github.com/"));
    assert!(c.token_url.starts_with("https://github.com/"));
}

#[tokio::test]
async fn neither_token_nor_device_code_appear_in_any_error() {
    let mut errors: Vec<GithubError> = vec![];
    // Poll failures (GitHub echoing nothing secret, but the code travels in every request).
    for code in ["access_denied", "expired_token", "device_flow_disabled", "incorrect_device_code", "mystery"] {
        let (_f, gh) = started(vec![err(code)], Arc::new(MockStore::default())).await;
        errors.push(gh.poll().await.unwrap_err());
    }
    let (_f, gh) = started(vec![Reply::drop_connection()], Arc::new(MockStore::default())).await;
    errors.push(gh.start().await.map(|_| GithubError::Cancelled).unwrap_or_else(|e| e));
    errors.push(setup(&_f, Arc::new(MockStore::default())).poll().await.unwrap_err());
    // Keychain failures and REST failures while signed in.
    let (_f, gh) = started(vec![granted()], MockStore::broken(StoreError::Failed("the keychain is locked".into()))).await;
    errors.push(gh.poll().await.unwrap_err());
    let (fake, gh, _s) = signed_in().await;
    for (status, h) in [(401, None), (403, Some("0")), (404, None), (422, None)] {
        let mut r = Reply::json(status, json!({"message": "nope"}));
        if let Some(h) = h {
            r = r.header("x-ratelimit-remaining", h);
        }
        fake.script("/x", vec![r]);
        errors.push(gh.get_json::<serde_json::Value>("/x").await.unwrap_err());
    }
    // A connection refused (nothing listens) still gives fixed text.
    let mut cfg = Config::production();
    cfg.api_base = "http://127.0.0.1:1".into();
    let dead = Github::new(cfg, Arc::new(MockStore::default()));
    dead.lock().session = Some(super::Secret::new(TOKEN));
    errors.push(dead.get_json::<serde_json::Value>("/user").await.unwrap_err());
    assert!(errors.len() >= 12);
    for e in errors {
        let all = format!("{e} {e:?} {}", serde_json::to_string(&e).unwrap());
        assert!(!all.contains(TOKEN) && !all.contains(DEVICE), "leaked in {all}");
        assert!(!all.contains("SECRET"), "leaked in {all}");
    }
    // And the secret wrapper itself never prints.
    assert!(!format!("{:?}", super::Secret::new(TOKEN)).contains("SECRET"));
}

/// The real keychain on a machine without one must degrade, not panic. (On a developer machine
/// with a keychain this just exercises a round trip, so it cleans up after itself.)
#[test]
fn real_keyring_store_never_panics() {
    use super::store::KeyringStore;
    let s = KeyringStore;
    match s.set("gonq-test-token") {
        Ok(()) => {
            assert_eq!(s.get().unwrap().as_deref(), Some("gonq-test-token"));
            s.delete().unwrap();
            assert_eq!(s.get().unwrap(), None);
        }
        Err(e) => println!("keychain unavailable here: {e:?}"),
    }
}

/// Owner-run end to end against the real github.com (one device code, so never in CI):
/// `cargo test -j 2 live_device_flow -- --ignored --nocapture`, then approve the printed code at
/// https://github.com/login/device within the time shown. Nothing secret is printed.
#[tokio::test]
#[ignore]
async fn live_device_flow() {
    let store = Arc::new(MockStore::default());
    let gh = Github::new(Config::production(), store.clone());
    let s = gh.start().await.unwrap();
    println!("START: enter {} at {} (expires in {}s, interval {}s)", s.user_code, s.verification_uri, s.expires_in, s.interval);
    let status = gh.poll().await;
    println!("POLL: {:?}", status);
    let status = status.unwrap();
    assert!(status.signed_in);
    println!("STATUS: {:?}", gh.status().await.unwrap());
    gh.sign_out().await.unwrap();
    println!("AFTER SIGN OUT: {:?}", gh.status().await.unwrap());
    assert_eq!(store.saved(), None);
}

fn repo(full: &str, push: bool) -> serde_json::Value {
    let (owner, name) = full.split_once('/').unwrap();
    json!({ "name": name, "full_name": full, "owner": { "login": owner }, "private": true,
        "default_branch": "dev", "description": null, "updated_at": "2026-01-01T00:00:00Z",
        "permissions": { "admin": false, "push": push, "pull": true }, "extra": 1 })
}

#[tokio::test]
async fn list_repos_follows_pages_and_maps_fields() {
    let (fake, gh, _s) = signed_in().await;
    let next = format!("<{}/user/repos?page=2>; rel=\"next\"", fake.base);
    fake.script("/user/repos", vec![
        Reply::json(200, json!([repo("a/one", true)])).header("link", &next),
        Reply::json(200, json!([repo("b/two", false), { "name": "bare", "full_name": "c/bare", "owner": { "login": "c" } }])),
    ]);
    let repos = gh.list_repos().await.unwrap();
    assert_eq!(repos.iter().map(|r| r.full_name.as_str()).collect::<Vec<_>>(), ["a/one", "b/two", "c/bare"]);
    assert_eq!((repos[0].owner.as_str(), repos[0].name.as_str(), repos[0].default_branch.as_str()), ("a", "one", "dev"));
    assert!(repos[0].private && repos[0].can_push && !repos[1].can_push);
    assert_eq!(repos[2].default_branch, "main");
    assert!(!repos[2].can_push && !repos[2].private);
    let first = &fake.hits("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member")[0];
    assert_eq!(first.header("authorization"), Some(format!("Bearer {TOKEN}").as_str()));
    assert_eq!(fake.hits("/user/repos?page=2").len(), 1);
}

#[tokio::test]
async fn list_repos_empty_and_errors() {
    let (fake, gh, store) = signed_in().await;
    fake.script("/user/repos", vec![Reply::json(200, json!([]))]);
    assert!(gh.list_repos().await.unwrap().is_empty());

    fake.script("/user/repos", vec![Reply::json(403, json!({"message": "API rate limit exceeded"})).header("x-ratelimit-reset", "1700000000")]);
    assert!(matches!(gh.list_repos().await, Err(GithubError::RateLimited { reset_at: Some(1700000000), .. })));

    fake.script("/user/repos", vec![Reply::json(401, json!({"message": "Bad credentials"}))]);
    assert_eq!(gh.list_repos().await.unwrap_err(), GithubError::NotSignedIn);
    assert_eq!(store.saved(), None);
    assert_eq!(gh.list_repos().await.unwrap_err(), GithubError::NotSignedIn);
}

#[tokio::test]
async fn list_repos_stops_at_the_page_cap() {
    let (fake, gh, _s) = signed_in().await;
    let next = format!("<{}/user/repos?page=2>; rel=\"next\"", fake.base);
    fake.script("/user/repos", vec![Reply::json(200, json!([repo("a/one", true)])).header("link", &next)]);
    assert_eq!(gh.list_repos().await.unwrap().len(), super::repos::MAX_PAGES);
}
