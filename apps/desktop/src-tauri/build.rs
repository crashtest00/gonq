//! Build script: runs tauri-build (with its own app manifest turned off) and, on Windows, embeds the Common Controls v6
//! manifest (windows-app.manifest, via windows-app.rc) into every artifact, including the `gonq_lib` test executable.
//! windows-app.manifest is the shipped app's only Windows manifest and must stay in sync with tauri-build's default.

fn main() {
    // tauri-build links its resource with `rustc-link-arg-bins`, so the lib unit-test executable gets no manifest, binds
    // the v5 comctl32, and the loader fails with STATUS_ENTRYPOINT_NOT_FOUND before any test runs. Cargo has no link-arg
    // flag for lib unit tests (`rustc-link-arg-tests` is rejected as an invalid instruction in a package without
    // integration tests), so the manifest goes in through the all-artifacts `rustc-link-arg`; tauri-build must then not
    // embed its own, or the binary would carry two manifests.
    //
    // Any change to the app manifest goes in windows-app.manifest. Do not set `WindowsAttributes::app_manifest`: that
    // would make tauri-build embed a second manifest next to this one and the link would fail.
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).unwrap();

    println!("cargo:rerun-if-changed=windows-app.rc");
    println!("cargo:rerun-if-changed=windows-app.manifest");
    // No CARGO_CFG_TARGET_OS guard: embed-resource checks the target itself and returns NotWindows (which
    // `manifest_required` accepts) on other platforms, so a guard here would only repeat that check.
    embed_resource::compile_for_everything("windows-app.rc", embed_resource::NONE)
        .manifest_required()
        .unwrap();
}
