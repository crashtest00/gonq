use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub const DEFAULT_AUTHOR_NAME: &str = "User";

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Settings {
    #[serde(default)]
    author_name: Option<String>,
    #[serde(default)]
    show_markers_in_active_block: Option<bool>,
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

/// Whether the Markdown syntax markers of the block being edited are shown; true when unset or unreadable.
pub fn get_show_markers(file: &Path) -> bool {
    load(file).show_markers_in_active_block.unwrap_or(true)
}

/// Saves the option and returns what is stored. Other settings are kept.
pub fn set_show_markers(file: &Path, show: bool) -> Result<bool, String> {
    let mut settings = load(file);
    settings.show_markers_in_active_block = Some(show);
    store(file, &settings)?;
    Ok(show)
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

    #[test]
    fn show_markers_defaults_true_and_round_trips_beside_author() {
        let f = file("markers");
        assert!(get_show_markers(&f));
        set_author_name(&f, "Ann").unwrap();
        assert_eq!(set_show_markers(&f, false), Ok(false));
        assert!(!get_show_markers(&f));
        assert_eq!(get_author_name(&f), "Ann");
        assert_eq!(set_show_markers(&f, true), Ok(true));
        assert!(get_show_markers(&f));
    }

    #[test]
    fn corrupt_or_mistyped_show_markers_is_true() {
        let f = file("markers-corrupt");
        fs::create_dir_all(f.parent().unwrap()).unwrap();
        fs::write(&f, "{not json").unwrap();
        assert!(get_show_markers(&f));
        fs::write(&f, r#"{"show_markers_in_active_block":"garbage"}"#).unwrap();
        assert!(get_show_markers(&f));
    }
}
