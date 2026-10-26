//! The signed-in user's repositories (`GET /user/repos`), all pages.

use super::error::GithubError;
use super::Github;
use serde::{Deserialize, Serialize};

/// Safety stop: 100 per page, so this is at most 5000 repositories.
pub(super) const MAX_PAGES: usize = 50;
const FIRST_PAGE: &str = "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Repo {
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub default_branch: String,
    pub description: Option<String>,
    pub updated_at: Option<String>,
    /// Whether the user can push (false when GitHub omits permissions).
    pub can_push: bool,
}

#[derive(Deserialize)]
struct Owner {
    login: String,
}

#[derive(Deserialize)]
struct Permissions {
    #[serde(default)]
    push: bool,
}

#[derive(Deserialize)]
struct RawRepo {
    name: String,
    full_name: String,
    owner: Owner,
    #[serde(default)]
    private: bool,
    #[serde(default)]
    default_branch: Option<String>,
    description: Option<String>,
    updated_at: Option<String>,
    permissions: Option<Permissions>,
}

impl From<RawRepo> for Repo {
    fn from(r: RawRepo) -> Self {
        Repo {
            owner: r.owner.login,
            name: r.name,
            full_name: r.full_name,
            private: r.private,
            default_branch: r.default_branch.unwrap_or_else(|| "main".into()),
            description: r.description,
            updated_at: r.updated_at,
            can_push: r.permissions.is_some_and(|p| p.push),
        }
    }
}

impl Github {
    /// Every repository the user can access, most recently updated first.
    pub async fn list_repos(&self) -> Result<Vec<Repo>, GithubError> {
        let mut repos = Vec::new();
        let mut pages = 0;
        self.get_paginated::<RawRepo, _>(FIRST_PAGE, |page| {
            repos.extend(page.into_iter().map(Repo::from));
            pages += 1;
            pages < MAX_PAGES
        })
        .await?;
        Ok(repos)
    }
}
