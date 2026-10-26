//! Branches and folder listings of a repository, for the repo navigator: `list_branches` (the default
//! branch first on page 1, 100 per page) and `list_folder` (folders and Markdown files like
//! `folder::list_directory`, truncated at 1000 entries), behind the github_list_branches and
//! github_list_folder commands in mod.rs; and `read_file` (a Markdown file's text with its blob sha and
//! the branch-tip commit sha it was read at), behind github_read_file.
//!
//! `read_file` fails with a typed `GithubError`: `NotSignedIn` (401), `NoAccess` (403 that is not a rate
//! limit), `RateLimited { reset_at }`, `BranchNotFound` (also what a private repository's 404 looks like),
//! `EmptyRepo`, `PathNotFound`, `NotAFile` (a folder), `Symlink`, `Submodule`, `FileTooLarge` (over 1 MB),
//! and `Unexpected` (malformed reply, not UTF-8); other statuses are `Http`, transport failures `Network`.

use super::error::GithubError;
use super::repos::page_of;
use super::Github;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// GitHub's contents API lists at most this many entries of a directory.
const CONTENTS_LIMIT: usize = 1000;

/// Percent-encodes everything but RFC 3986 unreserved bytes (so `/` becomes `%2F`).
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Encodes each `/`-separated segment, keeping the separators; empty segments are dropped.
fn encode_path(path: &str) -> String {
    path.split('/').filter(|s| !s.is_empty()).map(encode).collect::<Vec<_>>().join("/")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BranchPage {
    pub default_branch: String,
    /// Names; on the first page the default branch comes first, and it is listed nowhere else.
    pub branches: Vec<String>,
    pub next_page: Option<u32>,
}

#[derive(Deserialize)]
struct RawBranch {
    name: String,
}

#[derive(Deserialize)]
struct RawRepo {
    #[serde(default)]
    default_branch: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    Folder,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RepoEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FolderListing {
    pub entries: Vec<RepoEntry>,
    /// GitHub may have cut the folder off (very large folders): the list can be incomplete.
    pub truncated: bool,
}

#[derive(Deserialize)]
struct RawEntry {
    name: String,
    path: String,
    #[serde(rename = "type")]
    kind: String,
}

/// The same rule as the local navigator (`folder::list_directory`): folders and Markdown files,
/// no dotfiles, folders first, each group A-Z ignoring case. Symlinks and submodules are dropped.
fn shown(raw: Vec<RawEntry>) -> Vec<RepoEntry> {
    let mut entries: Vec<RepoEntry> = raw
        .into_iter()
        .filter(|e| !e.name.starts_with('.'))
        .filter_map(|e| {
            let kind = match e.kind.as_str() {
                "dir" => EntryKind::Folder,
                "file" if crate::folder::is_markdown(&e.name) => EntryKind::File,
                _ => return None,
            };
            Some(RepoEntry { name: e.name, path: e.path, kind })
        })
        .collect();
    entries.sort_by_cached_key(|e| (e.kind == EntryKind::File, e.name.to_lowercase()));
    entries
}

/// A file read from a branch: its text, the blob sha (for a later update) and the commit it was read at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RepoFile {
    /// The path of the file in the repository, as GitHub reports it.
    pub path: String,
    /// The file's name (the last segment of `path`).
    pub name: String,
    pub content: String,
    /// The blob sha of the file, which the contents API wants back when updating it.
    pub sha: String,
    /// The branch tip when read; the file is exactly as of this commit.
    pub commit_sha: String,
}

#[derive(Deserialize)]
struct RawFile {
    #[serde(default)]
    path: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    sha: String,
    #[serde(default)]
    encoding: Option<String>,
    #[serde(default)]
    content: Option<String>,
}

fn unexpected(m: &str) -> GithubError {
    GithubError::Unexpected { message: m.into() }
}

fn mentions(message: &str, needle: &str) -> bool {
    message.to_lowercase().contains(needle)
}

impl Github {
    /// One page (1-based, default first) of a repository's branch names. The default branch is
    /// read from the repository on every call, so it is always known; it leads page one.
    pub async fn list_branches(&self, owner: &str, repo: &str, page: Option<u32>) -> Result<BranchPage, GithubError> {
        let base = format!("/repos/{}/{}", encode(owner), encode(repo));
        let info: RawRepo = self.get_json(&base).await?;
        let path = format!("{base}/branches?per_page=100&page={}", page.unwrap_or(1));
        let (raw, next) = self.get_page::<RawBranch>(&path).await?;
        let default_branch = info.default_branch.unwrap_or_else(|| "main".into());
        // An empty repository names a default branch but has no branch to list.
        let none_at_all = raw.is_empty() && next.is_none();
        let mut branches: Vec<String> = raw.into_iter().map(|b| b.name).filter(|n| *n != default_branch).collect();
        if page.unwrap_or(1) == 1 && !none_at_all {
            branches.insert(0, default_branch.clone());
        }
        Ok(BranchPage { default_branch, branches, next_page: next.as_deref().and_then(page_of) })
    }

    /// The folders and Markdown files directly inside `path` (empty = the root) on `branch`.
    pub async fn list_folder(&self, owner: &str, repo: &str, branch: &str, path: &str) -> Result<FolderListing, GithubError> {
        let base = format!("/repos/{}/{}", encode(owner), encode(repo));
        let dir = encode_path(path);
        let url = format!("{base}/contents/{dir}?ref={}", encode(branch));
        let reply: Value = match self.get_json(&url).await {
            Ok(v) => v,
            Err(GithubError::Http { status, message }) => {
                return Err(self.folder_error(&base, branch, status, message).await);
            }
            Err(e) => return Err(e),
        };
        let Value::Array(items) = reply else { return Err(GithubError::NotAFolder) };
        let truncated = items.len() >= CONTENTS_LIMIT;
        let raw: Vec<RawEntry> = items
            .into_iter()
            .filter_map(|v| serde_json::from_value(v).ok())
            .collect();
        Ok(FolderListing { entries: shown(raw), truncated })
    }

    /// The text of the file at `path` on `branch`. The branch tip is looked up first and the file is
    /// then read at that exact commit, so `sha` and `commit_sha` always belong together.
    pub async fn read_file(&self, owner: &str, repo: &str, branch: &str, path: &str) -> Result<RepoFile, GithubError> {
        let base = format!("/repos/{}/{}", encode(owner), encode(repo));
        let tip_url = format!("{base}/branches/{}", encode_path(branch));
        let tip: Value = match self.get_json(&tip_url).await {
            Ok(v) => v,
            Err(GithubError::Http { status, message }) if status == 404 || status == 409 => {
                return Err(if mentions(&message, "repository is empty") { GithubError::EmptyRepo } else { GithubError::BranchNotFound });
            }
            Err(GithubError::Http { status: 403, message }) => return Err(GithubError::NoAccess { message }),
            Err(e) => return Err(e),
        };
        let commit_sha = tip
            .pointer("/commit/sha")
            .and_then(Value::as_str)
            .ok_or_else(|| GithubError::Unexpected { message: "the branch has no commit".into() })?
            .to_string();
        let url = format!("{base}/contents/{}?ref={}", encode_path(path), encode(&commit_sha));
        let reply: Value = match self.get_json(&url).await {
            Ok(v) => v,
            Err(GithubError::Http { status: 404, .. }) => return Err(GithubError::PathNotFound),
            Err(GithubError::Http { status: 403, message }) => return Err(GithubError::NoAccess { message }),
            Err(e) => return Err(e),
        };
        match reply.get("type").and_then(Value::as_str) {
            Some("file") => {}
            Some("symlink") => return Err(GithubError::Symlink),
            Some("submodule") => return Err(GithubError::Submodule),
            _ => return Err(GithubError::NotAFile),
        }
        let raw: RawFile = serde_json::from_value(reply).map_err(|_| unexpected("the file reply was malformed"))?;
        let text = match (raw.encoding.as_deref(), raw.content) {
            (Some("base64"), Some(c)) => {
                let packed: String = c.chars().filter(|ch| !ch.is_whitespace()).collect();
                let bytes = STANDARD.decode(packed).map_err(|_| unexpected("the file content was not valid base64"))?;
                String::from_utf8(bytes).map_err(|_| unexpected("the file is not UTF-8 text"))?
            }
            // Over 1 MB the contents API sends no content at all.
            _ => return Err(GithubError::FileTooLarge),
        };
        if raw.sha.is_empty() {
            return Err(unexpected("the file reply has no sha"));
        }
        Ok(RepoFile { path: raw.path, name: raw.name, content: text, sha: raw.sha, commit_sha })
    }

    /// Which typed error a failed contents request is.
    async fn folder_error(&self, base: &str, branch: &str, status: u16, message: String) -> GithubError {
        let empty = mentions(&message, "repository is empty");
        if empty && (status == 409 || status == 404) {
            return GithubError::EmptyRepo;
        }
        if status != 404 {
            return GithubError::Http { status, message };
        }
        if mentions(&message, "no commit found for the ref") {
            return GithubError::BranchNotFound;
        }
        // A plain "Not Found" is either a missing path or a missing branch: ask about the branch.
        let check = format!("{base}/branches/{}", encode_path(branch));
        match self.get_json::<Value>(&check).await {
            Ok(_) => GithubError::PathNotFound,
            Err(GithubError::Http { status: 404, .. }) => GithubError::BranchNotFound,
            Err(e) => e,
        }
    }
}
