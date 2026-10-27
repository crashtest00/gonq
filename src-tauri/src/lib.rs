//! The Tauri app (`run`): declares the modules, defines the local commands (document-folder fs grant,
//! list_directory/path_exists, recent documents, author name and theme, take_launch_paths), registers them
//! with the github_* and ssh_*/remote_* commands, and installs the single-instance, dialog, fs and opener plugins.
mod folder;
mod github;
mod launch;
mod ssh;
mod recents;
mod settings;

use folder::{FolderEntry, ListError};
use recents::Recent;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Runtime};
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

/// Serialises read-modify-write of settings.json.
static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

fn settings_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("settings.json"))
}

/// The saved author name for comments; "User" when none is saved or it can't be read.
#[tauri::command]
fn get_author_name<R: Runtime>(app: AppHandle<R>) -> String {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    match settings_file(&app) {
        Ok(file) => settings::get_author_name(&file),
        Err(_) => settings::DEFAULT_AUTHOR_NAME.to_string(),
    }
}

/// Saves the author name (trimmed; blank or containing `|`, `]`, CR, LF is refused) and
/// returns what is stored.
#[tauri::command]
fn set_author_name<R: Runtime>(app: AppHandle<R>, name: String) -> Result<String, String> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    settings::set_author_name(&settings_file(&app)?, &name)
}

/// The saved theme ("light", "dark" or "auto"); "auto" when none is saved or it can't be read.
#[tauri::command]
fn get_theme<R: Runtime>(app: AppHandle<R>) -> String {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    match settings_file(&app) {
        Ok(file) => settings::get_theme(&file),
        Err(_) => settings::DEFAULT_THEME.to_string(),
    }
}

/// Saves the theme ("light", "dark" or "auto"; anything else is refused) and returns what is stored.
#[tauri::command]
fn set_theme<R: Runtime>(app: AppHandle<R>, theme: String) -> Result<String, String> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    settings::set_theme(&settings_file(&app)?, &theme)
}

/// The saved widths (px) of the navigator, outline and comments side panes; null for a pane with none saved (or when it can't be read).
#[tauri::command]
fn get_pane_widths<R: Runtime>(app: AppHandle<R>) -> settings::PaneWidths {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    match settings_file(&app) {
        Ok(file) => settings::get_pane_widths(&file),
        Err(_) => settings::PaneWidths::default(),
    }
}

/// Saves one pane's width ("navigator", "outline" or "comments"; 120..=800 px, anything else is refused);
/// a null width clears it. Returns all the stored widths.
#[tauri::command]
fn set_pane_width<R: Runtime>(app: AppHandle<R>, pane: String, width: Option<u32>) -> Result<settings::PaneWidths, String> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    settings::set_pane_width(&settings_file(&app)?, &pane, width)
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

/// Whether the app itself recorded `path` as an opened document.
fn is_recent<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<bool, String> {
    let _guard = RECENTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    Ok(recents::load(&recents_file(app)?).iter().any(|r| r.path == path))
}

/// A recent document from an earlier session is no longer in the fs scope. Re-grants its
/// folder, but only for a path the app itself recorded as opened.
#[tauri::command]
fn allow_recent_document<R: Runtime>(
    app: AppHandle<R>,
    remote: tauri::State<'_, ssh::fs::Remote>,
    path: String,
) -> Result<(), String> {
    if !is_recent(&app, &path)? {
        return Err("not a recent document".into());
    }
    if ssh::is_ssh_path(&path) {
        return ssh::allow_recent(&remote, &path);
    }
    let folder = PathBuf::from(&path).parent().map(PathBuf::from).ok_or("file has no folder")?;
    app.fs_scope().allow_directory(folder, true).map_err(|e| e.to_string())
}

/// Opens the main window's attention: shown, unminimised and focused.
fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Hands Markdown files the OS asked us to open to the frontend. Each file's folder joins the
/// fs scope (the OS launch is the user's choice, like a dialog pick), so relative images load.
fn deliver_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    for p in &paths {
        if let Some(folder) = PathBuf::from(p).parent() {
            let _ = app.fs_scope().allow_directory(folder, true);
            let _ = app.fs_scope().allow_file(p);
        }
    }
    if let Some(ready) = app.state::<launch::LaunchPaths>().deliver(paths) {
        let _ = app.emit(launch::OPEN_PATHS_EVENT, ready);
    }
}

/// The Markdown files the app was launched with (and any opened before the frontend asked).
/// After this call further launch paths arrive as `launch-open-paths` events.
#[tauri::command]
fn take_launch_paths(launch: tauri::State<'_, launch::LaunchPaths>) -> Vec<String> {
    launch.take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            focus_main(app);
            deliver_paths(app, launch::paths_from_args(&argv, std::path::Path::new(&cwd)));
        }))
        .manage(launch::LaunchPaths::default())
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default();
            let args: Vec<String> = std::env::args().collect();
            deliver_paths(app.handle(), launch::paths_from_args(&args, &cwd));
            Ok(())
        })
        .manage(ssh::new_pool())
        .manage(github::Github::production())
        .manage(ssh::fs::Remote::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            allow_document_folder,
            list_directory,
            path_exists,
            recent_documents_add,
            recent_documents_list,
            recent_documents_remove,
            allow_recent_document,
            get_author_name,
            set_author_name,
            get_theme,
            set_theme,
            get_pane_widths,
            set_pane_width,
            take_launch_paths,
            github::github_start,
            github::github_poll,
            github::github_status,
            github::github_sign_out,
            github::github_list_repos,
            github::github_list_branches,
            github::github_list_folder,
            github::github_read_file,
            github::github_commit_file,
            github::github_open_pulls_for_branches,
            github::github_branch_exists,
            github::github_create_branch,
            github::github_branches_exist,
            github::github_compare,
            github::github_create_pull,
            ssh::ssh_list_hosts,
            ssh::ssh_connect,
            ssh::ssh_disconnect,
            ssh::remote_list_folders,
            ssh::remote_open_root,
            ssh::remote_list_directory,
            ssh::remote_read,
            ssh::remote_write,
            ssh::remote_exists
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|#[cfg_attr(not(any(target_os = "macos", target_os = "ios")), allow(unused_variables))] app, event| match event {
        // macOS delivers files opened from Finder (file association) as events, not arguments.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        tauri::RunEvent::Opened { urls } => {
            let paths = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .filter(|p| launch::is_markdown(p) && p.is_file())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            focus_main(app);
            deliver_paths(app, paths);
        }
        _ => {}
    });
}
