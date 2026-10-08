use std::path::PathBuf;
use tauri::{AppHandle, Runtime};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![allow_document_folder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
