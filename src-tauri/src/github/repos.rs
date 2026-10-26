//! The signed-in user's repositories (`GET /user/repos`), one page per call.

use super::error::GithubError;
use super::Github;
use serde::{Deserialize, Serialize};

const QUERY: &str = "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Repo {
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub default_branch: String,
    /// Last push; `None` for a repository with no commits.
    pub pushed_at: Option<String>,
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
    pushed_at: Option<String>,
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
            pushed_at: r.pushed_at,
            can_push: r.permissions.is_some_and(|p| p.push),
        }
    }
}

/// One page of repositories; `next_page` is `None` on the last page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RepoPage {
    pub repos: Vec<Repo>,
    pub next_page: Option<u32>,
}

/// The `page` query value of a `Link` target.
fn page_of(link: &str) -> Option<u32> {
    url::Url::parse(link).ok()?.query_pairs().find(|(k, _)| k == "page")?.1.parse().ok()
}

impl Github {
    /// One page (1-based, default first) of the repositories the user can access, most recently
    /// pushed first. The caller follows `next_page` until it is `None`.
    pub async fn list_repos(&self, page: Option<u32>) -> Result<RepoPage, GithubError> {
        let path = match page {
            Some(n) => format!("{QUERY}&page={n}"),
            None => QUERY.to_string(),
        };
        let (raw, next) = self.get_page::<RawRepo>(&path).await?;
        Ok(RepoPage { repos: raw.into_iter().map(Repo::from).collect(), next_page: next.as_deref().and_then(page_of) })
    }
}
