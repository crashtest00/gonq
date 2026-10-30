//! Android-only start-up init for HTTPS: hands the JavaVM and application Context to rustls-platform-verifier (0.7.x
//! `android::init_with_env`), without which every certificate check fails (reqwest 0.13 verifies through it).
//!
//! Assumptions, UNVERIFIED on a device until M-13: (1) `ndk_context` is already initialised when `run` starts. Verified in
//! the source of tao 0.37.1 (the Tauri Android runtime): `onCreate` calls `ndk_context::initialize_android_context` with
//! the JavaVM and the application Context before the Rust entry point runs. The same context serves
//! android-native-keyring-store (the Keystore token store in gonq-core). (2) The verifier's Kotlin component is in the
//! Gradle project, which does not exist until M-09 generates it (see docs/android-tls-gradle.md). A failure here is logged,
//! never fatal: the app still starts and GitHub calls then fail with a TLS error, which M-13 would catch.

use jni::objects::JObject;
use jni::JavaVM;

pub fn init() {
    // `android_context()` panics when nothing initialised it; turn that into a log line rather than an abort.
    let result = std::panic::catch_unwind(|| {
        let ctx = ndk_context::android_context();
        // SAFETY: ndk-context stores the live JavaVM pointer and a global ref to the application Context.
        let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) };
        vm.attach_current_thread(|env| -> Result<(), jni::errors::Error> {
            // ndk-context owns this reference (a global one), so the wrapper must never be dropped (that would
            // DeleteLocalRef it); the verifier gets its own fresh local ref to take a global ref from.
            let borrowed = std::mem::ManuallyDrop::new(unsafe { JObject::from_raw(env, ctx.context().cast()) });
            let context = env.new_local_ref(&*borrowed)?;
            rustls_platform_verifier::android::init_with_env(env, context)
        })
    });
    match result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => eprintln!("gonq: rustls-platform-verifier init failed: {e}"),
        Err(_) => eprintln!("gonq: rustls-platform-verifier init skipped: ndk-context is not initialised"),
    }
}
