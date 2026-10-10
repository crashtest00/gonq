//! The remote allow-list: which `ssh://` folders and files the webview may reach.
//!
//! Tauri's fs scope only knows local paths, so remote access has its own. A grant is one folder
//! the user picked (`remote_open_root`) or one file the app recorded as a recent document. Every
//! remote command except `remote_list_folders` checks its path here, after `.` and `..` are
//! resolved, and again once the server has resolved symlinks, so a link cannot lead out of a folder.

use super::uri::{ConnKey, RemotePath};
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Root {
    key: ConnKey,
    /// Normalised path as granted.
    path: String,
    /// The server's resolved path for it, when known (a folder reached through a symlink).
    real: Option<String>,
    /// A single file (a recent document) rather than a folder and everything below it.
    file: bool,
}

impl Root {
    fn covers(&self, key: &ConnKey, path: &str) -> bool {
        if &self.key != key {
            return false;
        }
        let under = |root: &str| if self.file { path == root } else { within(root, path) };
        under(&self.path) || self.real.as_deref().is_some_and(under)
    }
}

#[derive(Default)]
pub struct Allow {
    roots: Mutex<Vec<Root>>,
}

impl Allow {
    pub fn grant_folder(&self, folder: &RemotePath, real: &str) {
        self.add(Root { key: folder.key.clone(), path: normalize(&folder.path), real: Some(normalize(real)), file: false });
    }

    pub fn grant_file(&self, file: &RemotePath) {
        self.add(Root { key: file.key.clone(), path: normalize(&file.path), real: None, file: true });
    }

    /// Whether `target`, as written, lies under a grant.
    pub fn permits(&self, target: &RemotePath) -> bool {
        self.covered(&target.key, &normalize(&target.path))
    }

    /// Whether the server's resolved path for a request lies under a grant. A file granted from the
    /// recents list is known only by the name it was recorded under, so a link must not lead from it.
    pub fn permits_real(&self, key: &ConnKey, real: &str) -> bool {
        self.covered(key, &normalize(real))
    }

    /// Takes back every grant on one host (the session was closed on purpose).
    pub fn revoke(&self, key: &ConnKey) {
        self.roots.lock().unwrap_or_else(|e| e.into_inner()).retain(|r| &r.key != key);
    }

    fn covered(&self, key: &ConnKey, path: &str) -> bool {
        self.roots.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|r| r.covers(key, path))
    }

    fn add(&self, root: Root) {
        let mut roots = self.roots.lock().unwrap_or_else(|e| e.into_inner());
        if !roots.contains(&root) {
            roots.push(root);
        }
    }
}

/// Resolves `.`, `..` and repeated `/` without asking the server; `..` never climbs above `/`.
pub fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            p => parts.push(p),
        }
    }
    format!("/{}", parts.join("/"))
}

/// `path` is `root` or below it. Both are normalised.
fn within(root: &str, path: &str) -> bool {
    root == "/" || path == root || path.strip_prefix(root).is_some_and(|rest| rest.starts_with('/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rp(path: &str) -> RemotePath {
        RemotePath::new(ConnKey::new("me", "nas", 22), path).unwrap()
    }

    #[test]
    fn dots_and_slashes_are_resolved() {
        assert_eq!(normalize("/a/./b//c/../d"), "/a/b/d");
        assert_eq!(normalize("/../../a"), "/a");
        assert_eq!(normalize("/"), "/");
        assert_eq!(normalize("/a/.."), "/");
    }

    #[test]
    fn a_folder_grant_covers_itself_and_below_but_not_siblings() {
        let a = Allow::default();
        a.grant_folder(&rp("/home/me/notes"), "/home/me/notes");
        assert!(a.permits(&rp("/home/me/notes")));
        assert!(a.permits(&rp("/home/me/notes/sub/a.md")));
        assert!(!a.permits(&rp("/home/me/notes2/a.md")), "a longer name is not below the folder");
        assert!(!a.permits(&rp("/home/me")));
        assert!(!a.permits(&rp("/etc/passwd")));
    }

    #[test]
    fn dot_dot_cannot_leave_a_grant() {
        let a = Allow::default();
        a.grant_folder(&rp("/home/me/notes"), "/home/me/notes");
        assert!(!a.permits(&rp("/home/me/notes/../.ssh/id_rsa")));
        assert!(a.permits(&rp("/home/me/notes/../notes/a.md")));
    }

    #[test]
    fn a_file_grant_covers_only_that_file() {
        let a = Allow::default();
        a.grant_file(&rp("/home/me/notes/a.md"));
        assert!(a.permits(&rp("/home/me/notes/a.md")));
        assert!(!a.permits(&rp("/home/me/notes/b.md")));
        assert!(!a.permits(&rp("/home/me/notes/a.md/x")));
    }

    #[test]
    fn grants_belong_to_one_host() {
        let a = Allow::default();
        a.grant_folder(&rp("/home/me"), "/home/me");
        let other = RemotePath::new(ConnKey::new("me", "other", 22), "/home/me/a.md").unwrap();
        assert!(!a.permits(&other));
        let again = RemotePath::new(ConnKey::new("me", "nas", 2222), "/home/me/a.md").unwrap();
        assert!(!a.permits(&again));
    }

    #[test]
    fn a_folder_reached_through_a_link_is_covered_by_its_real_path() {
        let a = Allow::default();
        a.grant_folder(&rp("/home/me/notes"), "/data/notes");
        assert!(a.permits_real(&ConnKey::new("me", "nas", 22), "/data/notes/a.md"));
        assert!(!a.permits_real(&ConnKey::new("me", "nas", 22), "/data/other/a.md"));
    }

    #[test]
    fn revoke_takes_back_one_hosts_grants() {
        let a = Allow::default();
        a.grant_folder(&rp("/x"), "/x");
        a.grant_file(&RemotePath::new(ConnKey::new("me", "other", 22), "/y.md").unwrap());
        a.revoke(&ConnKey::new("me", "nas", 22));
        assert!(!a.permits(&rp("/x/a.md")));
        assert!(a.permits(&RemotePath::new(ConnKey::new("me", "other", 22), "/y.md").unwrap()));
    }

    #[test]
    fn the_root_folder_grants_everything_on_the_host() {
        let a = Allow::default();
        a.grant_folder(&rp("/"), "/");
        assert!(a.permits(&rp("/etc/hosts")));
    }
}
