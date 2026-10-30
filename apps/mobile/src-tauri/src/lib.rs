//! The mobile Tauri app (`run`, the `mobile_entry_point`): installs the gonq-core plugin `gonq` (built without SSH) and the
//! dialog, fs and opener plugins. It owns no commands of its own; the single-instance plugin and launch-path handling are desktop-only.
use gonq_core::DataPaths;
use tauri::Manager;

/// The app's Tauri context (config + capabilities).
fn context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(DataPaths::resolve(app.handle()));
            Ok(())
        })
        .plugin(gonq_core::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .run(context())
        .expect("error while running tauri application");
}
