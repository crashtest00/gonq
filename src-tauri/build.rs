//! Build script: runs tauri-build (which embeds the Windows manifest and icon in the shipped binary only) and, on
//! Windows, also embeds the same Common Controls v6 manifest into the test executables, which tauri-build skips.

fn main() {
    tauri_build::build();

    // tauri-build links its resource with `rustc-link-arg-bins` (embed-resource `compile`), so the `gonq_lib` test
    // executable gets no manifest and binds the v5 comctl32, which lacks entry points the Tauri dependencies import;
    // the loader then fails with STATUS_ENTRYPOINT_NOT_FOUND before any test runs.
    println!("cargo:rerun-if-changed=windows-test.rc");
    println!("cargo:rerun-if-changed=windows-test.manifest");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        embed_resource::compile_for_tests("windows-test.rc", embed_resource::NONE)
            .manifest_required()
            .unwrap();
    }
}
