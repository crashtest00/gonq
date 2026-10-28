//! `branches_exist`, `compare` and `create_pull` against the local fake GitHub, plus a test that pins the
//! exact JSON field names the frontend relies on.

use super::error::GithubError;
use super::fake_github::Reply;
use super::open_pr::{ChangedFile, Comparison, CreatedPull, FileStatus};
use super::tests::signed_in;
use serde_json::{json, Value};

fn names(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[tokio::test]
async fn branches_exist_returns_the_present_subset_and_rejects_other_errors() {
    let (fake, gh, _s) = signed_in().await;
    fake.script("/repos/o/r/branches/a", vec![Reply::json(200, json!({ "name": "a" }))]);
    fake.script("/repos/o/r/branches/feat/x", vec![Reply::json(200, json!({ "name": "feat/x" }))]);
    let out = gh.branches_exist("o", "r", &names(&["a", "missing", "feat/x"])).await.unwrap();
    assert_eq!(out, names(&["a", "feat/x"]));
    assert!(gh.branches_exist("o", "r", &[]).await.unwrap().is_empty());

    fake.script("/repos/o/r/branches/boom", vec![Reply::json(500, json!({ "message": "boom" }))]);
    assert_eq!(gh.branches_exist("o", "r", &names(&["a", "boom"])).await.unwrap_err(), GithubError::Http { status: 500, message: "boom".into() });
    fake.script("/repos/o/r/branches/auth", vec![Reply::json(401, json!({ "message": "Bad credentials" }))]);
    assert_eq!(gh.branches_exist("o", "r", &names(&["auth"])).await.unwrap_err(), GithubError::NotSignedIn);
}

#[tokio::test]
async fn compare_maps_counts_files_and_renames() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(
        "/repos/o/r/compare/main...gonq/x",
        vec![Reply::json(
            200,
            json!({
                "ahead_by": 2, "behind_by": 1, "total_commits": 2,
                "files": [
                    { "filename": "a.md", "status": "modified", "additions": 3, "deletions": 1, "sha": "s" },
                    { "filename": "b.md", "previous_filename": "old.md", "status": "renamed", "additions": 0, "deletions": 0 },
                    { "filename": "c.md", "status": "something_new", "additions": 1, "deletions": 0 },
                ],
            }),
        )],
    );
    let c = gh.compare("o", "r", "main", "gonq/x").await.unwrap();
    assert_eq!((c.ahead_by, c.behind_by, c.truncated), (2, 1, false));
    assert_eq!(c.files[0], ChangedFile { filename: "a.md".into(), previous_filename: None, status: FileStatus::Modified, additions: 3, deletions: 1 });
    assert_eq!(c.files[1].previous_filename.as_deref(), Some("old.md"));
    assert_eq!(c.files[1].status, FileStatus::Renamed);
    assert_eq!(c.files[2].status, FileStatus::Changed);
}

#[tokio::test]
async fn compare_flags_an_incomplete_file_list() {
    let (fake, gh, _s) = signed_in().await;
    let files: Vec<Value> = (0..300).map(|i| json!({ "filename": format!("f{i}"), "status": "added", "additions": 1, "deletions": 0 })).collect();
    fake.script("/repos/o/r/compare/b...full", vec![Reply::json(200, json!({ "ahead_by": 1, "behind_by": 0, "files": files }))]);
    assert!(gh.compare("o", "r", "b", "full").await.unwrap().truncated);
    fake.script("/repos/o/r/compare/b...nofiles", vec![Reply::json(200, json!({ "ahead_by": 1, "behind_by": 0 }))]);
    let c = gh.compare("o", "r", "b", "nofiles").await.unwrap();
    assert!(c.truncated && c.files.is_empty());
}

#[tokio::test]
async fn compare_errors_surface() {
    let (fake, gh, _s) = signed_in().await;
    fake.script("/repos/o/r/compare/main...gone", vec![Reply::json(404, json!({ "message": "Not Found" }))]);
    assert_eq!(gh.compare("o", "r", "main", "gone").await.unwrap_err(), GithubError::Http { status: 404, message: "Not Found".into() });
}

#[tokio::test]
async fn create_pull_posts_the_body_and_returns_number_and_url() {
    let (fake, gh, _s) = signed_in().await;
    fake.script("/repos/o/r/pulls", vec![Reply::json(201, json!({ "number": 12, "html_url": "https://github.com/o/r/pull/12", "title": "T" }))]);
    fake.script("/repos/o/r/labels/gonq-editor", vec![Reply::json(200, json!({ "name": "gonq-editor" }))]);
    fake.script("/repos/o/r/issues/12/labels", vec![Reply::json(200, json!([]))]);
    let out = gh.create_pull("o", "r", "T", "B", "gonq/x", "main").await.unwrap();
    assert_eq!(out, CreatedPull { number: 12, html_url: "https://github.com/o/r/pull/12".into(), label_warning: None });
    let posts = fake.hits("/repos/o/r/pulls");
    assert_eq!(posts[0].method, "POST");
    let body: Value = serde_json::from_str(&posts[0].body).unwrap();
    assert_eq!(body, json!({ "title": "T", "body": "B", "head": "gonq/x", "base": "main" }));
}

