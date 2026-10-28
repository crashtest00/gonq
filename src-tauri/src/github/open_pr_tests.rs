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
    let out = gh.create_pull("o", "r", "T", "B", "gonq/x", "main").await.unwrap();
    assert_eq!(out, CreatedPull { number: 12, html_url: "https://github.com/o/r/pull/12".into() });
    let posts = fake.hits("/repos/o/r/pulls");
    assert_eq!(posts[0].method, "POST");
    let body: Value = serde_json::from_str(&posts[0].body).unwrap();
    assert_eq!(body, json!({ "title": "T", "body": "B", "head": "gonq/x", "base": "main" }));
}

#[tokio::test]
async fn create_pull_labels_the_pr_gonq_editor() {
    let (fake, gh, _s) = signed_in().await;
    fake.script("/repos/o/r/pulls", vec![Reply::json(201, json!({ "number": 12, "html_url": "https://github.com/o/r/pull/12" }))]);
    fake.script("/repos/o/r/issues/12/labels", vec![Reply::json(200, json!([{ "name": "gonq-editor" }]))]);
    gh.create_pull("o", "r", "T", "B", "gonq/x", "main").await.unwrap();
    let posts = fake.hits("/repos/o/r/issues/12/labels");
    assert_eq!((posts.len(), posts[0].method.as_str()), (1, "POST"));
    let body: Value = serde_json::from_str(&posts[0].body).unwrap();
    assert_eq!(body, json!({ "labels": ["gonq-editor"] }));
}

#[tokio::test]
async fn create_pull_succeeds_when_labelling_fails() {
    let (fake, gh, _s) = signed_in().await;
    fake.script("/repos/o/r/pulls", vec![Reply::json(201, json!({ "number": 13, "html_url": "https://github.com/o/r/pull/13" }))]);
    fake.script("/repos/o/r/issues/13/labels", vec![Reply::json(403, json!({ "message": "Forbidden" }))]);
    let out = gh.create_pull("o", "r", "T", "B", "gonq/x", "main").await.unwrap();
    assert_eq!(out.number, 13);
    assert_eq!(fake.hits("/repos/o/r/issues/13/labels").len(), 1);
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
        serde_json::to_value(CreatedPull { number: 5, html_url: "https://github.com/o/r/pull/5".into() }).unwrap(),
        json!({ "number": 5, "html_url": "https://github.com/o/r/pull/5" })
    );
}
