use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub const MAX_RECENTS: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Recent {
    pub path: String,
    /// Unix epoch milliseconds when the file was last opened.
    pub opened_at: u64,
}

/// Newest first. A missing or corrupt file is an empty list, never an error.
pub fn load(file: &Path) -> Vec<Recent> {
    let Ok(bytes) = fs::read(file) else { return Vec::new() };
    let mut list: Vec<Recent> = serde_json::from_slice(&bytes).unwrap_or_default();
    list.truncate(MAX_RECENTS);
    list
}

fn store(file: &Path, list: &[Recent]) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Write beside the target and rename, so a crash never leaves a half-written list.
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, file).map_err(|e| e.to_string())
}

/// Moves `path` to the top (deduped), stamps it, and keeps the newest ten.
pub fn add(file: &Path, path: &str, now_ms: u64) -> Result<Vec<Recent>, String> {
    let mut list = load(file);
    list.retain(|r| r.path != path);
    list.insert(0, Recent { path: path.to_string(), opened_at: now_ms });
    list.truncate(MAX_RECENTS);
    store(file, &list)?;
    Ok(list)
}

pub fn remove(file: &Path, path: &str) -> Result<Vec<Recent>, String> {
    let mut list = load(file);
    let before = list.len();
    list.retain(|r| r.path != path);
    if list.len() != before {
        store(file, &list)?;
    }
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("gonq-recents-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("recent.json")
    }

    #[test]
    fn missing_file_is_empty() {
        assert!(load(&file("missing")).is_empty());
    }

    #[test]
    fn corrupt_file_is_empty_and_recoverable() {
        let f = file("corrupt");
        fs::create_dir_all(f.parent().unwrap()).unwrap();
        fs::write(&f, "{not json").unwrap();
        assert!(load(&f).is_empty());
        assert_eq!(add(&f, "/a.md", 1).unwrap().len(), 1);
    }

    #[test]
    fn newest_first_and_dedupes() {
        let f = file("dedupe");
        add(&f, "/a.md", 1).unwrap();
        add(&f, "/b.md", 2).unwrap();
        let list = add(&f, "/a.md", 3).unwrap();
        assert_eq!(list, vec![Recent { path: "/a.md".into(), opened_at: 3 }, Recent { path: "/b.md".into(), opened_at: 2 }]);
        assert_eq!(load(&f), list); // survives a "restart"
    }

    #[test]
    fn caps_at_ten() {
        let f = file("cap");
        for i in 0..15 {
            add(&f, &format!("/{i}.md"), i).unwrap();
        }
        let list = load(&f);
        assert_eq!(list.len(), MAX_RECENTS);
        assert_eq!(list[0].path, "/14.md");
        assert_eq!(list[9].path, "/5.md");
    }

    #[test]
    fn remove_drops_only_that_path() {
        let f = file("remove");
        add(&f, "/a.md", 1).unwrap();
        add(&f, "/b.md", 2).unwrap();
        let list = remove(&f, "/a.md").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].path, "/b.md");
        assert_eq!(remove(&f, "/zzz.md").unwrap().len(), 1);
    }
}
