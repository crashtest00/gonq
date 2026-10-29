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
pub(super) struct MockStore {
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

pub(super) async fn signed_in() -> (Fake, Arc<Github>, Arc<MockStore>) {
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

const REPOS_QUERY: &str = "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member";

fn names(p: &super::repos::RepoPage) -> Vec<&str> {
    p.repos.iter().map(|r| r.full_name.as_str()).collect()
}

#[tokio::test]
async fn list_repos_round_trips_pages_via_next_page() {
    let (fake, gh, _s) = signed_in().await;
    let next = |n: u32| format!("<{}/user/repos?per_page=100&page={n}>; rel=\"next\"", fake.base);
    fake.script("/user/repos", vec![
        Reply::json(200, json!([repo("a/one", true), repo("a/two", true)])).header("link", &next(2)),
        Reply::json(200, json!([repo("b/three", false)])).header("link", &next(3)),
        Reply::json(200, json!([repo("c/four", true)])),
    ]);

    let first = gh.list_repos(None).await.unwrap();
    assert_eq!(names(&first), ["a/one", "a/two"]);
    assert_eq!(first.next_page, Some(2));
    let second = gh.list_repos(first.next_page).await.unwrap();
    assert_eq!(names(&second), ["b/three"]);
    assert_eq!(second.next_page, Some(3));
    let last = gh.list_repos(second.next_page).await.unwrap();
    assert_eq!(names(&last), ["c/four"]);
    assert_eq!(last.next_page, None);
    // Exactly one request per call: nothing is fetched ahead.
    let paths: Vec<_> = fake.requests.lock().unwrap().iter().map(|r| r.path.clone()).filter(|p| p.starts_with("/user/repos")).collect();
    assert_eq!(paths, [REPOS_QUERY.to_string(), format!("{REPOS_QUERY}&page=2"), format!("{REPOS_QUERY}&page=3")]);
}

#[tokio::test]
async fn list_repos_sends_the_three_query_params() {
    let (fake, gh, _s) = signed_in().await;
    fake.script("/user/repos", vec![Reply::json(200, json!([]))]);
    gh.list_repos(None).await.unwrap();
    let hit = &fake.hits(REPOS_QUERY)[0];
    assert_eq!(hit.header("authorization"), Some(format!("Bearer {TOKEN}").as_str()));
    let url = url::Url::parse(&format!("http://x{}", hit.path)).unwrap();
    let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(q["per_page"], "100");
    assert_eq!(q["affiliation"], "owner,collaborator,organization_member");
    assert_eq!(q["sort"], "pushed");
}

#[tokio::test]
async fn list_repos_maps_fields_and_pushed_at() {
    let (fake, gh, _s) = signed_in().await;
    let mut pushed = repo("a/one", true);
    pushed["pushed_at"] = json!("2026-03-04T05:06:07Z");
    let bare = json!({ "name": "bare", "full_name": "c/bare", "owner": { "login": "c" }, "pushed_at": null });
    fake.script("/user/repos", vec![Reply::json(200, json!([pushed, repo("b/two", false), bare]))]);
    let page = gh.list_repos(None).await.unwrap();
    let r = &page.repos;
    assert_eq!(names(&page), ["a/one", "b/two", "c/bare"]);
    assert_eq!((r[0].owner.as_str(), r[0].name.as_str(), r[0].default_branch.as_str()), ("a", "one", "dev"));
    assert_eq!(r[0].pushed_at.as_deref(), Some("2026-03-04T05:06:07Z"));
    assert!(r[0].private && r[0].can_push && !r[1].can_push);
    // A repository with no commits has no pushed_at (null or absent).
    assert_eq!(r[1].pushed_at, None);
    assert_eq!(r[2].pushed_at, None);
    assert_eq!(r[2].default_branch, "main");
    assert!(!r[2].can_push && !r[2].private);
    let v = serde_json::to_value(&page).unwrap();
    assert_eq!(v["repos"][0]["pushed_at"], "2026-03-04T05:06:07Z");
    assert!(v["repos"][0].get("updated_at").is_none() && v["next_page"].is_null());
}

#[tokio::test]
async fn list_repos_empty_and_errors() {
    let (fake, gh, store) = signed_in().await;
    fake.script("/user/repos", vec![Reply::json(200, json!([]))]);
    let empty = gh.list_repos(None).await.unwrap();
    assert!(empty.repos.is_empty() && empty.next_page.is_none());

    fake.script("/user/repos", vec![Reply::json(403, json!({"message": "API rate limit exceeded"})).header("x-ratelimit-reset", "1700000000")]);
    assert!(matches!(gh.list_repos(None).await, Err(GithubError::RateLimited { reset_at: Some(1700000000), .. })));

    fake.script("/user/repos", vec![Reply::json(401, json!({"message": "Bad credentials"}))]);
    assert_eq!(gh.list_repos(None).await.unwrap_err(), GithubError::NotSignedIn);
    assert_eq!(store.saved(), None);
    assert_eq!(gh.list_repos(None).await.unwrap_err(), GithubError::NotSignedIn);
}

#[tokio::test]
async fn list_repos_reports_a_network_error() {
    let (fake, gh, _s) = signed_in().await;
    fake.script("/user/repos", vec![Reply::drop_connection()]);
    assert!(matches!(gh.list_repos(None).await, Err(GithubError::Network { .. })));
}

// ---- branches and folders ----

const BRANCHES: &str = "/repos/o/r/branches";

fn branch_page(names: &[&str]) -> serde_json::Value {
    json!(names.iter().map(|n| json!({ "name": n, "commit": { "sha": "x" }, "protected": false })).collect::<Vec<_>>())
}

fn script_repo(fake: &Fake, default: &str) {
    fake.script("/repos/o/r", vec![Reply::json(200, json!({ "name": "r", "default_branch": default }))]);
}

#[tokio::test]
async fn branches_paginate_with_the_default_first_and_once() {
    let (fake, gh, _s) = signed_in().await;
    script_repo(&fake, "dev");
    let next = format!("<{}{BRANCHES}?per_page=100&page=2>; rel=\"next\"", fake.base);
    fake.script(BRANCHES, vec![
        Reply::json(200, branch_page(&["a", "feature/ü-ß", "dev"])).header("link", &next),
        Reply::json(200, branch_page(&["x/y/z", "dev", "zz"])),
    ]);
    let first = gh.list_branches("o", "r", None).await.unwrap();
    assert_eq!(first.default_branch, "dev");
    assert_eq!(first.branches, ["dev", "a", "feature/ü-ß"]);
    assert_eq!(first.next_page, Some(2));
    let last = gh.list_branches("o", "r", first.next_page).await.unwrap();
    assert_eq!(last.branches, ["x/y/z", "zz"]);
    assert_eq!(last.next_page, None);
    assert_eq!(fake.hits("/repos/o/r/branches?per_page=100&page=2").len(), 1);
}

#[tokio::test]
async fn branches_default_branch_is_listed_even_when_not_on_page_one() {
    let (fake, gh, _s) = signed_in().await;
    script_repo(&fake, "trunk");
    fake.script(BRANCHES, vec![Reply::json(200, branch_page(&["a", "b"]))]);
    assert_eq!(gh.list_branches("o", "r", None).await.unwrap().branches, ["trunk", "a", "b"]);
}

#[tokio::test]
async fn branches_of_an_empty_repo_are_empty() {
    let (fake, gh, _s) = signed_in().await;
    script_repo(&fake, "main");
    fake.script(BRANCHES, vec![Reply::json(200, json!([]))]);
    let p = gh.list_branches("o", "r", None).await.unwrap();
    assert!(p.branches.is_empty());
    assert_eq!(p.default_branch, "main");
}

#[tokio::test]
async fn branches_errors_are_typed() {
    let (fake, gh, _s) = signed_in().await;
    script_repo(&fake, "main");
    fake.script(BRANCHES, vec![Reply::json(403, json!({"message": "API rate limit exceeded"}))
        .header("x-ratelimit-remaining", "0").header("x-ratelimit-reset", "1700000000")]);
    assert!(matches!(gh.list_branches("o", "r", None).await, Err(GithubError::RateLimited { reset_at: Some(1700000000), .. })));
    fake.script("/repos/o/r", vec![Reply::json(401, json!({"message": "Bad credentials"}))]);
    assert_eq!(gh.list_branches("o", "r", None).await.unwrap_err(), GithubError::NotSignedIn);
}

fn item(name: &str, kind: &str) -> serde_json::Value {
    json!({ "name": name, "path": format!("docs/{name}"), "type": kind, "sha": "s", "size": 1 })
}

const CONTENTS: &str = "/repos/o/r/contents/docs";

async fn folder(items: serde_json::Value) -> Result<super::browse::FolderListing, GithubError> {
    let (fake, gh, _s) = signed_in().await;
    fake.script(CONTENTS, vec![Reply::json(200, items)]);
    gh.list_folder("o", "r", "dev", "docs").await
}

#[tokio::test]
async fn folder_applies_the_local_navigator_rule() {
    let items = json!([
        item("b.MARKDOWN", "file"), item("a.md", "file"), item("c.txt", "file"), item(".hidden.md", "file"),
        item("noext", "file"), item(".md", "file"), item("sub", "dir"), item(".git", "dir"),
        item("Alpha", "dir"), item("zeta", "dir"), item("link.md", "symlink"), item("vendor", "submodule"),
        item("B.md", "file"),
    ]);
    let l = folder(items).await.unwrap();
    let got: Vec<_> = l.entries.iter().map(|e| (e.name.as_str(), e.kind)).collect();
    use super::browse::EntryKind::{File, Folder};
    assert_eq!(got, [("Alpha", Folder), ("sub", Folder), ("zeta", Folder), ("a.md", File), ("b.MARKDOWN", File), ("B.md", File)]);
    assert_eq!(l.entries[0].path, "docs/Alpha");
    assert!(!l.truncated);
    assert_eq!(serde_json::to_value(&l.entries[0]).unwrap()["kind"], "folder");
}

#[tokio::test]
async fn folder_flags_a_possibly_truncated_listing() {
    let many: Vec<_> = (0..1000).map(|i| item(&format!("n{i}.md"), "file")).collect();
    let l = folder(json!(many)).await.unwrap();
    assert!(l.truncated);
    assert_eq!(l.entries.len(), 1000);
}

#[tokio::test]
async fn folder_encodes_path_segments_and_ref() {
    let (fake, gh, _s) = signed_in().await;
    fake.script("/repos/o/r/contents/my%20docs/%C3%BCber/a%23b", vec![Reply::json(200, json!([]))]);
    gh.list_folder("o", "r", "feat/ü x", "/my docs/über/a#b/").await.unwrap();
    let hits = fake.hits("/repos/o/r/contents/my%20docs/%C3%BCber/a%23b?ref=feat%2F%C3%BC%20x");
    assert_eq!(hits.len(), 1);
    fake.script("/repos/o/r/contents/", vec![Reply::json(200, json!([]))]);
    gh.list_folder("o", "r", "dev", "").await.unwrap();
    assert_eq!(fake.hits("/repos/o/r/contents/?ref=dev").len(), 1);
}

#[tokio::test]
async fn folder_that_is_a_file_is_not_a_folder() {
    assert_eq!(folder(item("a.md", "file")).await.unwrap_err(), GithubError::NotAFolder);
}

#[tokio::test]
async fn folder_404_tells_branch_from_path() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(CONTENTS, vec![Reply::json(404, json!({"message": "Not Found"}))]);
    // The branch exists: the path is what is missing.
    fake.script("/repos/o/r/branches/dev", vec![Reply::json(200, json!({"name": "dev"}))]);
    assert_eq!(gh.list_folder("o", "r", "dev", "docs").await.unwrap_err(), GithubError::PathNotFound);
    // The branch is gone (slashes stay separators in the branch lookup).
    assert_eq!(gh.list_folder("o", "r", "gone/b", "docs").await.unwrap_err(), GithubError::BranchNotFound);
    // GitHub says so itself for a bad ref.
    fake.script(CONTENTS, vec![Reply::json(404, json!({"message": "No commit found for the ref nope"}))]);
    assert_eq!(gh.list_folder("o", "r", "nope", "docs").await.unwrap_err(), GithubError::BranchNotFound);
}

#[tokio::test]
async fn folder_of_an_empty_repo() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(CONTENTS, vec![Reply::json(409, json!({"message": "Git Repository is empty."}))]);
    assert_eq!(gh.list_folder("o", "r", "main", "docs").await.unwrap_err(), GithubError::EmptyRepo);
}

