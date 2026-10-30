# Android: token store and TLS verifier (M-10)

Status: the Rust side is in (`AndroidStore` in crates/gonq-core, `android_tls::init` in apps/mobile/src-tauri). Both are
UNVERIFIED on a device until M-13. The Gradle half is **deferred to M-09**: `apps/mobile/src-tauri/gen/android` does not exist
until `tauri android init` generates it, and it is not hand-written.

## What M-09 must add to the generated Gradle project

`rustls-platform-verifier` (0.7.x) needs its Kotlin component, `rustls-platform-verifier-android`, or every certificate check
fails. Per the crate's README, in the generated app's `build.gradle` (Groovy). `$PATH_TO_LOCK_FILE` is the repo's
`Cargo.lock`, relative to that file (e.g. `../../../../../../Cargo.lock`, to be checked against the generated layout):

```groovy
repositories {
    maven {
        url = "https://github.com/rustls/rustls-platform-verifier/raw/maven-archive/android-release-support/maven/"
    }
}

abstract class RustlsVersion implements ValueSource<String, RustlsVersion.Params> {
    interface Params extends ValueSourceParameters {
        RegularFileProperty getLockFile()
    }
    static final String CRATE_NAME = "rustls-platform-verifier-android"
    @Override
    String obtain() {
        def lines = parameters.lockFile.get().asFile.readLines()
        def idx = lines.findIndexOf { it.trim() == "name = \"$CRATE_NAME\"" }
        def version = idx < 0 ? null : lines.drop(idx + 1)
            .find { it.stripLeading().startsWith("version = ") }
            ?.find(/"([^"]*)"/) { match, v -> v }
        if (!version) throw new GradleException("$CRATE_NAME not found in lock file")
        return version
    }
}

dependencies {
    def rustlsVersion = providers.of(RustlsVersion) { parameters.lockFile = file("$PATH_TO_LOCK_FILE") }.get()
    implementation "rustls:rustls-platform-verifier:$rustlsVersion"
}
```

The authoritative snippet (including the `.gradle.kts` variant) is in the crate's README, section "Android > Gradle Setup":
~/.cargo/registry/src/*/rustls-platform-verifier-0.7.1/README.md. Cargo.lock currently pins
`rustls-platform-verifier-android` 0.2.0.

## Assumptions in the Rust code

- `ndk-context` is initialised by Tauri's runtime (tao 0.37.1 `onCreate` calls `ndk_context::initialize_android_context` with
  the JavaVM and the application Context before `run`). Checked in the source, not on a device. If it were not, the
  Keystore store reports `Unavailable` (session-only) and the verifier init is skipped with a log line.
- android-native-keyring-store 1.0.0 reads that context through `ndk-context`, so no Java-side `Keyring.initializeNdkContext`
  call is made.

## Behaviour to keep in mind

- Android Keystore entries **do not survive an uninstall** of the app. The UI must not promise a sign-in outlives a reinstall.
- `github_status` is unchanged (`storage: "keychain" | "session_only" | null`); an unavailable Keystore falls back to session only.
- `keychain_selftest` (debug builds only, in gonq-mobile) round-trips a dummy entry under account "selftest" and returns
  `{ store, round_trip, error }`; it never touches the real token.
