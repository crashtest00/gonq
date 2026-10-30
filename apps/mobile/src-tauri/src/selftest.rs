//! Debug-only `keychain_selftest` command (compiled only with `debug_assertions`, so absent from release builds): writes, reads
//! and deletes a dummy entry under the account "selftest" in the token store and reports whether it round-tripped. It never
//! touches the real token (account "oauth-token"). Every string it returns is fixed text from the store's error mapping.
//! `run_selftest` takes any `TokenStore`, so it is unit-tested off-device with keyring-core's mock.

use gonq_core::github::store::{StoreError, TokenStore};
use serde::Serialize;

pub const SELFTEST_ACCOUNT: &str = "selftest";
const DUMMY: &str = "gonq-selftest-value";

/// `{ store: "keychain" | "unavailable"; round_trip: boolean; error: string | null }`.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct SelfTest {
    pub store: &'static str,
    pub round_trip: bool,
    pub error: Option<String>,
}

fn failed(store: &'static str, e: StoreError) -> SelfTest {
    let error = match e {
        StoreError::Unavailable => "no OS keychain is available".to_string(),
        StoreError::Failed(m) => m,
    };
    SelfTest { store, round_trip: false, error: Some(error) }
}

pub fn run_selftest(store: &dyn TokenStore) -> SelfTest {
    if let Err(e) = store.set(DUMMY) {
        let kind = if e == StoreError::Unavailable { "unavailable" } else { "keychain" };
        return failed(kind, e);
    }
    let read = store.get();
    // Always clean up, even when the read failed.
    let deleted = store.delete();
    match (read, deleted) {
        (Err(e), _) | (_, Err(e)) => failed("keychain", e),
        (Ok(got), Ok(())) => match store.get() {
            Ok(None) if got.as_deref() == Some(DUMMY) => SelfTest { store: "keychain", round_trip: true, error: None },
            Ok(_) => SelfTest { store: "keychain", round_trip: false, error: Some("the entry did not round-trip".into()) },
            Err(e) => failed("keychain", e),
        },
    }
}

#[tauri::command]
pub fn keychain_selftest() -> SelfTest {
    #[cfg(target_os = "android")]
    {
        run_selftest(&gonq_core::github::store::AndroidStore::with_account(SELFTEST_ACCOUNT))
    }
    #[cfg(not(target_os = "android"))]
    {
        SelfTest { store: "unavailable", round_trip: false, error: Some("the Android Keystore exists only on Android".into()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gonq_core::github::store::{CoreStore, ACCOUNT};
    use keyring_core::mock;

    #[test]
    fn round_trips_and_leaves_the_real_token_alone() {
        let m = mock::Store::new().unwrap();
        let real = CoreStore::new(m.clone(), ACCOUNT);
        real.set("real-token").unwrap();
        let r = run_selftest(&CoreStore::new(m, SELFTEST_ACCOUNT));
        assert_eq!(r, SelfTest { store: "keychain", round_trip: true, error: None });
        assert_eq!(real.get().unwrap().as_deref(), Some("real-token"));
    }

    #[test]
    fn reports_failures_as_fixed_text() {
        let m = mock::Store::new().unwrap();
        let s = CoreStore::new(m.clone(), SELFTEST_ACCOUNT);
        s.set("x").unwrap();
        m.inner.lock().unwrap().borrow()[0].set_error(keyring_core::Error::NoDefaultStore);
        let r = run_selftest(&s);
        assert_eq!(r.store, "unavailable");
        assert!(!r.round_trip);
        assert_eq!(r.error.as_deref(), Some("no OS keychain is available"));
    }
}