#[tokio::test]
async fn folder_other_errors_stay_typed() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(CONTENTS, vec![Reply::json(429, json!({"message": "slow down"})).header("x-ratelimit-reset", "1700000000")]);
    assert!(matches!(gh.list_folder("o", "r", "dev", "docs").await, Err(GithubError::RateLimited { reset_at: Some(1700000000), .. })));
    fake.script(CONTENTS, vec![Reply::json(500, json!({"message": "boom"}))]);
    assert!(matches!(gh.list_folder("o", "r", "dev", "docs").await, Err(GithubError::Http { status: 500, .. })));
    fake.script(CONTENTS, vec![Reply::json(401, json!({"message": "Bad credentials"}))]);
    assert_eq!(gh.list_folder("o", "r", "dev", "docs").await.unwrap_err(), GithubError::NotSignedIn);
}

const TIP: &str = "/repos/o/r/branches/dev";
const FILE: &str = "/repos/o/r/contents/docs/a.md";

fn script_tip(fake: &Fake) {
    fake.script(TIP, vec![Reply::json(200, json!({ "name": "dev", "commit": { "sha": "c0ffee" } }))]);
}

#[tokio::test]
async fn read_file_returns_text_blob_sha_and_tip_commit() {
    let (fake, gh, _s) = signed_in().await;
    script_tip(&fake);
    // GitHub wraps base64 in newlines; "héllo\n" is encoded here.
    fake.script(FILE, vec![Reply::json(200, json!({
        "type": "file", "encoding": "base64", "sha": "b10b", "size": 7, "path": "docs/a.md", "name": "a.md", "content": "aMOpbGxv\nCg==\n"
    }))]);
    let f = gh.read_file("o", "r", "dev", "docs/a.md").await.unwrap();
    assert_eq!((f.content.as_str(), f.sha.as_str(), f.commit_sha.as_str()), ("héllo\n", "b10b", "c0ffee"));
    assert_eq!((f.path.as_str(), f.name.as_str()), ("docs/a.md", "a.md"));
    // The file is read at the tip commit, not at the moving branch.
    assert_eq!(fake.hits("/repos/o/r/contents/docs/a.md?ref=c0ffee").len(), 1);
}