const PULLS: &str = "/repos/o/r/pulls";
const APPLY: &str = "/repos/o/r/issues/12/labels";
const GET_LABEL: &str = "/repos/o/r/labels/gonq-editor";
const MAKE_LABEL: &str = "/repos/o/r/labels";

fn pr_reply() -> Reply {
    Reply::json(201, json!({ "number": 12, "html_url": "https://github.com/o/r/pull/12" }))
}

fn applied_names(fake: &super::fake_github::Fake) -> Vec<Value> {
    fake.hits(APPLY).iter().map(|r| serde_json::from_str::<Value>(&r.body).unwrap()["labels"].clone()).collect()
}

#[tokio::test]
async fn existing_label_is_applied_without_create_or_edit() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(PULLS, vec![pr_reply()]);
    fake.script(GET_LABEL, vec![Reply::json(200, json!({ "name": "gonq-editor", "color": "ff0000", "description": "mine" }))]);
    fake.script(APPLY, vec![Reply::json(200, json!([{ "name": "gonq-editor" }]))]);
    let out = gh.create_pull("o", "r", "T", "B", "gonq/x", "main").await.unwrap();
    assert_eq!((out.number, out.label_warning), (12, None));
    assert_eq!(applied_names(&fake), vec![json!(["gonq-editor"])]);
    assert!(fake.hits(MAKE_LABEL).is_empty());
    assert_eq!(fake.hits(GET_LABEL).len(), 1);
}

#[tokio::test]
async fn label_differing_only_by_case_is_reused() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(PULLS, vec![pr_reply()]);
    fake.script(GET_LABEL, vec![Reply::json(200, json!({ "name": "Gonq-Editor" }))]);
    fake.script(APPLY, vec![Reply::json(200, json!([]))]);
    gh.create_pull("o", "r", "T", "B", "gonq/x", "main").await.unwrap();
    assert!(fake.hits(MAKE_LABEL).is_empty());
    assert_eq!(applied_names(&fake), vec![json!(["Gonq-Editor"])]);
}

#[tokio::test]
async fn missing_label_is_created_once_with_fixed_fields_then_applied() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(PULLS, vec![pr_reply()]);
    fake.script(MAKE_LABEL, vec![Reply::json(201, json!({ "name": "gonq-editor" }))]);
    fake.script(APPLY, vec![Reply::json(200, json!([]))]);
    let out = gh.create_pull("o", "r", "T", "B", "gonq/x", "main").await.unwrap();
    assert_eq!(out.label_warning, None);
    let made = fake.hits(MAKE_LABEL);
    assert_eq!((made.len(), made[0].method.as_str()), (1, "POST"));
    let body: Value = serde_json::from_str(&made[0].body).unwrap();
    assert_eq!(body, json!({ "name": "gonq-editor", "color": "0e8a16", "description": "Pull request opened from the Gonq editor" }));
    assert_eq!(applied_names(&fake), vec![json!(["gonq-editor"])]);
}

#[tokio::test]
async fn create_race_422_counts_as_existing_and_applies() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(PULLS, vec![pr_reply()]);
    fake.script(MAKE_LABEL, vec![Reply::json(422, json!({ "message": "Validation Failed", "errors": [{ "code": "already_exists" }] }))]);
    fake.script(APPLY, vec![Reply::json(200, json!([]))]);
    let out = gh.create_pull("o", "r", "T", "B", "gonq/x", "main").await.unwrap();
    assert_eq!(out.label_warning, None);
    assert_eq!(applied_names(&fake).len(), 1);
}

#[tokio::test]
async fn create_failure_keeps_the_pr_and_reports_a_warning_without_retry() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(PULLS, vec![pr_reply()]);
    fake.script(MAKE_LABEL, vec![Reply::json(403, json!({ "message": "Resource not accessible" }))]);
    let out = gh.create_pull("o", "r", "T", "B", "gonq/x", "main").await.unwrap();
    assert_eq!((out.number, out.html_url.as_str()), (12, "https://github.com/o/r/pull/12"));
    assert!(out.label_warning.unwrap().contains("Resource not accessible"));
    assert_eq!((fake.hits(PULLS).len(), fake.hits(MAKE_LABEL).len(), fake.hits(APPLY).len()), (1, 1, 0));
}

#[tokio::test]
async fn apply_failure_keeps_the_pr_and_reports_a_warning_without_retry() {
    for status in [403, 404, 422] {
        let (fake, gh, _s) = signed_in().await;
        fake.script(PULLS, vec![pr_reply()]);
        fake.script(GET_LABEL, vec![Reply::json(200, json!({ "name": "gonq-editor" }))]);
        fake.script(APPLY, vec![Reply::json(status, json!({ "message": "nope" }))]);
        let out = gh.create_pull("o", "r", "T", "B", "gonq/x", "main").await.unwrap();
        assert_eq!(out.number, 12);
        assert!(out.label_warning.unwrap().contains(&status.to_string()));
        assert_eq!((fake.hits(PULLS).len(), fake.hits(APPLY).len()), (1, 1));
    }
}

