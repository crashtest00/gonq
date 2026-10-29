//! `open_pulls_for_branches` against the local fake GitHub: no PRs, one, several, a fork with the same
//! branch name, a deleted fork, a PR that only targets the branch, drafts, pagination, and rate-limit,
//! auth, server and network failures surfacing as errors.

use super::error::GithubError;
use super::fake_github::Reply;
use super::pulls::{BranchPull, OpenPull};
use super::tests::signed_in;
use serde_json::{json, Value};

const PULLS: &str = "/repos/o/r/pulls";

fn pr(number: u64, head_ref: &str, head_repo: Option<&str>, base: &str, draft: bool) -> Value {
    json!({
        "number": number,
        "html_url": format!("https://github.com/o/r/pull/{number}"),
        "draft": draft,
        "title": format!("PR {number}"),
        "head": { "ref": head_ref, "repo": head_repo.map(|n| json!({ "full_name": n })) },
        "base": { "ref": base, "repo": { "full_name": "o/r" } },
    })
}

fn names(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn open(number: u64, draft: bool) -> Option<OpenPull> {
    Some(OpenPull { number, html_url: format!("https://github.com/o/r/pull/{number}"), draft, title: Some(format!("PR {number}")) })
}

#[tokio::test]
async fn no_prs_gives_none_for_every_branch() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(PULLS, vec![Reply::json(200, json!([]))]);
    let out = gh.open_pulls_for_branches("o", "r", &names(&["a", "b"])).await.unwrap();
    assert_eq!(out, vec![BranchPull { branch: "a".into(), pull: None }, BranchPull { branch: "b".into(), pull: None }]);
    assert_eq!(fake.hits("/repos/o/r/pulls?state=open&per_page=100").len(), 1);
}

#[tokio::test]
async fn no_branches_makes_no_request() {
    let (fake, gh, _s) = signed_in().await;
    assert!(gh.open_pulls_for_branches("o", "r", &[]).await.unwrap().is_empty());
    assert!(fake.requests.lock().unwrap().iter().all(|r| !r.path.starts_with(PULLS)));
}

#[tokio::test]
async fn one_pr_matches_its_head_branch() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(PULLS, vec![Reply::json(200, json!([pr(7, "gonq/x", Some("o/r"), "main", false)]))]);
    let out = gh.open_pulls_for_branches("o", "r", &names(&["gonq/x"])).await.unwrap();
    assert_eq!(out[0].pull, open(7, false));
}

#[tokio::test]
async fn several_prs_serve_a_list_of_branches_in_one_pass() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(
        PULLS,
        vec![Reply::json(200, json!([pr(3, "feat", Some("o/r"), "main", false), pr(4, "other", Some("o/r"), "main", true), pr(5, "unasked", Some("o/r"), "main", false)]))],
    );
    let out = gh.open_pulls_for_branches("o", "r", &names(&["feat", "none", "other", "feat"])).await.unwrap();
    let got: Vec<(&str, Option<OpenPull>)> = out.iter().map(|b| (b.branch.as_str(), b.pull.clone())).collect();
    assert_eq!(got, vec![("feat", open(3, false)), ("none", None), ("other", open(4, true)), ("feat", open(3, false))]);
    assert_eq!(fake.hits("/repos/o/r/pulls?state=open&per_page=100").len(), 1);
}

#[tokio::test]
async fn fork_deleted_fork_and_base_only_prs_are_ignored() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(
        PULLS,
        vec![Reply::json(
            200,
            json!([
                pr(1, "feat", Some("someone/r"), "main", false),
                pr(2, "feat", None, "main", false),
                pr(3, "topic", Some("o/r"), "feat", false),
            ]),
        )],
    );
    let out = gh.open_pulls_for_branches("o", "r", &names(&["feat"])).await.unwrap();
    assert_eq!(out[0].pull, None);
}

#[tokio::test]
async fn own_repo_pr_wins_over_a_fork_with_the_same_branch_name() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(PULLS, vec![Reply::json(200, json!([pr(9, "feat", Some("fork/r"), "main", false), pr(8, "feat", Some("O/R"), "main", true)]))]);
    let out = gh.open_pulls_for_branches("o", "r", &names(&["feat"])).await.unwrap();
    assert_eq!(out[0].pull, open(8, true));
}

#[tokio::test]
async fn follows_every_page() {
    let (fake, gh, _s) = signed_in().await;
    let next = |n: u32| format!("<{}{PULLS}?state=open&per_page=100&page={n}>; rel=\"next\"", fake.base);
    fake.script(
        PULLS,
        vec![
            Reply::json(200, json!([pr(1, "a", Some("o/r"), "main", false)])).header("link", &next(2)),
            Reply::json(200, json!([pr(2, "b", Some("o/r"), "main", false)])).header("link", &next(3)),
            Reply::json(200, json!([pr(3, "c", Some("o/r"), "main", false)])),
        ],
    );
    let out = gh.open_pulls_for_branches("o", "r", &names(&["c", "a"])).await.unwrap();
    assert_eq!(out[0].pull, open(3, false));
    assert_eq!(out[1].pull, open(1, false));
    assert_eq!(fake.requests.lock().unwrap().iter().filter(|r| r.path.starts_with(PULLS)).count(), 3);
}

#[tokio::test]
async fn failures_are_errors_not_none() {
    let (fake, gh, _s) = signed_in().await;
    let ask = |gh: std::sync::Arc<super::Github>| async move { gh.open_pulls_for_branches("o", "r", &names(&["a"])).await };

    fake.script(PULLS, vec![Reply::json(403, json!({"message": "API rate limit exceeded"})).header("x-ratelimit-remaining", "0").header("x-ratelimit-reset", "1900000000")]);
    assert_eq!(ask(gh.clone()).await.unwrap_err(), GithubError::RateLimited { reset_at: Some(1_900_000_000), message: "API rate limit exceeded".into() });

    fake.script(PULLS, vec![Reply::json(500, json!({"message": "boom"}))]);
    assert_eq!(ask(gh.clone()).await.unwrap_err(), GithubError::Http { status: 500, message: "boom".into() });

    fake.script(PULLS, vec![Reply::drop_connection()]);
    assert!(matches!(ask(gh.clone()).await, Err(GithubError::Network { .. })));

    // An error on a later page fails the whole call, too.
    let link = format!("<{}{PULLS}?page=2>; rel=\"next\"", fake.base);
    fake.script(PULLS, vec![Reply::json(200, json!([])).header("link", &link), Reply::json(502, json!({"message": "bad gateway"}))]);
    assert!(matches!(ask(gh.clone()).await, Err(GithubError::Http { status: 502, .. })));

    fake.script(PULLS, vec![Reply::json(401, json!({"message": "Bad credentials"}))]);
    assert_eq!(ask(gh).await.unwrap_err(), GithubError::NotSignedIn);
}