#[tokio::test]
async fn read_file_errors_are_typed() {
    let (fake, gh, _s) = signed_in().await;
    // Unknown branch.
    assert_eq!(gh.read_file("o", "r", "dev", "docs/a.md").await.unwrap_err(), GithubError::BranchNotFound);
    script_tip(&fake);
    // Missing path.
    assert_eq!(gh.read_file("o", "r", "dev", "docs/a.md").await.unwrap_err(), GithubError::PathNotFound);
    // A folder.
    fake.script(FILE, vec![Reply::json(200, json!([{ "name": "x", "type": "file" }]))]);
    assert_eq!(gh.read_file("o", "r", "dev", "docs/a.md").await.unwrap_err(), GithubError::NotAFile);
    // Over 1 MB: no content.
    fake.script(FILE, vec![Reply::json(200, json!({ "type": "file", "encoding": "none", "sha": "b", "content": "" }))]);
    assert_eq!(gh.read_file("o", "r", "dev", "docs/a.md").await.unwrap_err(), GithubError::FileTooLarge);
    // Not UTF-8 (0xFF).
    fake.script(FILE, vec![Reply::json(200, json!({ "type": "file", "encoding": "base64", "sha": "b", "content": "/w==" }))]);
    assert!(matches!(gh.read_file("o", "r", "dev", "docs/a.md").await, Err(GithubError::Unexpected { .. })));
    // Empty repository, rate limit, sign-in lost.
    fake.script(TIP, vec![Reply::json(409, json!({"message": "Git Repository is empty."}))]);
    assert_eq!(gh.read_file("o", "r", "dev", "docs/a.md").await.unwrap_err(), GithubError::EmptyRepo);
    fake.script(TIP, vec![Reply::json(429, json!({"message": "slow"})).header("x-ratelimit-reset", "1700000000")]);
    assert!(matches!(gh.read_file("o", "r", "dev", "docs/a.md").await, Err(GithubError::RateLimited { reset_at: Some(1700000000), .. })));
    fake.script(TIP, vec![Reply::json(401, json!({"message": "Bad credentials"}))]);
    assert_eq!(gh.read_file("o", "r", "dev", "docs/a.md").await.unwrap_err(), GithubError::NotSignedIn);
}

