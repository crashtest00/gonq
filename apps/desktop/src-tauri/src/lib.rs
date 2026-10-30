//! The desktop Tauri app (`run`): defines the launch-only pieces (focus_main, deliver_paths, take_launch_paths, the
//! app's one own command) and installs the gonq-core plugin `gonq` (every other command, with its managed state), plus the
//! single-instance, dialog, fs and opener plugins. The shared logic and `DataPaths` live in the gonq-core crate.
#[cfg(test)]
mod bindings;
mod launch;
#[cfg(test)]
mod pane_width_ipc_tests;

use gonq_core::DataPaths;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_fs::FsExt;

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
#[specta::specta]
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
            app.manage(DataPaths::resolve(app.handle()));
            let cwd = std::env::current_dir().unwrap_or_default();
            let args: Vec<String> = std::env::args().collect();
            deliver_paths(app.handle(), launch::paths_from_args(&args, &cwd));
            Ok(())
        })
        .plugin(gonq_core::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![take_launch_paths])
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
