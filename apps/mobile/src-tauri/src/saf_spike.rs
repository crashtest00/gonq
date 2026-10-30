//! M-14 SPIKE (throwaway, never merged): a Tauri plugin `safspike` whose one command `saf` forwards a command name and JSON
//! payload to the Kotlin SafPlugin (ACTION_OPEN_DOCUMENT_TREE, DocumentsContract) so the spike can be driven from the WebView.
use serde_json::Value;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

struct Handle<R: Runtime>(PluginHandle<R>);

#[tauri::command]
async fn saf<R: Runtime>(app: tauri::AppHandle<R>, command: String, args: Value) -> Result<Value, String> {
    app.state::<Handle<R>>().0.run_mobile_plugin_async(&command, args).await.map_err(|e| e.to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("safspike")
        .invoke_handler(tauri::generate_handler![saf])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            app.manage(Handle(api.register_android_plugin("com.gonq.app", "SafPlugin")?));
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