fn file_reply(path: &str, name: &str, bytes: &[u8]) -> Reply {
    use base64::{engine::general_purpose::STANDARD, Engine};
    Reply::json(200, json!({
        "type": "file", "encoding": "base64", "sha": "b10b", "path": path, "name": name, "content": STANDARD.encode(bytes)
    }))
}

#[tokio::test]
async fn read_file_keeps_crlf_bom_and_empty_content() {
    let (fake, gh, _s) = signed_in().await;
    script_tip(&fake);
    fake.script(FILE, vec![file_reply("docs/a.md", "a.md", b"a\r\nb\r\n")]);
    assert_eq!(gh.read_file("o", "r", "dev", "docs/a.md").await.unwrap().content, "a\r\nb\r\n");
    fake.script(FILE, vec![file_reply("docs/a.md", "a.md", b"\xEF\xBB\xBFhi")]);
    assert_eq!(gh.read_file("o", "r", "dev", "docs/a.md").await.unwrap().content, "\u{feff}hi");
    fake.script(FILE, vec![file_reply("docs/a.md", "a.md", b"")]);
    let f = gh.read_file("o", "r", "dev", "docs/a.md").await.unwrap();
    assert_eq!((f.content.as_str(), f.sha.as_str()), ("", "b10b"));
}

