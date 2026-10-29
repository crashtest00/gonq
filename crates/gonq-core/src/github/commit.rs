//! Commits edited text to a GitHub file on a branch through the contents API: `commit_file`, behind
//! the github_commit_file command in mod.rs. It first reads the file on the branch and writes nothing
//! when the blob sha is no longer the recorded one (or the file or branch is gone); a stale sha at the
//! PUT itself (a race with that check) gives the same `Conflict`. Success returns the new blob and
//! commit shas.
//!
//! The text is sent byte for byte (no line-ending changes here). Other refusals are a `GithubError`
//! carrying GitHub's message; a missing write permission (403 or 404 on the PUT that is not a branch
//! rule) gets [`NEEDS_WRITE`] appended. No branch-protection pre-check is made.
//!
//! Later stories hook in at the two marked comments in `commit_file`: "commit to a new branch"
//! (story 8) and the open-PR refusal (story 9).

use super::browse::{encode, encode_path};
use super::error::GithubError;
use super::Github;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Appended to GitHub's message when the token cannot write to the repository.
pub const NEEDS_WRITE: &str = "This version of Gonq needs write access to the repository.";

/// The result of a commit attempt. `Conflict` is not an error: the frontend opens its ConflictDialog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CommitOutcome {
    /// Written: the file's new blob sha and the new commit's sha.
    Committed { sha: String, commit_sha: String },
    /// The file changed (or went away) since the recorded sha, or the branch is gone. Nothing was written.
    Conflict,
}

#[derive(Deserialize)]
struct Written {
    content: Option<Sha>,
    commit: Option<Sha>,
}

#[derive(Deserialize)]
struct Sha {
    sha: String,
}

/// The fixed commit message.
fn message_for(path: &str) -> String {
    format!("Edit {path} from Gonq")
}

fn lower_has(message: &str, needles: &[&str]) -> bool {
    let m = message.to_lowercase();
    needles.iter().any(|n| m.contains(n))
}

/// A refusal because of a branch rule (protection, required review or checks), not a stale sha.
fn is_branch_rule(message: &str) -> bool {
    lower_has(message, &["protected branch", "branch protection", "rule", "pull request", "status check", "signed commit"])
}

impl Github {
    /// Writes `text` to `path` on `branch` if the file there still has blob `sha`.
    pub async fn commit_file(
        &self,
        owner: &str,
        repo: &str,
        branch: &str,
        path: &str,
        text: &str,
        sha: &str,
    ) -> Result<CommitOutcome, GithubError> {
        // Story 9 (refuse while a PR is open) goes here, before anything is read or written.
        let url = format!("/repos/{}/{}/contents/{}", encode(owner), encode(repo), encode_path(path));

        match self.get_json::<Value>(&format!("{url}?ref={}", encode(branch))).await {
            Ok(v) if v.get("type").and_then(Value::as_str) == Some("file") && v.get("sha").and_then(Value::as_str) == Some(sha) => {}
            // A different sha, a folder or link now, or a reply without a sha.
            Ok(_) => return Ok(CommitOutcome::Conflict),
            // The file or the branch is gone.
            Err(GithubError::Http { status: 404, .. }) => return Ok(CommitOutcome::Conflict),
            Err(e) => return Err(write_error(e)),
        }

        // Story 8 (commit to a new branch) changes which branch is written, and creates it first.
        let body = json!({
            "message": message_for(path),
            "content": STANDARD.encode(text.as_bytes()),
            "sha": sha,
            "branch": branch,
        });
        match self.put_json::<Written>(&url, &body).await {
            Ok(Written { content: Some(c), commit: Some(k) }) => Ok(CommitOutcome::Committed { sha: c.sha, commit_sha: k.sha }),
            Ok(_) => Err(GithubError::Unexpected { message: "the commit reply has no sha".into() }),
            // The file changed between the check and the write: GitHub says 409 or 422 for a stale sha.
            Err(GithubError::Http { status: 409 | 422, message }) if !is_branch_rule(&message) && lower_has(&message, &["sha", "does not match"]) => {
                Ok(CommitOutcome::Conflict)
            }
            Err(e) => Err(write_error(e)),
        }
    }
}

/// GitHub's refusal as-is, except that a missing write permission says so.
fn write_error(e: GithubError) -> GithubError {
    match e {
        GithubError::Http { status: 403 | 404, message } if !is_branch_rule(&message) => {
            GithubError::NoAccess { message: format!("{message} {NEEDS_WRITE}") }
        }
        GithubError::NoAccess { message } => GithubError::NoAccess { message: format!("{message} {NEEDS_WRITE}") },
        other => other,
    }
}
