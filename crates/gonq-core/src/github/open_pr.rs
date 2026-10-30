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
//! - `github_create_pull { owner, repo, title, body, head, base }` -> `{ number, html_url, label_warning }` from
//!   `POST /repos/{o}/{r}/pulls`, then the new PR is labelled `gonq-editor`
//!   (`GET .../labels/gonq-editor`, `POST .../labels` only when missing, `POST .../issues/{number}/labels`). Labelling
//!   is best effort: on failure the command still succeeds and the reason comes back as `label_warning`.

use super::browse::{encode, encode_path};
use super::error::GithubError;
use super::Github;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Label put on every pull request opened through `create_pull`. The one place the name is defined: it is not a
/// parameter of `github_create_pull`, and the frontend never sends or edits it.
pub const PR_LABEL: &str = "gonq-editor";
/// Colour and description used only when the repository has no such label yet; an existing label is never edited.
const PR_LABEL_COLOR: &str = "0e8a16";
const PR_LABEL_DESCRIPTION: &str = "Pull request opened from the Gonq editor";

/// GitHub lists at most this many files in a compare reply.
const COMPARE_FILE_CAP: usize = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct CreatedPull {
    pub number: u64,
    pub html_url: String,
    /// Why the `gonq-editor` label could not be set, `null` when it was. The PR exists either way.
    #[serde(default)]
    pub label_warning: Option<String>,
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

    /// Opens a pull request from `head` into `base`, then labels it `PR_LABEL`. Labelling is best effort and runs once
    /// (no retry): a failure becomes `label_warning` on the returned pull request, never an error.
    pub async fn create_pull(&self, owner: &str, repo: &str, title: &str, body: &str, head: &str, base: &str) -> Result<CreatedPull, GithubError> {
        let path = format!("/repos/{}/{}/pulls", encode(owner), encode(repo));
        let mut pull: CreatedPull = self.post_json(&path, &json!({ "title": title, "body": body, "head": head, "base": base })).await?;
        pull.label_warning = self.label_pull(owner, repo, pull.number).await.err().map(|e| e.to_string());
        Ok(pull)
    }

    /// Makes sure the label exists (creating it once if missing; never editing an existing one) and applies it.
    async fn label_pull(&self, owner: &str, repo: &str, number: u64) -> Result<(), GithubError> {
        let base = format!("/repos/{}/{}", encode(owner), encode(repo));
        // GitHub matches label names case-insensitively, so an existing "Gonq-Editor" is found and reused as is.
        let name = match self.get_json::<Value>(&format!("{base}/labels/{}", encode(PR_LABEL))).await {
            Ok(label) => label["name"].as_str().unwrap_or(PR_LABEL).to_string(),
            Err(GithubError::Http { status: 404, .. }) => {
                let made = self.post_json::<Value>(
                    &format!("{base}/labels"),
                    &json!({ "name": PR_LABEL, "color": PR_LABEL_COLOR, "description": PR_LABEL_DESCRIPTION }),
                ).await;
                match made {
                    // Lost a race with someone creating it: it exists now, so apply it.
                    Ok(_) | Err(GithubError::Http { status: 422, .. }) => PR_LABEL.to_string(),
                    Err(e) => return Err(e),
                }
            }
            Err(e) => return Err(e),
        };
        self.post_json::<Value>(&format!("{base}/issues/{number}/labels"), &json!({ "labels": [name] })).await?;
        Ok(())
    }
}
