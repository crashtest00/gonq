//! `gonq_branch_exists` and `create_gonq_branch` against the local fake GitHub: free and taken names,
//! creation from the source tip, the typed collision error without overwriting, a missing source branch,
//! unicode and long names, and auth and server failures; plus the frontend contract (collision kind `already_exists`,
//! command names and argument names the frontend invokes).

use super::error::GithubError;
use super::fake_github::Reply;
use super::tests::signed_in;
use serde_json::{json, Value};

const SRC: &str = "/repos/o/r/git/ref/heads/main";
const REFS: &str = "/repos/o/r/git/refs";

fn tip(sha: &str) -> Reply {
    Reply::json(200, json!({ "ref": "refs/heads/main", "object": { "sha": sha, "type": "commit" } }))
}

#[tokio::test]
async fn free_name_is_false_and_taken_name_is_true() {
    let (fake, gh, _s) = signed_in().await;
    assert!(!gh.gonq_branch_exists("o", "r", "idea").await.unwrap());
    fake.script("/repos/o/r/git/ref/heads/gonq/idea", vec![Reply::json(200, json!({ "ref": "refs/heads/gonq/idea" }))]);
    assert!(gh.gonq_branch_exists("o", "r", "idea").await.unwrap());
}

#[tokio::test]
async fn check_surfaces_auth_and_server_errors() {
    let (fake, gh, _s) = signed_in().await;
    fake.script("/repos/o/r/git/ref/heads/gonq/a", vec![Reply::json(500, json!({ "message": "boom" }))]);
    assert_eq!(gh.gonq_branch_exists("o", "r", "a").await.unwrap_err(), GithubError::Http { status: 500, message: "boom".into() });
    fake.script("/repos/o/r/git/ref/heads/gonq/b", vec![Reply::json(401, json!({ "message": "Bad credentials" }))]);
    assert_eq!(gh.gonq_branch_exists("o", "r", "b").await.unwrap_err(), GithubError::NotSignedIn);
}

#[tokio::test]
async fn create_cuts_from_the_source_tip_with_the_prefix() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(SRC, vec![tip("abc123")]);
    fake.script(REFS, vec![Reply::json(201, json!({ "ref": "refs/heads/gonq/idea" }))]);
    let out = gh.create_gonq_branch("o", "r", "idea", "main").await.unwrap();
    assert_eq!((out.branch.as_str(), out.sha.as_str()), ("gonq/idea", "abc123"));
    let posts = fake.hits(REFS);
    assert_eq!(posts.len(), 1);
    assert_eq!(posts[0].method, "POST");
    let body: Value = serde_json::from_str(&posts[0].body).unwrap();
    assert_eq!(body, json!({ "ref": "refs/heads/gonq/idea", "sha": "abc123" }));
}

#[tokio::test]
async fn create_reads_the_tip_at_call_time() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(SRC, vec![tip("old"), tip("new")]);
    fake.script(REFS, vec![Reply::json(201, json!({}))]);
    assert_eq!(gh.create_gonq_branch("o", "r", "a", "main").await.unwrap().sha, "old");
    assert_eq!(gh.create_gonq_branch("o", "r", "b", "main").await.unwrap().sha, "new");
    assert_eq!(fake.hits(SRC).len(), 2);
}

#[tokio::test]
async fn slashed_source_branch_is_encoded_per_segment() {
    let (fake, gh, _s) = signed_in().await;
    fake.script("/repos/o/r/git/ref/heads/feature/x%20y", vec![tip("s1")]);
    fake.script(REFS, vec![Reply::json(201, json!({}))]);
    assert_eq!(gh.create_gonq_branch("o", "r", "n", "feature/x y").await.unwrap().sha, "s1");
}

#[tokio::test]
async fn collision_is_the_typed_error_and_nothing_is_overwritten() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(SRC, vec![tip("abc")]);
    fake.script(REFS, vec![Reply::json(422, json!({ "message": "Reference already exists" }))]);
    assert_eq!(gh.create_gonq_branch("o", "r", "idea", "main").await.unwrap_err(), GithubError::AlreadyExists);
    let methods: Vec<String> = fake.requests.lock().unwrap().iter().map(|r| r.method.clone()).collect();
    assert!(methods.iter().all(|m| m == "GET" || m == "POST"), "no PATCH/PUT/DELETE: {methods:?}");
}

