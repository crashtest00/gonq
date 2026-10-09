use serde::Serialize;
use std::fs;
use std::path::Path;

/// One row of the folder navigator. Deliberately lightweight: no metadata, no sizes.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// Typed so the UI can show an error row instead of the app panicking.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum ListError {
    NotFound(String),
    PermissionDenied(String),
    NotAFolder(String),
    /// The path is outside the folders the user has opened.
    NotAllowed(String),
    Io(String),
}

fn is_markdown(name: &str) -> bool {
    match name.rsplit_once('.') {
        Some((stem, ext)) => {
            !stem.is_empty() && (ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
        }
        None => false,
    }
}

/// Lists one directory's immediate entries: folders and Markdown files, no dotfiles,
/// folders first, each group alphabetical ignoring case. Read-only; one pass.
pub fn list_directory(dir: &Path) -> Result<Vec<FolderEntry>, ListError> {
    let shown = dir.display().to_string();
    let read = fs::read_dir(dir).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => ListError::NotFound(shown.clone()),
        std::io::ErrorKind::PermissionDenied => ListError::PermissionDenied(shown.clone()),
        _ if dir.is_file() => ListError::NotAFolder(shown.clone()),
        _ => ListError::Io(e.to_string()),
    })?;

    let mut entries = Vec::new();
    for item in read {
        // An entry that vanished or cannot be read is skipped, not fatal.
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        // file_type() does not stat on common platforms; symlinks are resolved by is_dir below.
        let Ok(kind) = item.file_type() else { continue };
        let is_dir = if kind.is_symlink() { item.path().is_dir() } else { kind.is_dir() };
        if !is_dir && !is_markdown(&name) {
            continue;
        }
        entries.push(FolderEntry { path: item.path().to_string_lossy().into_owned(), name, is_dir });
    }

    entries.sort_by_cached_key(|e| (!e.is_dir, e.name.to_lowercase()));
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    pub fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gonq-{label}-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn filters_hidden_and_non_markdown() {
        let d = scratch("filter");
        for f in ["a.md", "b.MARKDOWN", "c.txt", ".hidden.md", "noext", ".md"] {
            fs::write(d.join(f), "x").unwrap();
        }
        fs::create_dir(d.join("sub")).unwrap();
        fs::create_dir(d.join(".git")).unwrap();
        let names: Vec<_> = list_directory(&d).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["sub", "a.md", "b.MARKDOWN"]);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn folders_first_then_case_insensitive() {
        let d = scratch("order");
        for f in ["b.md", "A.md", "c.md"] {
            fs::write(d.join(f), "x").unwrap();
        }
        for f in ["zeta", "Alpha", "beta"] {
            fs::create_dir(d.join(f)).unwrap();
        }
        let got = list_directory(&d).unwrap();
        let names: Vec<_> = got.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["Alpha", "beta", "zeta", "A.md", "b.md", "c.md"]);
        assert!(got[0].is_dir && !got[3].is_dir);
        assert_eq!(got[3].path, d.join("A.md").to_string_lossy());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn missing_folder_is_typed_error() {
        let d = scratch("missing");
        let err = list_directory(&d.join("nope")).unwrap_err();
        assert!(matches!(err, ListError::NotFound(_)));
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn file_is_not_a_folder() {
        let d = scratch("notdir");
        fs::write(d.join("a.md"), "x").unwrap();
        assert!(matches!(list_directory(&d.join("a.md")).unwrap_err(), ListError::NotAFolder(_)));
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn handles_thousands_of_entries() {
        let d = scratch("many");
        for i in 0..3000 {
            fs::write(d.join(format!("n{i}.md")), "").unwrap();
        }
        assert_eq!(list_directory(&d).unwrap().len(), 3000);
        fs::remove_dir_all(&d).unwrap();
    }
}