#[tokio::test]
async fn read_file_encodes_space_unicode_and_slash_branch() {
    let (fake, gh, _s) = signed_in().await;
    fake.script("/repos/o/r/branches/feat/x", vec![Reply::json(200, json!({ "commit": { "sha": "c0ffee" } }))]);
    fake.script(
        "/repos/o/r/contents/my%20docs/caf%C3%A9.md",
        vec![file_reply("my docs/café.md", "café.md", b"x")],
    );
    let f = gh.read_file("o", "r", "feat/x", "my docs/café.md").await.unwrap();
    assert_eq!((f.path.as_str(), f.name.as_str()), ("my docs/café.md", "café.md"));
    assert_eq!(fake.hits("/repos/o/r/contents/my%20docs/caf%C3%A9.md?ref=c0ffee").len(), 1);
}

#[tokio::test]
async fn read_file_tells_symlink_submodule_folder_apart() {
    let (fake, gh, _s) = signed_in().await;
    script_tip(&fake);
    fake.script(FILE, vec![Reply::json(200, json!({ "type": "symlink", "target": "b.md" }))]);
    assert_eq!(gh.read_file("o", "r", "dev", "docs/a.md").await.unwrap_err(), GithubError::Symlink);
    fake.script(FILE, vec![Reply::json(200, json!({ "type": "submodule", "submodule_git_url": "u" }))]);
    assert_eq!(gh.read_file("o", "r", "dev", "docs/a.md").await.unwrap_err(), GithubError::Submodule);
    fake.script(FILE, vec![Reply::json(200, json!({ "type": "dir" }))]);
    assert_eq!(gh.read_file("o", "r", "dev", "docs/a.md").await.unwrap_err(), GithubError::NotAFile);
}

#[tokio::test]
async fn read_file_403_without_rate_limit_is_no_access() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(TIP, vec![Reply::json(403, json!({"message": "Resource not accessible"}))]);
    assert!(matches!(gh.read_file("o", "r", "dev", "docs/a.md").await, Err(GithubError::NoAccess { .. })));
    script_tip(&fake);
    fake.script(FILE, vec![Reply::json(403, json!({"message": "Forbidden"}))]);
    assert_eq!(
        gh.read_file("o", "r", "dev", "docs/a.md").await.unwrap_err(),
        GithubError::NoAccess { message: "Forbidden".into() }
    );
    // A 403 that is a rate limit stays one.
    fake.script(FILE, vec![Reply::json(403, json!({"message": "API rate limit exceeded"})).header("x-ratelimit-remaining", "0")]);
    assert!(matches!(gh.read_file("o", "r", "dev", "docs/a.md").await, Err(GithubError::RateLimited { .. })));
}
