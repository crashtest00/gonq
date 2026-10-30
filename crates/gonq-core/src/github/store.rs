//! Where the token lives: the OS keychain, behind a trait so tests can swap in a mock.
//! Nothing here ever writes a file. `KeyringStore` is the desktop keychain; `CoreStore` is a store over any
//! keyring-core credential store (tested off-device with keyring-core's mock), and `AndroidStore` (Android only) is
//! `CoreStore` over the Android Keystore. Android Keystore entries do not survive an uninstall of the app, so the UI must
//! never promise that a sign-in outlives a reinstall.

use super::error::GithubError;

pub const SERVICE: &str = "Gonq GitHub";
pub const ACCOUNT: &str = "oauth-token";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    /// There is no keychain on this machine (Linux without a secret service).
    Unavailable,
    /// The keychain exists but refused: locked, denied, or failing.
    Failed(String),
}

impl From<StoreError> for GithubError {
    fn from(e: StoreError) -> Self {
        match e {
            StoreError::Unavailable => GithubError::Keychain { message: "no OS keychain is available".into() },
            StoreError::Failed(message) => GithubError::Keychain { message },
        }
    }
}

pub trait TokenStore: Send + Sync {
    fn get(&self) -> Result<Option<String>, StoreError>;
    fn set(&self, token: &str) -> Result<(), StoreError>;
    /// Succeeds when there was nothing to delete.
    fn delete(&self) -> Result<(), StoreError>;
}

/// The OS keychain via the `keyring` crate (Keychain / Credential Manager / Secret Service).
pub struct KeyringStore;

fn classify(e: keyring::Error) -> StoreError {
    use keyring::Error as E;
    // Only fixed text: some variants carry the secret's bytes, so never format those.
    match e {
        E::NoDefaultStore | E::NotSupportedByStore(_) => StoreError::Unavailable,
        E::NoStorageAccess(_) => StoreError::Failed("the keychain is locked or access was denied".into()),
        E::PlatformFailure(_) => StoreError::Unavailable,
        E::BadEncoding(_) | E::BadDataFormat(..) | E::BadStoreFormat(_) => {
            StoreError::Failed("the stored GitHub token is unreadable".into())
        }
        _ => StoreError::Failed("the keychain reported an error".into()),
    }
}

/// A token store over any keyring-core credential store, under `SERVICE` and a chosen account. Errors go through
/// `classify`, so only fixed text ever leaves it.
pub struct CoreStore {
    store: std::sync::Arc<keyring_core::CredentialStore>,
    account: String,
}

impl CoreStore {
    pub fn new(store: std::sync::Arc<keyring_core::CredentialStore>, account: &str) -> Self {
        CoreStore { store, account: account.into() }
    }

    fn entry(&self) -> Result<keyring_core::Entry, StoreError> {
        self.store.build(SERVICE, &self.account, None).map_err(classify)
    }
}

impl TokenStore for CoreStore {
    fn get(&self) -> Result<Option<String>, StoreError> {
        match self.entry()?.get_password() {
            Ok(t) => Ok(Some(t)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(classify(e)),
        }
    }
    fn set(&self, token: &str) -> Result<(), StoreError> {
        self.entry()?.set_password(token).map_err(classify)
    }
    fn delete(&self) -> Result<(), StoreError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(classify(e)),
        }
    }
}

/// The Android Keystore (via android-native-keyring-store). UNVERIFIED on a device (M-13): it needs the `ndk-context`
/// application context, which the mobile app's Tauri runtime (tao) sets before Rust runs. The Keystore-backed store is
/// created on first use, so constructing this never touches JNI; if it cannot be created (no context, JNI error, even a
/// panic from a missing context) the store reports `Unavailable` and the app stays signed in for the session only.
#[cfg(target_os = "android")]
pub struct AndroidStore {
    account: String,
    inner: std::sync::OnceLock<Result<CoreStore, StoreError>>,
}

#[cfg(target_os = "android")]
impl AndroidStore {
    pub fn new() -> Self {
        Self::with_account(ACCOUNT)
    }

