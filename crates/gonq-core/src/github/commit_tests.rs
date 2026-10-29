//! `commit_file` against the local fake GitHub: success, conflict before the PUT, a stale sha at the
//! PUT (409 and 422), branch-rule refusals, missing write access, a dropped connection, and empty and ~1 MB text.

use super::commit::{CommitOutcome, NEEDS_WRITE};
use super::error::GithubError;
use super::fake_github::{Fake, Reply};
use super::tests::signed_in;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

const FILE: &str = "/repos/o/r/contents/docs/a.md";

fn current(sha: &str) -> Reply {
    Reply::json(200, json!({ "type": "file", "sha": sha, "name": "a.md", "path": "docs/a.md" }))
}

fn written() -> Reply {
    Reply::json(200, json!({ "content": { "sha": "newblob" }, "commit": { "sha": "newcommit" } }))
}

/// The pre-check GET is answered first, the PUT second.
fn script(fake: &Fake, get: Reply, put: Reply) {
    fake.script(FILE, vec![get, put]);
}

fn puts(fake: &Fake) -> Vec<super::fake_github::Req> {
    fake.requests.lock().unwrap().iter().filter(|r| r.method == "PUT").cloned().collect()
}

async fn commit(gh: &super::Github, text: &str) -> Result<CommitOutcome, GithubError> {
    gh.commit_file("o", "r", "dev", "docs/a.md", text, "b10b").await
}

#[tokio::test]
async fn commits_exact_bytes_and_returns_new_shas() {
    let (fake, gh, _s) = signed_in().await;
    script(&fake, current("b10b"), written());
    let out = commit(&gh, "a\r\nb\r\n\u{feff}é").await.unwrap();
    assert_eq!(out, CommitOutcome::Committed { sha: "newblob".into(), commit_sha: "newcommit".into() });
    let put = &puts(&fake)[0];
    let body: Value = serde_json::from_str(&put.body).unwrap();
    assert_eq!(STANDARD.decode(body["content"].as_str().unwrap()).unwrap(), "a\r\nb\r\n\u{feff}é".as_bytes());
    assert_eq!(body["sha"], "b10b");
    assert_eq!(body["branch"], "dev");
    assert_eq!(body["message"], "Edit docs/a.md from Gonq");
    assert!(fake.hits("/repos/o/r/contents/docs/a.md?ref=dev").len() == 1);
}

#[tokio::test]
async fn different_sha_is_a_conflict_and_writes_nothing() {
    let (fake, gh, _s) = signed_in().await;
    script(&fake, current("someone-elses"), written());
    assert_eq!(commit(&gh, "x").await.unwrap(), CommitOutcome::Conflict);
    assert!(puts(&fake).is_empty());
}

#[tokio::test]
async fn missing_file_or_branch_is_a_conflict_and_writes_nothing() {
    let (fake, gh, _s) = signed_in().await;
    script(&fake, Reply::json(404, json!({"message": "Not Found"})), written());
    assert_eq!(commit(&gh, "x").await.unwrap(), CommitOutcome::Conflict);
    assert!(puts(&fake).is_empty());
}

#[tokio::test]
async fn stale_sha_at_the_put_is_a_conflict_for_409_and_422() {
    for status in [409u16, 422] {
        let (fake, gh, _s) = signed_in().await;
        script(&fake, current("b10b"), Reply::json(status, json!({"message": "docs/a.md does not match b10b"})));
        assert_eq!(commit(&gh, "x").await.unwrap(), CommitOutcome::Conflict, "status {status}");
        assert_eq!(puts(&fake).len(), 1);
    }
}

#[tokio::test]
async fn branch_rule_refusals_carry_githubs_message() {
    for (status, message) in [
        (403u16, "Protected branch update failed for refs/heads/dev."),
        (409, "Repository rule violations found\n\nChanges must be made through a pull request."),
    ] {
        let (fake, gh, _s) = signed_in().await;
        script(&fake, current("b10b"), Reply::json(status, json!({ "message": message })));
        assert_eq!(commit(&gh, "x").await.unwrap_err(), GithubError::Http { status, message: message.into() });
    }
}

#[tokio::test]
async fn no_write_access_says_so() {
    for (status, message) in [(403u16, "Resource not accessible by personal access token"), (404, "Not Found")] {
        let (fake, gh, _s) = signed_in().await;
        script(&fake, current("b10b"), Reply::json(status, json!({ "message": message })));
        match commit(&gh, "x").await.unwrap_err() {
            GithubError::NoAccess { message: m } => assert_eq!(m, format!("{message} {NEEDS_WRITE}")),
            other => panic!("status {status}: {other:?}"),
        }
    }
}

#[tokio::test]
async fn other_refusals_pass_through_unchanged() {
    let (fake, gh, _s) = signed_in().await;
    script(&fake, current("b10b"), Reply::json(500, json!({"message": "boom"})));
    assert_eq!(commit(&gh, "x").await.unwrap_err(), GithubError::Http { status: 500, message: "boom".into() });
}

#[tokio::test]
async fn a_dropped_connection_is_a_network_error() {
    let (fake, gh, _s) = signed_in().await;
    script(&fake, Reply::drop_connection(), written());
    assert!(matches!(commit(&gh, "x").await, Err(GithubError::Network { .. })));
    script(&fake, current("b10b"), Reply::drop_connection());
    assert!(matches!(commit(&gh, "x").await, Err(GithubError::Network { .. })));
}

#[tokio::test]
async fn empty_and_one_megabyte_text_are_sent_whole() {
    let (fake, gh, _s) = signed_in().await;
    script(&fake, current("b10b"), written());
    commit(&gh, "").await.unwrap();
    let body: Value = serde_json::from_str(&puts(&fake)[0].body).unwrap();
    assert_eq!(body["content"], "");

    let big = "0123456789abcdef\r\n".repeat(1024 * 1024 / 18);
    script(&fake, current("b10b"), written());
    commit(&gh, &big).await.unwrap();
    let body: Value = serde_json::from_str(&puts(&fake)[1].body).unwrap();
    assert_eq!(STANDARD.decode(body["content"].as_str().unwrap()).unwrap(), big.as_bytes());
}