#[tokio::test]
async fn network_error_while_labelling_is_a_warning() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(PULLS, vec![pr_reply()]);
    fake.script(GET_LABEL, vec![Reply::drop_connection()]);
    let out = gh.create_pull("o", "r", "T", "B", "gonq/x", "main").await.unwrap();
    assert_eq!(out.number, 12);
    assert!(out.label_warning.unwrap().contains("could not reach GitHub"));
}

#[tokio::test]
async fn rate_limit_and_bad_token_while_labelling_are_warnings_not_failures() {
    let (fake, gh, _s) = signed_in().await;
    fake.script(PULLS, vec![pr_reply()]);
    fake.script(GET_LABEL, vec![Reply::json(403, json!({ "message": "API rate limit exceeded" })).header("x-ratelimit-remaining", "0")]);
    let out = gh.create_pull("o", "r", "T", "B", "gonq/x", "main").await.unwrap();
    assert!(out.label_warning.unwrap().contains("rate limit"));

    fake.script(PULLS, vec![pr_reply()]);
    fake.script(GET_LABEL, vec![Reply::json(401, json!({ "message": "Bad credentials" }))]);
    let out = gh.create_pull("o", "r", "T", "B", "gonq/x", "main").await.unwrap();
    assert_eq!(out.number, 12);
    assert_eq!(out.label_warning.as_deref(), Some("not signed in to GitHub"));
}

#[test]
fn the_command_takes_no_label_argument() {
    // Tauri ignores unknown invoke args, so a label sent by the frontend never reaches create_pull; pin that the
    // command source has no label parameter.
    let src = include_str!("mod.rs");
    let start = src.find("pub async fn github_create_pull(").unwrap();
    let sig = &src[start..src[start..].find(") ->").unwrap() + start];
    assert!(!sig.to_lowercase().contains("label"), "{sig}");
}

#[tokio::test]
async fn create_pull_refusals_keep_githubs_message() {
    let (fake, gh, _s) = signed_in().await;
    fake.script("/repos/o/r/pulls", vec![Reply::json(422, json!({ "message": "No commits between main and gonq/x" }))]);
    assert_eq!(
        gh.create_pull("o", "r", "T", "", "gonq/x", "main").await.unwrap_err(),
        GithubError::Http { status: 422, message: "No commits between main and gonq/x".into() }
    );
    fake.script("/repos/o/r/pulls", vec![Reply::json(422, json!({ "message": "A pull request already exists for o:gonq/x." }))]);
    let err = serde_json::to_value(gh.create_pull("o", "r", "T", "", "gonq/x", "main").await.unwrap_err()).unwrap();
    assert_eq!(err["kind"], "http");
    assert_eq!(err["message"], "A pull request already exists for o:gonq/x.");
}

/// Pins the reply shapes the TypeScript side maps: exact field names, snake_case, null for no rename.
#[test]
fn reply_shapes_match_the_frontend_contract() {
    let compare = Comparison {
        ahead_by: 1,
        behind_by: 2,
        files: vec![
            ChangedFile { filename: "a".into(), previous_filename: None, status: FileStatus::Added, additions: 4, deletions: 0 },
            ChangedFile { filename: "b".into(), previous_filename: Some("c".into()), status: FileStatus::Renamed, additions: 0, deletions: 0 },
        ],
        truncated: false,
    };
    assert_eq!(
        serde_json::to_value(&compare).unwrap(),
        json!({
            "ahead_by": 1, "behind_by": 2, "truncated": false,
            "files": [
                { "filename": "a", "previous_filename": null, "status": "added", "additions": 4, "deletions": 0 },
                { "filename": "b", "previous_filename": "c", "status": "renamed", "additions": 0, "deletions": 0 },
            ],
        })
    );
    for (s, w) in [
        (FileStatus::Added, "added"),
        (FileStatus::Modified, "modified"),
        (FileStatus::Removed, "removed"),
        (FileStatus::Renamed, "renamed"),
        (FileStatus::Copied, "copied"),
        (FileStatus::Changed, "changed"),
        (FileStatus::Unchanged, "unchanged"),
    ] {
        assert_eq!(serde_json::to_value(s).unwrap(), json!(w));
    }
    assert_eq!(
        serde_json::to_value(CreatedPull { number: 5, html_url: "https://github.com/o/r/pull/5".into(), label_warning: Some("w".into()) }).unwrap(),
        json!({ "number": 5, "html_url": "https://github.com/o/r/pull/5", "label_warning": "w" })
    );
    assert_eq!(
        serde_json::to_value(CreatedPull { number: 5, html_url: "u".into(), label_warning: None }).unwrap(),
        json!({ "number": 5, "html_url": "u", "label_warning": null })
    );
}
