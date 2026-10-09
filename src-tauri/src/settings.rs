use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub const DEFAULT_AUTHOR_NAME: &str = "User";

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

/// `Err` with the reason when `name` (already trimmed) can't be an author name.
fn validate(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("author name must not be blank".into());
    }
    if name.contains(['|', ']', '\r', '\n']) {
        return Err("author name must not contain '|', ']' or line breaks".into());
    }
    Ok(())
}

/// The saved author name; "User" when missing, unreadable, blank or invalid. Never fails.
pub fn get_author_name(file: &Path) -> String {
    load(file)
        .author_name
        .map(|n| n.trim().to_string())
        .filter(|n| validate(n).is_ok())
        .unwrap_or_else(|| DEFAULT_AUTHOR_NAME.to_string())
}

/// Trims, validates and saves the name. On invalid input nothing is written.
/// Returns the stored (trimmed) name.
pub fn set_author_name(file: &Path, name: &str) -> Result<String, String> {
    let name = name.trim();
    validate(name)?;
    let mut settings = load(file);
    settings.author_name = Some(name.to_string());
    store(file, &settings)?;
    Ok(name.to_string())
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
    fn defaults_to_user_without_file() {
        assert_eq!(get_author_name(&file("missing")), "User");
    }

    #[test]
    fn round_trips() {
        let f = file("roundtrip");
        assert_eq!(set_author_name(&f, "Ann").unwrap(), "Ann");
        assert_eq!(get_author_name(&f), "Ann");
    }

    #[test]
    fn trims() {
        let f = file("trim");
        assert_eq!(set_author_name(&f, "  Ann Lee \n").unwrap(), "Ann Lee");
        assert_eq!(get_author_name(&f), "Ann Lee");
    }

    #[test]
    fn rejections_leave_file_byte_identical() {
        let f = file("reject");
        set_author_name(&f, "Ann").unwrap();
        let before = fs::read(&f).unwrap();
        for bad in ["", "   ", "a|b", "a]b", "a\nb", "a\rb", "\u{a0}"] {
            assert!(set_author_name(&f, bad).is_err(), "{bad:?} should be rejected");
            assert_eq!(fs::read(&f).unwrap(), before, "{bad:?} changed the file");
        }
        assert_eq!(get_author_name(&f), "Ann");
    }

    #[test]
    fn rejection_creates_no_file() {
        let f = file("reject-new");
        assert!(set_author_name(&f, "a|b").is_err());
        assert!(!f.exists());
    }

    #[test]
    fn corrupt_file_gives_user_and_is_recoverable() {
        let f = file("corrupt");
        fs::create_dir_all(f.parent().unwrap()).unwrap();
        fs::write(&f, "{not json").unwrap();
        assert_eq!(get_author_name(&f), "User");
        assert_eq!(set_author_name(&f, "Ann").unwrap(), "Ann");
    }

    #[test]
    fn invalid_stored_values_give_user() {
        for bad in ["a|b", "a]b", "a\nb", "a\rb", "", "   "] {
            let f = file("invalid");
            fs::create_dir_all(f.parent().unwrap()).unwrap();
            fs::write(&f, serde_json::json!({ "author_name": bad }).to_string()).unwrap();
            assert_eq!(get_author_name(&f), "User", "stored {bad:?}");
        }
    }

    #[test]
    fn non_latin_and_emoji_round_trip_exactly() {
        for name in ["Åsa 🙂", "李雷", "Zoë"] {
            let f = file("unicode");
            assert_eq!(set_author_name(&f, name).unwrap(), name);
            assert_eq!(get_author_name(&f), name);
        }
    }
}
