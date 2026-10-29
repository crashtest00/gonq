//! Tests that send the exact JSON the frontend's invoke() sends (src/platform/settings.ts) through Tauri's real IPC
//! into get_pane_widths / set_pane_width, so the argument names, `Option<u32>` null handling and return shape are pinned.
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{ipc::InvokeBody, WebviewWindowBuilder};

// The origin the webview reports for the app's own pages: Tauri serves them from http://tauri.localhost on Windows and
// from tauri://localhost elsewhere. Any other origin is treated as remote and fails the ACL with "Plugin not found".
const IPC_ORIGIN: &str = if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" };

fn call(
    w: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, serde_json::Value> {
    get_ipc_response(
        w,
        InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: IPC_ORIGIN.parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|b| b.deserialize::<serde_json::Value>().unwrap())
}

#[test]
fn frontend_arguments_reach_the_pane_width_commands() {
    let dir = tempfile::tempdir().unwrap();
    let app = mock_builder()
        .invoke_handler(crate::invoke_handler())
        .manage(gonq_core::DataPaths {
            settings: Ok(dir.path().join("settings.json")),
            recents: Ok(dir.path().join("recent.json")),
        })
        .build(mock_context(noop_assets()))
        .unwrap();
    let w = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    let none = serde_json::json!({"navigator": null, "outline": null, "comments": null});

    // Nothing saved: every pane is null (the frontend then uses its default).
    assert_eq!(call(&w, "get_pane_widths", serde_json::json!({})).unwrap(), none);

    call(&w, "set_author_name", serde_json::json!({"name": "Ann"})).unwrap();
    call(&w, "set_theme", serde_json::json!({"theme": "dark"})).unwrap();

    // Exact payloads of setPaneWidth(pane, width), one per pane.
    let r = call(&w, "set_pane_width", serde_json::json!({"pane": "navigator", "width": 300})).unwrap();
    assert_eq!(r, serde_json::json!({"navigator": 300, "outline": null, "comments": null}));
    call(&w, "set_pane_width", serde_json::json!({"pane": "outline", "width": 280})).unwrap();
    call(&w, "set_pane_width", serde_json::json!({"pane": "comments", "width": 500})).unwrap();
    let all = serde_json::json!({"navigator": 300, "outline": 280, "comments": 500});
    assert_eq!(call(&w, "get_pane_widths", serde_json::json!({})).unwrap(), all);

    // A null width clears exactly that pane, for each of the three, and leaves the others and author/theme alone.
    for (pane, expect) in [
        ("navigator", serde_json::json!({"navigator": null, "outline": 280, "comments": 500})),
        ("outline", serde_json::json!({"navigator": null, "outline": null, "comments": 500})),
        ("comments", none.clone()),
    ] {
        let r = call(&w, "set_pane_width", serde_json::json!({"pane": pane, "width": null})).unwrap();
        assert_eq!(r, expect, "clearing {pane}");
        assert_eq!(call(&w, "get_pane_widths", serde_json::json!({})).unwrap(), expect);
    }
    assert_eq!(call(&w, "get_author_name", serde_json::json!({})).unwrap(), "Ann");
    assert_eq!(call(&w, "get_theme", serde_json::json!({})).unwrap(), "dark");

    // Refused through the command too: the stored widths do not change.
    call(&w, "set_pane_width", serde_json::json!({"pane": "outline", "width": 300})).unwrap();
    for bad in [
        serde_json::json!({"pane": "folder", "width": 300}),
        serde_json::json!({"pane": "outline", "width": 119}),
        serde_json::json!({"pane": "outline", "width": 801}),
        serde_json::json!({"pane": "outline", "width": -5}),
        serde_json::json!({"pane": "outline", "width": "300"}),
        serde_json::json!({"pane": "outline", "width": 300.5}),
        serde_json::json!({"width": 300}),
    ] {
        assert!(call(&w, "set_pane_width", bad.clone()).is_err(), "{bad} should be refused");
    }
    assert_eq!(
        call(&w, "get_pane_widths", serde_json::json!({})).unwrap(),
        serde_json::json!({"navigator": null, "outline": 300, "comments": null})
    );

    // The legacy `folder` key is ignored (not migrated); other settings survive.
    let settings = dir.path().join("settings.json");
    assert!(settings.is_file());
    std::fs::write(&settings, r#"{"author_name":"Ann","theme":"dark","pane_widths":{"folder":333,"outline":300}}"#).unwrap();
    assert_eq!(
        call(&w, "get_pane_widths", serde_json::json!({})).unwrap(),
        serde_json::json!({"navigator": null, "outline": 300, "comments": null})
    );
    call(&w, "set_pane_width", serde_json::json!({"pane": "comments", "width": 400})).unwrap();
    // Ignored, not migrated: the stale value never becomes the navigator width.
    assert_eq!(
        call(&w, "get_pane_widths", serde_json::json!({})).unwrap(),
        serde_json::json!({"navigator": null, "outline": 300, "comments": 400})
    );
    assert_eq!(call(&w, "get_author_name", serde_json::json!({})).unwrap(), "Ann");
}
