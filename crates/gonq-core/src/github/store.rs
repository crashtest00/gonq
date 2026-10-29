//! Where the token lives: the OS keychain, behind a trait so tests can swap in a mock.
//! Nothing here ever writes a file.

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
