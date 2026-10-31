//! Build script: runs tauri-build with the inlined `gonq-saf` plugin (the Android local-folder commands), which generates
//! their permissions (`gonq-saf:allow-local-list`, ..., and `gonq-saf:default` for all of them). The command list must match
//! `saf::COMMANDS` in src/saf.rs (a test there fails when it does not).
fn main() {
    let saf = tauri_build::InlinedPlugin::new()
        .commands(&[
            "local_pick_folder",
            "local_granted",
            "local_list",
            "local_stat",
            "local_read",
            "local_write",
            "local_create",
            "local_exists",
            "local_create_document",
        ])
        .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands);
    tauri_build::try_build(tauri_build::Attributes::new().plugin("gonq-saf", saf)).expect("failed to run tauri-build");
}
