use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub const MAX_AUTHOR_NAME_CHARS: usize = 100;

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Settings {
    #[serde(default)]
    author_name: Option<String>,
}

/// A missing or corrupt file is the default settings, never an error.
fn load(file: &Path) -> Settings {
    fs::read(file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn store(file: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Write beside the target and rename, so a crash never leaves a half-written file.
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, file).map_err(|e| e.to_string())
}

/// The saved author name, or `None` when never set.
pub fn get_author_name(file: &Path) -> Option<String> {
    load(file).author_name
}

/// Trims and saves the name; a blank name clears it. Returns what is now stored.
pub fn set_author_name(file: &Path, name: &str) -> Result<Option<String>, String> {
    let name = name.trim();
    if name.chars().count() > MAX_AUTHOR_NAME_CHARS {
        return Err(format!("author name is longer than {MAX_AUTHOR_NAME_CHARS} characters"));
    }
    let mut settings = load(file);
    settings.author_name = (!name.is_empty()).then(|| name.to_string());
    store(file, &settings)?;
    Ok(settings.author_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("gonq-settings-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("settings.json")
    }

    #[test]
    fn missing_file_is_none() {
        assert_eq!(get_author_name(&file("missing")), None);
    }

    #[test]
    fn corrupt_file_is_none_and_recoverable() {
        let f = file("corrupt");
        fs::create_dir_all(f.parent().unwrap()).unwrap();
        fs::write(&f, "{not json").unwrap();
        assert_eq!(get_author_name(&f), None);
        assert_eq!(set_author_name(&f, "Ann").unwrap(), Some("Ann".into()));
    }

    #[test]
    fn persists_trimmed_name() {
        let f = file("persist");
        assert_eq!(set_author_name(&f, "  Ann Lee ").unwrap(), Some("Ann Lee".into()));
        assert_eq!(get_author_name(&f), Some("Ann Lee".into())); // survives a "restart"
    }

    #[test]
    fn blank_clears() {
        let f = file("blank");
        set_author_name(&f, "Ann").unwrap();
        assert_eq!(set_author_name(&f, "   ").unwrap(), None);
        assert_eq!(get_author_name(&f), None);
    }

    #[test]
    fn rejects_overlong_name_and_keeps_old() {
        let f = file("long");
        set_author_name(&f, "Ann").unwrap();
        assert!(set_author_name(&f, &"x".repeat(MAX_AUTHOR_NAME_CHARS + 1)).is_err());
        assert_eq!(get_author_name(&f), Some("Ann".into()));
    }
}
