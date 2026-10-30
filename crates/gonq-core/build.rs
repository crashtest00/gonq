//! Build script: generates the `gonq` plugin's permissions (an allow-/deny- pair per command in `command_names::COMMANDS`,
//! next to the committed permissions/default.json) and, on Windows, embeds the desktop app's Common Controls v6 manifest (apps/desktop/src-tauri/windows-app.manifest,
//! the one copy) into gonq-core's own test executable. The crate links tauri, so without it the lib unit-test executable binds
//! the v5 comctl32 and the loader fails with STATUS_ENTRYPOINT_NOT_FOUND before any test runs (see the desktop build.rs).
//! The .rc is generated in OUT_DIR with the manifest's absolute path, so it does not depend on rc's search directory.

use std::{env, fs, path::PathBuf};

#[path = "src/command_names.rs"]
mod command_names;

fn main() {
    println!("cargo:rerun-if-changed=src/command_names.rs");
    tauri_plugin::Builder::new(command_names::COMMANDS).build();

    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../../apps/desktop/src-tauri/windows-app.manifest");
    println!("cargo:rerun-if-changed={}", manifest.display());
    let manifest = fs::canonicalize(&manifest).unwrap_or(manifest);
    let rc = PathBuf::from(env::var("OUT_DIR").unwrap()).join("gonq-core.rc");
    let path = manifest.to_string_lossy().trim_start_matches(r"\\?\").replace('\\', "/");
    fs::write(&rc, format!("#define RT_MANIFEST 24\n1 RT_MANIFEST \"{path}\"\n")).unwrap();
    // embed-resource checks the target itself and returns NotWindows (which `manifest_required` accepts) elsewhere.
    embed_resource::compile_for_everything(&rc, embed_resource::NONE).manifest_required().unwrap();
}
