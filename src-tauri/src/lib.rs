mod folder;
mod recents;

use folder::{FolderEntry, ListError};
use recents::Recent;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_fs::FsExt;

/// Lets the webview read the folder of a document the user picked, so its
/// relative images load. Refuses any path the user has not chosen in a dialog,
/// so the fs scope can only grow to the folder of a user-chosen file.
#[tauri::command]
fn allow_document_folder<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let file = PathBuf::from(path);
    let scope = app.fs_scope();
    if !scope.is_allowed(&file) {
        return Err("not a user-chosen file".into());
    }
    let folder = file.parent().ok_or("file has no folder")?;
    scope.allow_directory(folder, true).map_err(|e| e.to_string())
}

/// Serialises read-modify-write of recent.json.
static RECENTS_LOCK: Mutex<()> = Mutex::new(());

fn recents_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("recent.json"))
}

/// Read-only listing of one folder. Only folders already in the fs scope (the folder of an
/// opened document, or one chosen with Open Folder, and their subfolders) can be listed.
#[tauri::command]
fn list_directory<R: Runtime>(app: AppHandle<R>, path: String) -> Result<Vec<FolderEntry>, ListError> {
    let dir = PathBuf::from(&path);
    if !app.fs_scope().is_allowed(&dir) {
        return Err(ListError::NotAllowed(path));
    }
    folder::list_directory(&dir)
}

/// Whether a path still exists (metadata only; reads nothing).
#[tauri::command]
fn path_exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

#[tauri::command]
fn recent_documents_add<R: Runtime>(app: AppHandle<R>, path: String) -> Result<Vec<Recent>, String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    let _guard = RECENTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    recents::add(&recents_file(&app)?, &path, now)
}

#[tauri::command]
fn recent_documents_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<Recent>, String> {
    let _guard = RECENTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    Ok(recents::load(&recents_file(&app)?))
}

#[tauri::command]
fn recent_documents_remove<R: Runtime>(app: AppHandle<R>, path: String) -> Result<Vec<Recent>, String> {
    let _guard = RECENTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    recents::remove(&recents_file(&app)?, &path)
}

/// A recent document from an earlier session is no longer in the fs scope. Re-grants its
/// folder, but only for a path the app itself recorded as opened.
#[tauri::command]
fn allow_recent_document<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let known = {
        let _guard = RECENTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        recents::load(&recents_file(&app)?).iter().any(|r| r.path == path)
    };
    if !known {
        return Err("not a recent document".into());
    }
    let folder = PathBuf::from(&path).parent().map(PathBuf::from).ok_or("file has no folder")?;
    app.fs_scope().allow_directory(folder, true).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            allow_document_folder,
            list_directory,
            path_exists,
            recent_documents_add,
            recent_documents_list,
            recent_documents_remove,
            allow_recent_document
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
