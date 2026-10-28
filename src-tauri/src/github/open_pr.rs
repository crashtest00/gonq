//! GitHub calls behind the Open PR flow: `branches_exist`, `compare` and `create_pull`, exposed as the
//! `github_branches_exist`, `github_compare` and `github_create_pull` commands in mod.rs.
//!
//! Frontend contract (JS argument keys exactly as below; replies are snake_case JSON; errors reject with the
//! usual `GithubError`, and GitHub's refusals such as 422 "No commits between..." or "A pull request already
//! exists..." arrive as kind `http` with GitHub's message unchanged):
//! - `github_branches_exist { owner, repo, branches }` -> `string[]`, the subset of `branches` that exist
//!   (order and duplicates as asked): `GET /repos/{o}/{r}/branches/<b>` per branch, 404 = absent, any other
//!   failure rejects.
//! - `github_compare { owner, repo, base, head }` -> `{ ahead_by, behind_by, files: [{ filename,
//!   previous_filename | null, status, additions, deletions }], truncated }` from
//!   `GET /repos/{o}/{r}/compare/{base}...{head}`. `status` is one of added, modified, removed, renamed,
//!   copied, changed, unchanged (anything else GitHub might add reads as `changed`). `truncated` is true
//!   when GitHub's file list is incomplete: it caps the list at 300 files, so 300 or more files, or a reply
//!   without a file list, counts as truncated.
//! - `github_create_pull { owner, repo, title, body, head, base }` -> `{ number, html_url }` from
//!   `POST /repos/{o}/{r}/pulls`, then the new PR is labelled `gonq-editor` with
//!   `POST /repos/{o}/{r}/issues/{number}/labels` (GitHub creates the label if the repo lacks it). Labelling is
//!   best effort: if it fails the PR still exists, so the command succeeds and the failure is dropped.

use super::browse::{encode, encode_path};
use super::error::GithubError;
use super::Github;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Label put on every pull request opened through `create_pull`.
pub const PR_LABEL: &str = "gonq-editor";

/// GitHub lists at most this many files in a compare reply.
const COMPARE_FILE_CAP: usize = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileStatus {
    Added,
    Modified,
    Removed,
    Renamed,
    Copied,
    Unchanged,
    #[serde(other)]
    Changed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangedFile {
    pub filename: String,
    #[serde(default)]
    pub previous_filename: Option<String>,
    pub status: FileStatus,
    #[serde(default)]
    pub additions: u64,
    #[serde(default)]
    pub deletions: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Comparison {
    pub ahead_by: u64,
    pub behind_by: u64,
    pub files: Vec<ChangedFile>,
    pub truncated: bool,
}

#[derive(Deserialize)]
struct RawComparison {
    ahead_by: u64,
    behind_by: u64,
    files: Option<Vec<ChangedFile>>,
}

/// The pull request that was opened.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CreatedPull {
    pub number: u64,
    pub html_url: String,
}

impl Github {
    /// The subset of `branches` that exist in `owner/repo`, in the order asked.
    pub async fn branches_exist(&self, owner: &str, repo: &str, branches: &[String]) -> Result<Vec<String>, GithubError> {
        let mut found = Vec::new();
        for branch in branches {
            let path = format!("/repos/{}/{}/branches/{}", encode(owner), encode(repo), encode_path(branch));
            match self.get_json::<Value>(&path).await {
                Ok(_) => found.push(branch.clone()),
                Err(GithubError::Http { status: 404, .. }) => {}
                Err(e) => return Err(e),
            }
        }
        Ok(found)
    }

    /// What `head` has that `base` lacks (and the reverse), with the changed files.
    pub async fn compare(&self, owner: &str, repo: &str, base: &str, head: &str) -> Result<Comparison, GithubError> {
        let path = format!("/repos/{}/{}/compare/{}...{}", encode(owner), encode(repo), encode_path(base), encode_path(head));
        let raw: RawComparison = self.get_json(&path).await?;
        let truncated = raw.files.as_ref().is_none_or(|f| f.len() >= COMPARE_FILE_CAP);
        Ok(Comparison { ahead_by: raw.ahead_by, behind_by: raw.behind_by, files: raw.files.unwrap_or_default(), truncated })
    }

    /// Opens a pull request from `head` into `base` and labels it `PR_LABEL` (best effort).
    pub async fn create_pull(&self, owner: &str, repo: &str, title: &str, body: &str, head: &str, base: &str) -> Result<CreatedPull, GithubError> {
        let path = format!("/repos/{}/{}/pulls", encode(owner), encode(repo));
        let pull: CreatedPull = self.post_json(&path, &json!({ "title": title, "body": body, "head": head, "base": base })).await?;
        let labels = format!("/repos/{}/{}/issues/{}/labels", encode(owner), encode(repo), pull.number);
        // The PR is already open; a failed label must not make the caller think it was not.
        let _ = self.post_json::<Value>(&labels, &json!({ "labels": [PR_LABEL] })).await;
        Ok(pull)
    }
}
