//! App settings in settings.json (app config dir): the comment author name, the theme (light|dark|auto) and the
//! side-pane widths (navigator|outline|comments, in px; null when unsaved), validated and written atomically; a missing or corrupt
//! file gives the defaults. Backs get/set_author_name, get/set_theme and get_pane_widths/set_pane_width in lib.rs.
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub const DEFAULT_AUTHOR_NAME: &str = "User";

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Settings {
    #[serde(default)]
    author_name: Option<String>,
    /// Kept as text so an unknown value never makes the whole file unreadable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    theme: Option<String>,
    /// Pane name -> width in px. Kept as a loose map so a bad entry never makes the whole file unreadable.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pane_widths: std::collections::BTreeMap<String, serde_json::Value>,
}

/// Saved widths of the side panes, in px; `None` (JSON null) when nothing valid is saved, so the frontend uses its default.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct PaneWidths {
    pub navigator: Option<u32>,
    pub outline: Option<u32>,
    pub comments: Option<u32>,
}

pub const MIN_PANE_WIDTH: u32 = 120;
pub const MAX_PANE_WIDTH: u32 = 800;
const PANES: [&str; 3] = ["navigator", "outline", "comments"];

fn width_ok(w: u32) -> bool {
    (MIN_PANE_WIDTH..=MAX_PANE_WIDTH).contains(&w)
}

pub const DEFAULT_THEME: &str = "auto";
const THEMES: [&str; 3] = ["light", "dark", "auto"];

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

/// The saved theme ("light", "dark" or "auto"); "auto" when missing, unreadable or unknown. Never fails.
pub fn get_theme(file: &Path) -> String {
    load(file)
        .theme
        .filter(|t| THEMES.contains(&t.as_str()))
        .unwrap_or_else(|| DEFAULT_THEME.to_string())
}

/// Saves the theme. Anything but "light", "dark" or "auto" is refused and nothing is written.
/// Returns the stored value.
pub fn set_theme(file: &Path, theme: &str) -> Result<String, String> {
    if !THEMES.contains(&theme) {
        return Err("theme must be \"light\", \"dark\" or \"auto\"".into());
    }
    let mut settings = load(file);
    settings.theme = Some(theme.to_string());
    store(file, &settings)?;
    Ok(theme.to_string())
}

/// The saved pane widths; each pane that is missing, not a whole number or outside 120..=800 is `None`.
/// Never fails.
pub fn get_pane_widths(file: &Path) -> PaneWidths {
    let saved = load(file).pane_widths;
    let pick = |pane: &str| {
        saved.get(pane).and_then(|v| v.as_u64()).and_then(|v| u32::try_from(v).ok()).filter(|w| width_ok(*w))
    };
    PaneWidths { navigator: pick("navigator"), outline: pick("outline"), comments: pick("comments") }
}

