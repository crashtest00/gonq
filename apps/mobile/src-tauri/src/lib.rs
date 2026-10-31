//! The mobile Tauri app (`run`, the `mobile_entry_point`): installs the gonq-core plugin `gonq` (built without SSH) and the
//! dialog, fs and opener plugins plus the app's own `gonq-saf` plugin (saf.rs: Android local folders via the Storage Access Framework). On Android it first initialises rustls-platform-verifier from the ndk-context (see
//! `android_tls`). Its only command of its own is the debug-only `keychain_selftest` (selftest.rs, absent from release
//! builds); the single-instance plugin and launch-path handling are desktop-only.
#[cfg(target_os = "android")]
mod android_tls;
pub mod saf;
#[cfg(debug_assertions)]
pub mod selftest;

use gonq_core::DataPaths;
use tauri::Manager;

/// The app's Tauri context (config + capabilities).
fn context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before the GitHub client exists: it verifies certificates through the platform verifier, which needs this.
    #[cfg(target_os = "android")]
    android_tls::init();
    let builder = tauri::Builder::default();
    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![selftest::keychain_selftest]);
    builder
        .setup(|app| {
            app.manage(DataPaths::resolve(app.handle()));
            Ok(())
        })
        .plugin(gonq_core::init())
        .plugin(saf::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .run(context())
        .expect("error while running tauri application");
}