#[tokio::test]
async fn other_422_is_not_mistaken_for_a_collision() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(SRC, vec![tip("abc")]);
    fake.script(REFS, vec![Reply::json(422, json!({ "message": "Reference name is invalid" }))]);
    assert_eq!(gh.create_gonq_branch("o", "r", "bad", "main").await.unwrap_err(), GithubError::Http { status: 422, message: "Reference name is invalid".into() });
}

#[tokio::test]
async fn missing_source_branch_creates_nothing() {
    let (fake, gh, _s) = signed_in().await;
    assert_eq!(gh.create_gonq_branch("o", "r", "idea", "gone").await.unwrap_err(), GithubError::BranchNotFound);
    assert!(fake.hits(REFS).is_empty());
}

#[tokio::test]
async fn unicode_and_long_names_are_encoded() {
    let (fake, gh, _s) = signed_in().await;
    fake.script("/repos/o/r/git/ref/heads/gonq/caf%C3%A9/%E6%97%A5%E6%9C%AC", vec![Reply::json(200, json!({}))]);
    assert!(gh.gonq_branch_exists("o", "r", "café/日本").await.unwrap());
    let long = "x".repeat(300);
    assert!(!gh.gonq_branch_exists("o", "r", &long).await.unwrap());
    fake.script(SRC, vec![tip("abc")]);
    fake.script(REFS, vec![Reply::json(201, json!({}))]);
    let out = gh.create_gonq_branch("o", "r", "café 日本", "main").await.unwrap();
    assert_eq!(out.branch, "gonq/café 日本");
    let body: Value = serde_json::from_str(&fake.hits(REFS)[0].body).unwrap();
    assert_eq!(body["ref"], "refs/heads/gonq/café 日本");
}

#[tokio::test]
async fn empty_name_is_refused_without_a_request() {
    let (fake, gh, _s) = signed_in().await;
    let before = fake.requests.lock().unwrap().len();
    assert!(matches!(gh.gonq_branch_exists("o", "r", "  ").await, Err(GithubError::Unexpected { .. })));
    assert!(matches!(gh.create_gonq_branch("o", "r", "", "main").await, Err(GithubError::Unexpected { .. })));
    assert_eq!(fake.requests.lock().unwrap().len(), before);
}

#[tokio::test]
async fn create_surfaces_auth_and_permission_errors() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(SRC, vec![tip("abc")]);
    fake.script(REFS, vec![Reply::json(403, json!({ "message": "Resource not accessible by integration" }))]);
    assert!(matches!(gh.create_gonq_branch("o", "r", "a", "main").await.unwrap_err(), GithubError::Http { status: 403, .. }));
    fake.script(REFS, vec![Reply::json(401, json!({ "message": "Bad credentials" }))]);
    assert_eq!(gh.create_gonq_branch("o", "r", "a", "main").await.unwrap_err(), GithubError::NotSignedIn);
}

#[test]
fn collision_serializes_with_kind_already_exists() {
    let v = serde_json::to_value(GithubError::AlreadyExists).unwrap();
    assert_eq!(v["kind"], "already_exists");
}

/// The frontend invokes these exact command names with these exact argument names (src/platform/github.ts);
/// renaming either side must break this test. The fn references fail to compile if a command is renamed.
#[test]
fn command_names_and_arguments_match_the_frontend_contract() {
    let _ = (super::github_branch_exists, super::github_create_branch);
    let handlers = include_str!("../plugin.rs");
    for name in ["github::github_branch_exists,", "github::github_create_branch,"] {
        assert!(handlers.contains(name), "{name} missing from the plugin's command list");
    }
    let src = include_str!("mod.rs");
    let params = |cmd: &str| -> Vec<String> {
        let start = src.find(&format!("pub async fn {cmd}(")).expect("command defined");
        let rest = &src[start..];
        let sig = &rest[..rest.find(") ->").unwrap()];
        let mut names: Vec<String> = sig
            .split(',')
            .filter(|p| p.contains(':'))
            .filter_map(|p| p.split(':').next().map(|n| n.rsplit('(').next().unwrap().trim().to_string()))
            .filter(|n| n != "gh" && !n.is_empty())
            .collect();
        names.sort();
        names
    };
    assert_eq!(params("github_branch_exists"), ["name", "owner", "repo"]);
    assert_eq!(params("github_create_branch"), ["name", "owner", "repo", "source"]);
}
