//! Build script: runs tauri-build (with its own app manifest turned off) and, on Windows, embeds the Common Controls v6
//! manifest (windows-test.manifest, identical to tauri-build's default) into every artifact, including the `gonq_lib` test
//! executable.

fn main() {
    // tauri-build links its resource with `rustc-link-arg-bins`, so the lib unit-test executable gets no manifest, binds
    // the v5 comctl32, and the loader fails with STATUS_ENTRYPOINT_NOT_FOUND before any test runs. Cargo has no link-arg
    // flag for lib unit tests (`rustc-link-arg-tests` is rejected as an invalid instruction in a package without
    // integration tests), so the manifest goes in through the all-artifacts `rustc-link-arg`; tauri-build must then not
    // embed its own, or the binary would carry two manifests.
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).unwrap();

    println!("cargo:rerun-if-changed=windows-test.rc");
    println!("cargo:rerun-if-changed=windows-test.manifest");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        embed_resource::compile_for_everything("windows-test.rc", embed_resource::NONE)
            .manifest_required()
            .unwrap();
    }
}
