//! The `gonq-saf` Tauri plugin (`init`), registered by this crate only: a thin shim whose `local_*` commands (incl. `local_create_document`, the Save as picker) forward to the
//! Kotlin `SafPlugin` (Storage Access Framework, gen/android/.../SafPlugin.kt) and turn its rejections into `{kind, message}`
//! errors for packages/editor/src/platform/local.ts, the only caller. Off Android every command fails with kind `unsupported`.
//! The logic (listing, conflict check, error codes) is in Kotlin; nothing here reads a path or a grant.
use serde::Serialize;
use serde_json::{json, Value};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Runtime};

/// The commands, in the order build.rs lists them (permissions are generated from that list).
pub const COMMANDS: &[&str] = &[
    "local_pick_folder",
    "local_granted",
    "local_list",
    "local_stat",
    "local_read",
    "local_write",
    "local_create",
    "local_exists",
    "local_create_document",
];

/// What a failed command rejects with. `kind` is the Kotlin reject code (`not-found`, `permission`, `outside`, `conflict`,
/// `exists`, `unsupported`, `io`).
#[derive(Debug, Serialize)]
pub struct SafError {
    pub kind: String,
    pub message: String,
}

#[cfg(target_os = "android")]
struct Handle<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
async fn forward<R: Runtime>(app: &AppHandle<R>, command: &str, args: Value) -> Result<Value, SafError> {
    use tauri::plugin::mobile::PluginInvokeError;
    use tauri::Manager;
    let handle = app.state::<Handle<R>>();
    match handle.0.run_mobile_plugin_async::<Value>(command, args).await {
        Ok(v) => Ok(v),
        Err(PluginInvokeError::InvokeRejected(r)) => Err(SafError {
            kind: r.code.unwrap_or_else(|| "io".into()),
            message: r.message.unwrap_or_else(|| "The folder could not be accessed.".into()),
        }),
        Err(e) => Err(SafError { kind: "io".into(), message: e.to_string() }),
    }
}

#[cfg(not(target_os = "android"))]
async fn forward<R: Runtime>(_app: &AppHandle<R>, _command: &str, _args: Value) -> Result<Value, SafError> {
    Err(SafError { kind: "unsupported".into(), message: "Local folders are only available in the Android app.".into() })
}

#[tauri::command]
async fn local_pick_folder<R: Runtime>(app: AppHandle<R>) -> Result<Value, SafError> {
    forward(&app, "local_pick_folder", json!({})).await
}

#[tauri::command]
async fn local_granted<R: Runtime>(app: AppHandle<R>) -> Result<Value, SafError> {
    forward(&app, "local_granted", json!({})).await
}

#[tauri::command]
async fn local_list<R: Runtime>(app: AppHandle<R>, tree: String, rel: String) -> Result<Value, SafError> {
    forward(&app, "local_list", json!({ "tree": tree, "rel": rel })).await
}

#[tauri::command]
async fn local_stat<R: Runtime>(app: AppHandle<R>, tree: String, rel: String) -> Result<Value, SafError> {
    forward(&app, "local_stat", json!({ "tree": tree, "rel": rel })).await
}

#[tauri::command]
async fn local_read<R: Runtime>(app: AppHandle<R>, tree: String, rel: String) -> Result<Value, SafError> {
    forward(&app, "local_read", json!({ "tree": tree, "rel": rel })).await
}

#[tauri::command]
async fn local_write<R: Runtime>(
    app: AppHandle<R>,
    tree: String,
    rel: String,
    text: String,
    expected: Option<Value>,
) -> Result<Value, SafError> {
    forward(&app, "local_write", json!({ "tree": tree, "rel": rel, "text": text, "expected": expected })).await
}

#[tauri::command]
async fn local_create<R: Runtime>(app: AppHandle<R>, tree: String, rel: String, text: String) -> Result<Value, SafError> {
    forward(&app, "local_create", json!({ "tree": tree, "rel": rel, "text": text })).await
}

#[tauri::command]
async fn local_exists<R: Runtime>(app: AppHandle<R>, tree: String, rel: String) -> Result<Value, SafError> {
    forward(&app, "local_exists", json!({ "tree": tree, "rel": rel })).await
}

/// Save as for a file outside any opened folder: the system create-document picker (`ACTION_CREATE_DOCUMENT`) with a
/// suggested name; the new document's grant is persisted. Cancel resolves `{picked: false}`.
#[tauri::command]
async fn local_create_document<R: Runtime>(app: AppHandle<R>, name: String) -> Result<Value, SafError> {
    forward(&app, "local_create_document", json!({ "name": name })).await
}

/// The plugin; on Android it registers the Kotlin class `com.gonq.app.SafPlugin`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("gonq-saf")
        .invoke_handler(tauri::generate_handler![
            local_pick_folder,
            local_granted,
            local_list,
            local_stat,
            local_read,
            local_write,
            local_create,
            local_exists,
            local_create_document
        ])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                _app.manage(Handle(_api.register_android_plugin("com.gonq.app", "SafPlugin")?));
            }
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::COMMANDS;

    #[test]
    fn build_rs_lists_the_same_commands() {
        let build = include_str!("../build.rs");
        for c in COMMANDS {
            assert!(build.contains(&format!("\"{c}\"")), "build.rs does not list {c}");
        }
        assert_eq!(build.matches("\"local_").count(), COMMANDS.len());
    }

    #[test]
    fn capability_allows_the_plugin() {
        let cap = include_str!("../capabilities/mobile.json");
        assert!(cap.contains("\"gonq-saf:default\""));
    }
}
