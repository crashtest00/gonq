//! Checking for and creating a `gonq/<name>` branch through the git refs API: `gonq_branch_exists` and
//! `create_gonq_branch`, behind the `github_branch_exists` and `github_create_branch` commands
//! in mod.rs. The two are separate steps (check, create, then the commit command) that the frontend chains.
//!
//! Frontend calls (snake_case args, like the other github_* commands):
//! - `invoke("github_branch_exists", { owner, repo, name })` answers a boolean: `GET
//!   /git/ref/heads/gonq/<name>`, 404 = `false`, 200 = `true`. Advisory only; other failures are a `GithubError`.
//! - `invoke("github_create_branch", { owner, repo, name, source })` answers
//!   `{ branch: "gonq/<name>", sha }`, the full branch name and the commit it was cut from. The tip of
//!   `source` is fetched at call time, then `POST /git/refs` creates `refs/heads/gonq/<name>`.
//!
//! `name` is the user's text; `gonq/` is always prepended here and nothing else is added. Names are
//! percent-encoded per segment, so long and non-ASCII names go through. An empty name is refused before
//! any request. Errors: a missing source branch is `BranchNotFound` (no ref is created); GitHub's 422
//! "Reference already exists" is the typed `AlreadyExists` (kind `already_exists`); an existing ref is never updated or
//! overwritten (there is no force path); other failures are the usual `GithubError`.

use super::browse::{encode, encode_path};
use super::error::GithubError;
use super::Github;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const PREFIX: &str = "gonq/";

/// The branch that was created and the commit it points at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CreatedBranch {
    pub branch: String,
    pub sha: String,
}

#[derive(Deserialize)]
struct RefObject {
    sha: String,
}

#[derive(Deserialize)]
struct RefReply {
    object: Option<RefObject>,
}

fn unexpected(m: &str) -> GithubError {
    GithubError::Unexpected { message: m.into() }
}

fn full_name(name: &str) -> Result<String, GithubError> {
    if name.trim().is_empty() {
        return Err(unexpected("the branch name is empty"));
    }
    Ok(format!("{PREFIX}{name}"))
}

impl Github {
    /// Whether `gonq/<name>` exists in `owner/repo`.
    pub async fn gonq_branch_exists(&self, owner: &str, repo: &str, name: &str) -> Result<bool, GithubError> {
        let branch = full_name(name)?;
        let path = format!("/repos/{}/{}/git/ref/heads/{}", encode(owner), encode(repo), encode_path(&branch));
        match self.get_json::<Value>(&path).await {
            Ok(_) => Ok(true),
            Err(GithubError::Http { status: 404, .. }) => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// Creates `gonq/<name>` at the current tip of `source_branch`.
    pub async fn create_gonq_branch(&self, owner: &str, repo: &str, name: &str, source_branch: &str) -> Result<CreatedBranch, GithubError> {
        let branch = full_name(name)?;
        let repo_path = format!("/repos/{}/{}", encode(owner), encode(repo));

        let tip: RefReply = match self.get_json(&format!("{repo_path}/git/ref/heads/{}", encode_path(source_branch))).await {
            Ok(v) => v,
            Err(GithubError::Http { status: 404, .. }) => return Err(GithubError::BranchNotFound),
            Err(e) => return Err(e),
        };
        let sha = tip.object.ok_or_else(|| unexpected("the source branch reply has no sha"))?.sha;

        let body = json!({ "ref": format!("refs/heads/{branch}"), "sha": sha });
        match self.post_json::<Value>(&format!("{repo_path}/git/refs"), &body).await {
            Ok(_) => Ok(CreatedBranch { branch, sha }),
            Err(GithubError::Http { status: 422, message }) if message.to_lowercase().contains("already exists") => Err(GithubError::AlreadyExists),
            Err(e) => Err(e),
        }
    }
}
