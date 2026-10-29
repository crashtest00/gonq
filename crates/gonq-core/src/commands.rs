//! The local commands the webview invokes (document-folder fs grant, list_directory/path_exists, recent documents,
//! author name, theme, pane widths) and `DataPaths`, the managed state naming settings.json and recent.json.
//! They live in a module, not the crate root, because a `pub` tauri command at the root collides with its own macro;
//! an app registers them as `gonq_core::commands::list_directory`.
use crate::folder::{self, FolderEntry, ListError};
use crate::recents::{self, Recent};
use crate::settings;
use crate::ssh;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_fs::FsExt;

/// Lets the webview read the folder of a document the user picked, so its
/// relative images load. Refuses any path the user has not chosen in a dialog,
/// so the fs scope can only grow to the folder of a user-chosen file.
#[tauri::command]
pub fn allow_document_folder<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let file = PathBuf::from(path);
    let scope = app.fs_scope();
    if !scope.is_allowed(&file) {
        return Err("not a user-chosen file".into());
    }
    let folder = file.parent().ok_or("file has no folder")?;
    scope.allow_directory(folder, true).map_err(|e| e.to_string())
}

/// Where settings.json and recent.json live. Held in managed state, filled in `setup` from the app's path resolver
/// (tests manage their own, pointing at a temp dir). A location that could not be resolved is kept as its error,
/// which the commands return as before.
pub struct DataPaths {
    pub settings: Result<PathBuf, String>,
    pub recents: Result<PathBuf, String>,
}

impl DataPaths {
    pub fn resolve<R: Runtime>(app: &AppHandle<R>) -> Self {
        let path = app.path();
        DataPaths {
            settings: path.app_config_dir().map(|d| d.join("settings.json")).map_err(|e| e.to_string()),
            recents: path.app_data_dir().map(|d| d.join("recent.json")).map_err(|e| e.to_string()),
        }
    }
}

/// Serialises read-modify-write of recent.json.
static RECENTS_LOCK: Mutex<()> = Mutex::new(());

fn recents_file(paths: &DataPaths) -> Result<PathBuf, String> {
    paths.recents.clone()
}

/// Serialises read-modify-write of settings.json.
static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

fn settings_file(paths: &DataPaths) -> Result<PathBuf, String> {
    paths.settings.clone()
}

/// The saved author name for comments; "User" when none is saved or it can't be read.
#[tauri::command]
pub fn get_author_name(paths: tauri::State<'_, DataPaths>) -> String {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    match settings_file(&paths) {
        Ok(file) => settings::get_author_name(&file),
        Err(_) => settings::DEFAULT_AUTHOR_NAME.to_string(),
    }
}

/// Saves the author name (trimmed; blank or containing `|`, `]`, CR, LF is refused) and
/// returns what is stored.
#[tauri::command]
pub fn set_author_name(paths: tauri::State<'_, DataPaths>, name: String) -> Result<String, String> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    settings::set_author_name(&settings_file(&paths)?, &name)
}

/// The saved theme ("light", "dark" or "auto"); "auto" when none is saved or it can't be read.
#[tauri::command]
pub fn get_theme(paths: tauri::State<'_, DataPaths>) -> String {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    match settings_file(&paths) {
        Ok(file) => settings::get_theme(&file),
        Err(_) => settings::DEFAULT_THEME.to_string(),
    }
}

/// Saves the theme ("light", "dark" or "auto"; anything else is refused) and returns what is stored.
#[tauri::command]
pub fn set_theme(paths: tauri::State<'_, DataPaths>, theme: String) -> Result<String, String> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    settings::set_theme(&settings_file(&paths)?, &theme)
}

/// The saved widths (px) of the navigator, outline and comments side panes; null for a pane with none saved (or when it can't be read).
#[tauri::command]
pub fn get_pane_widths(paths: tauri::State<'_, DataPaths>) -> settings::PaneWidths {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    match settings_file(&paths) {
        Ok(file) => settings::get_pane_widths(&file),
        Err(_) => settings::PaneWidths::default(),
    }
}

/// Saves one pane's width ("navigator", "outline" or "comments"; 120..=800 px, anything else is refused);
/// a null width clears it. Returns all the stored widths.
#[tauri::command]
pub fn set_pane_width(paths: tauri::State<'_, DataPaths>, pane: String, width: Option<u32>) -> Result<settings::PaneWidths, String> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    settings::set_pane_width(&settings_file(&paths)?, &pane, width)
}

/// Read-only listing of one folder. Only folders already in the fs scope (the folder of an
/// opened document, or one chosen with Open Folder, and their subfolders) can be listed.
#[tauri::command]
pub fn list_directory<R: Runtime>(app: AppHandle<R>, path: String) -> Result<Vec<FolderEntry>, ListError> {
    let dir = PathBuf::from(&path);
    if !app.fs_scope().is_allowed(&dir) {
        return Err(ListError::NotAllowed(path));
    }
    folder::list_directory(&dir)
}

/// Whether a path still exists (metadata only; reads nothing).
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

#[tauri::command]
pub fn recent_documents_add(paths: tauri::State<'_, DataPaths>, path: String) -> Result<Vec<Recent>, String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    let _guard = RECENTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    recents::add(&recents_file(&paths)?, &path, now)
}

#[tauri::command]
pub fn recent_documents_list(paths: tauri::State<'_, DataPaths>) -> Result<Vec<Recent>, String> {
    let _guard = RECENTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    Ok(recents::load(&recents_file(&paths)?))
}

#[tauri::command]
pub fn recent_documents_remove(paths: tauri::State<'_, DataPaths>, path: String) -> Result<Vec<Recent>, String> {
    let _guard = RECENTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    recents::remove(&recents_file(&paths)?, &path)
}

/// Whether the app itself recorded `path` as an opened document.
pub(crate) fn is_recent(paths: &DataPaths, path: &str) -> Result<bool, String> {
    let _guard = RECENTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    Ok(recents::load(&recents_file(paths)?).iter().any(|r| r.path == path))
}

/// A recent document from an earlier session is no longer in the fs scope. Re-grants its
/// folder, but only for a path the app itself recorded as opened.
#[tauri::command]
pub fn allow_recent_document<R: Runtime>(
    app: AppHandle<R>,
    paths: tauri::State<'_, DataPaths>,
    remote: tauri::State<'_, ssh::fs::Remote>,
    path: String,
) -> Result<(), String> {
    if !is_recent(&paths, &path)? {
        return Err("not a recent document".into());
    }
    if ssh::is_ssh_path(&path) {
        return ssh::allow_recent(&remote, &path);
    }
    let folder = PathBuf::from(&path).parent().map(PathBuf::from).ok_or("file has no folder")?;
    app.fs_scope().allow_directory(folder, true).map_err(|e| e.to_string())
}