/// Saves one pane's width, or clears it with `None`. An unknown pane or a width outside 120..=800 px is refused
/// and nothing is written. Returns all the stored widths.
pub fn set_pane_width(file: &Path, pane: &str, width: Option<u32>) -> Result<PaneWidths, String> {
    if !PANES.contains(&pane) {
        return Err("pane must be \"navigator\", \"outline\" or \"comments\"".into());
    }
    if let Some(w) = width {
        if !width_ok(w) {
            return Err(format!("pane width must be between {MIN_PANE_WIDTH} and {MAX_PANE_WIDTH} px"));
        }
    }
    let mut settings = load(file);
    match width {
        Some(w) => settings.pane_widths.insert(pane.to_string(), w.into()),
        None => settings.pane_widths.remove(pane),
    };
    store(file, &settings)?;
    Ok(get_pane_widths(file))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pane_widths_default_without_file() {
        assert_eq!(get_pane_widths(&file("pw-missing")), PaneWidths::default());
    }

    #[test]
    fn pane_width_round_trips_and_keeps_other_settings() {
        let f = file("pw-roundtrip");
        set_author_name(&f, "Ann").unwrap();
        set_theme(&f, "dark").unwrap();
        let w = set_pane_width(&f, "comments", Some(500)).unwrap();
        assert_eq!(w, PaneWidths { comments: Some(500), ..PaneWidths::default() });
        set_pane_width(&f, "outline", Some(120)).unwrap();
        set_pane_width(&f, "navigator", Some(800)).unwrap();
        assert_eq!(get_pane_widths(&f), PaneWidths { outline: Some(120), navigator: Some(800), comments: Some(500) });
        assert_eq!((get_author_name(&f), get_theme(&f).as_str()), ("Ann".to_string(), "dark"));
        set_author_name(&f, "Bo").unwrap();
        assert_eq!(get_pane_widths(&f).comments, Some(500));
    }

    #[test]
    fn invalid_pane_width_is_refused_without_writing() {
        let f = file("pw-reject");
        assert!(set_pane_width(&f, "sidebar", Some(300)).is_err());
        assert!(set_pane_width(&f, "outline", Some(119)).is_err());
        assert!(set_pane_width(&f, "outline", Some(801)).is_err());
        assert!(!f.exists());
        set_pane_width(&f, "outline", Some(300)).unwrap();
        let before = fs::read(&f).unwrap();
        assert!(set_pane_width(&f, "outline", Some(0)).is_err());
        assert!(set_pane_width(&f, "nope", Some(300)).is_err());
        assert_eq!(fs::read(&f).unwrap(), before);
    }

    #[test]
    fn null_width_clears_one_pane() {
        let f = file("pw-clear");
        set_pane_width(&f, "outline", Some(300)).unwrap();
        set_pane_width(&f, "navigator", Some(260)).unwrap();
        let w = set_pane_width(&f, "outline", None).unwrap();
        assert_eq!(w, PaneWidths { navigator: Some(260), ..PaneWidths::default() });
        assert_eq!(get_pane_widths(&f), w);
        assert!(set_pane_width(&f, "folder", None).is_err());
        assert_eq!(serde_json::to_string(&w).unwrap(), r#"{"navigator":260,"outline":null,"comments":null}"#);
    }

    #[test]
    fn bad_stored_pane_widths_fall_back_per_pane() {
        let f = file("pw-stored");
        fs::create_dir_all(f.parent().unwrap()).unwrap();
        fs::write(&f, r#"{"author_name":"Ann","pane_widths":{"outline":50,"navigator":"wide","comments":-3.5,"extra":1}}"#).unwrap();
        assert_eq!(get_pane_widths(&f), PaneWidths::default());
        fs::write(&f, r#"{"pane_widths":{"outline":300,"navigator":99999999999}}"#).unwrap();
        assert_eq!(get_pane_widths(&f), PaneWidths { outline: Some(300), ..PaneWidths::default() });
        fs::write(&f, r#"{"pane_widths":[1,2]}"#).unwrap();
        assert_eq!(get_pane_widths(&f), PaneWidths::default());
        assert_eq!(get_author_name(&f), "User");
    }

    #[test]
    fn theme_defaults_to_auto() {
        assert_eq!(get_theme(&file("theme-missing")), "auto");
    }

    #[test]
    fn theme_round_trips_and_keeps_author() {
        let f = file("theme-roundtrip");
        set_author_name(&f, "Ann").unwrap();
        for t in ["light", "dark", "auto"] {
            assert_eq!(set_theme(&f, t).unwrap(), t);
            assert_eq!(get_theme(&f), t);
        }
        assert_eq!(get_author_name(&f), "Ann");
        set_author_name(&f, "Bo").unwrap();
        assert_eq!(get_theme(&f), "auto");
        set_theme(&f, "dark").unwrap();
        set_author_name(&f, "Cy").unwrap();
        assert_eq!(get_theme(&f), "dark");
    }

    #[test]
    fn invalid_theme_is_refused_without_writing() {
        let f = file("theme-reject");
        assert!(set_theme(&f, "Dark").is_err());
        assert!(set_theme(&f, "").is_err());
        assert!(!f.exists());
        set_theme(&f, "dark").unwrap();
        let before = fs::read(&f).unwrap();
        assert!(set_theme(&f, "blue").is_err());
        assert_eq!(fs::read(&f).unwrap(), before);
    }

    #[test]
    fn unknown_stored_theme_gives_auto_and_keeps_author() {
        let f = file("theme-unknown");
        fs::create_dir_all(f.parent().unwrap()).unwrap();
        fs::write(&f, r#"{"author_name":"Ann","theme":"blue"}"#).unwrap();
        assert_eq!(get_theme(&f), "auto");
        assert_eq!(get_author_name(&f), "Ann");
    }

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
    fn legacy_show_markers_key_is_ignored_and_dropped_on_save() {
        let f = file("legacy-markers");
        fs::create_dir_all(f.parent().unwrap()).unwrap();
        fs::write(&f, r#"{"author_name":"Ann","show_markers_in_active_block":false}"#).unwrap();
        assert_eq!(get_author_name(&f), "Ann");
        set_author_name(&f, "Bo").unwrap();
        assert!(!fs::read_to_string(&f).unwrap().contains("show_markers"));
    }
}
