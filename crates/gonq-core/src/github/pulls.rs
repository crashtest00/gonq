//! Open pull requests for head branches: `open_pulls_for_branches`, behind the
//! `github_open_pulls_for_branches` command in mod.rs. The open-PR guard (a tab on a branch with an open
//! PR is read-only) and any later list of branches use it; a single branch is a list of one.
//!
//! Frontend call: `invoke("github_open_pulls_for_branches", { owner, repo, branches })` where `branches`
//! is a string array. It answers an array with one entry per requested branch, in the order asked
//! (duplicates repeated): `{ branch: string, pull: null | { number: number, html_url: string,
//! draft: boolean, title: string | null } }` (snake_case, like the other github_* commands).
//!
//! One pass lists `GET /repos/{o}/{r}/pulls?state=open&per_page=100` through every page. A PR counts for
//! a branch only when its `head.ref` equals the branch and its `head.repo.full_name` is `{o}/{r}` (case
//! blind); fork PRs with the same branch name, PRs whose head repository is gone (null), and PRs that
//! only target the branch are ignored. Draft PRs count. If several qualify the lowest number wins. A
//! branch with no open PR (including one deleted after merge) gives `pull: null`.
//!
//! Network, rate-limit, auth and other HTTP failures are returned as the usual `GithubError`, never as
//! `pull: null`, so the caller can fail closed. Nothing is kept between calls.

use super::browse::encode;
use super::error::GithubError;
use super::Github;
use serde::{Deserialize, Serialize};

/// An open pull request whose head is the asked-for branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct OpenPull {
    pub number: u64,
    pub html_url: String,
    pub draft: bool,
    pub title: Option<String>,
}

/// The answer for one requested branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct BranchPull {
    pub branch: String,
    pub pull: Option<OpenPull>,
}

#[derive(Deserialize)]
struct HeadRepo {
    full_name: String,
}

#[derive(Deserialize)]
struct Head {
    #[serde(rename = "ref")]
    name: String,
    repo: Option<HeadRepo>,
}

#[derive(Deserialize)]
struct RawPull {
    number: u64,
    html_url: String,
    #[serde(default)]
    draft: bool,
    title: Option<String>,
    head: Head,
}

impl Github {
    /// For each of `branches`, the open PR from that branch of `owner/repo` itself, if any.
    pub async fn open_pulls_for_branches(&self, owner: &str, repo: &str, branches: &[String]) -> Result<Vec<BranchPull>, GithubError> {
        let mut found: Vec<Option<OpenPull>> = vec![None; branches.len()];
        if !branches.is_empty() {
            let path = format!("/repos/{}/{}/pulls?state=open&per_page=100", encode(owner), encode(repo));
            let full_name = format!("{owner}/{repo}");
            self.get_paginated::<RawPull, _>(&path, |page| {
                for pr in page {
                    let Some(head_repo) = &pr.head.repo else { continue };
                    if !head_repo.full_name.eq_ignore_ascii_case(&full_name) {
                        continue;
                    }
                    for (slot, branch) in found.iter_mut().zip(branches) {
                        if *branch == pr.head.name && slot.as_ref().is_none_or(|p| pr.number < p.number) {
                            *slot = Some(OpenPull { number: pr.number, html_url: pr.html_url.clone(), draft: pr.draft, title: pr.title.clone() });
                        }
                    }
                }
                true
            })
            .await?;
        }
        Ok(branches.iter().cloned().zip(found).map(|(branch, pull)| BranchPull { branch, pull }).collect())
    }
}