    /// A store under another account (the debug `keychain_selftest` uses "selftest" so it never touches the real token).
    pub fn with_account(account: &str) -> Self {
        AndroidStore { account: account.into(), inner: std::sync::OnceLock::new() }
    }

    fn core(&self) -> Result<&CoreStore, StoreError> {
        self.inner
            .get_or_init(|| {
                let made = std::panic::catch_unwind(android_native_keyring_store::Store::new);
                match made {
                    Ok(Ok(store)) => Ok(CoreStore::new(store, &self.account)),
                    Ok(Err(e)) => Err(classify(e)),
                    Err(_) => Err(StoreError::Unavailable),
                }
            })
            .as_ref()
            .map_err(Clone::clone)
    }
}

#[cfg(target_os = "android")]
impl Default for AndroidStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(target_os = "android")]
impl TokenStore for AndroidStore {
    fn get(&self) -> Result<Option<String>, StoreError> {
        self.core()?.get()
    }
    fn set(&self, token: &str) -> Result<(), StoreError> {
        self.core()?.set(token)
    }
    fn delete(&self) -> Result<(), StoreError> {
        self.core()?.delete()
    }
}

fn entry() -> Result<keyring::Entry, StoreError> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(classify)
}

impl TokenStore for KeyringStore {
    fn get(&self) -> Result<Option<String>, StoreError> {
        match entry()?.get_password() {
            Ok(t) => Ok(Some(t)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(classify(e)),
        }
    }
    fn set(&self, token: &str) -> Result<(), StoreError> {
        entry()?.set_password(token).map_err(classify)
    }
    fn delete(&self) -> Result<(), StoreError> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(classify(e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use keyring_core::mock;

    const SECRET: &[u8] = b"ghu_SECRETBYTES";

    fn mock_store() -> (std::sync::Arc<mock::Store>, CoreStore) {
        let m = mock::Store::new().unwrap();
        let core = CoreStore::new(m.clone(), ACCOUNT);
        (m, core)
    }

    #[test]
    fn core_store_round_trips_and_delete_is_idempotent() {
        let (_, s) = mock_store();
        assert_eq!(s.get().unwrap(), None);
        s.set("tok").unwrap();
        assert_eq!(s.get().unwrap().as_deref(), Some("tok"));
        s.delete().unwrap();
        s.delete().unwrap();
        assert_eq!(s.get().unwrap(), None);
    }

    #[test]
    fn accounts_are_separate() {
        let (m, real) = mock_store();
        let probe = CoreStore::new(m, "selftest");
        real.set("real").unwrap();
        probe.set("dummy").unwrap();
        probe.delete().unwrap();
        assert_eq!(real.get().unwrap().as_deref(), Some("real"));
    }

    /// Errors that carry the secret's bytes must come out as fixed text, whichever keyring-core error the store raises.
    #[test]
    fn errors_map_to_fixed_text_without_the_secret() {
        let cases: Vec<(keyring::Error, StoreError)> = vec![
            (keyring::Error::NoDefaultStore, StoreError::Unavailable),
            (keyring::Error::NotSupportedByStore("x".into()), StoreError::Unavailable),
            (keyring::Error::NoStorageAccess("denied".into()), StoreError::Failed("the keychain is locked or access was denied".into())),
            (keyring::Error::BadEncoding(SECRET.to_vec()), StoreError::Failed("the stored GitHub token is unreadable".into())),
            (
                keyring::Error::BadDataFormat(SECRET.to_vec(), "ghu_SECRETBYTES".into()),
                StoreError::Failed("the stored GitHub token is unreadable".into()),
            ),
            (keyring::Error::Invalid("ghu_SECRETBYTES".into(), "ghu_SECRETBYTES".into()), StoreError::Failed("the keychain reported an error".into())),
        ];
        for (err, want) in cases {
            let (m, s) = mock_store();
            s.set("tok").unwrap();
            m.inner.lock().unwrap().borrow()[0].set_error(err);
            let got = s.get().unwrap_err();
            assert_eq!(got, want);
            assert!(!format!("{got:?}").contains("SECRET"));
            let GithubError::Keychain { message } = GithubError::from(got) else { panic!("keychain error") };
            assert!(!message.contains("SECRET"));
        }
    }
}
