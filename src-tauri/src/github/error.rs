//! Typed errors for the GitHub module. Every message is built from fixed text and GitHub's own
//! public `message`; the token and the device code are never part of one.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GithubError {
    /// The user refused the sign-in on github.com.
    AccessDenied,
    /// The device code ran out (GitHub's `expired_token` / `token_expired`, or `expires_in` passed).
    Expired,
    /// Device flow is switched off for the OAuth app.
    DeviceFlowDisabled,
    /// GitHub does not know the device code.
    IncorrectDeviceCode,
    /// A newer sign-in (or a sign out) replaced this one.
    Cancelled,
    /// `poll` without a `start` before it.
    NoSignInInProgress,
    /// The OS keychain refused or is locked.
    Keychain { message: String },
    /// No usable network connection to GitHub.
    Network { message: String },
    /// There is no token, or GitHub rejected it (the stored one is then deleted).
    NotSignedIn,
    /// GitHub answered with a non-2xx status.
    Http { status: u16, message: String },
    /// Primary or secondary rate limit; `reset_at` is Unix seconds when known.
    RateLimited { reset_at: Option<u64>, message: String },
    /// The branch (ref) does not exist, or was deleted.
    BranchNotFound,
    /// Creating a branch found its name already taken, serialized as kind `already_exists` (GitHub's 422 "Reference already exists"). Nothing was changed.
    AlreadyExists,
    /// The path does not exist on that branch.
    PathNotFound,
    /// The path is a file, not a folder.
    NotAFolder,
    /// The path is a folder (or anything else that is not a file, symlink or submodule), not a file.
    NotAFile,
    /// The path is a symbolic link.
    Symlink,
    /// The path is a submodule.
    Submodule,
    /// GitHub refused access (403 that is not a rate limit): no permission for this repository or path.
    NoAccess { message: String },
    /// The file is too big for the contents API to return inline (over 1 MB).
    FileTooLarge,
    /// The repository has no commits.
    EmptyRepo,
    /// A reply we cannot interpret, or a URL we refuse to send the token to.
    Unexpected { message: String },
}

impl std::fmt::Display for GithubError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AccessDenied => write!(f, "GitHub sign-in was denied"),
            Self::Expired => write!(f, "the GitHub sign-in code expired"),
            Self::DeviceFlowDisabled => write!(f, "device flow is disabled for this GitHub app"),
            Self::IncorrectDeviceCode => write!(f, "GitHub did not recognise the sign-in code"),
            Self::Cancelled => write!(f, "the GitHub sign-in was cancelled"),
            Self::NoSignInInProgress => write!(f, "no GitHub sign-in is in progress"),
            Self::Keychain { message } => write!(f, "the OS keychain failed: {message}"),
            Self::Network { message } => write!(f, "could not reach GitHub: {message}"),
            Self::NotSignedIn => write!(f, "not signed in to GitHub"),
            Self::Http { status, message } => write!(f, "GitHub returned {status}: {message}"),
            Self::RateLimited { reset_at: Some(t), message } => {
                write!(f, "GitHub rate limit reached (resets at Unix time {t}): {message}")
            }
            Self::RateLimited { reset_at: None, message } => write!(f, "GitHub rate limit reached: {message}"),
            Self::BranchNotFound => write!(f, "that branch was not found (or the repository is private or inaccessible)"),
            Self::AlreadyExists => write!(f, "that branch already exists"),
            Self::PathNotFound => write!(f, "that path was not found on the branch"),
            Self::NotAFolder => write!(f, "that path is a file, not a folder"),
            Self::NotAFile => write!(f, "that path is not a file"),
            Self::Symlink => write!(f, "that path is a symbolic link, not a file"),
            Self::Submodule => write!(f, "that path is a submodule, not a file"),
            Self::NoAccess { message } => write!(f, "no access to that repository or path: {message}"),
            Self::FileTooLarge => write!(f, "that file is too large to open from GitHub"),
            Self::EmptyRepo => write!(f, "the repository is empty"),
            Self::Unexpected { message } => write!(f, "unexpected GitHub reply: {message}"),
        }
    }
}

impl std::error::Error for GithubError {}

/// A transport error as fixed text: reqwest's own Display can carry the URL.
pub fn network(e: reqwest::Error) -> GithubError {
    let what = if e.is_timeout() {
        "timed out"
    } else if e.is_connect() {
        "connection failed"
    } else if e.is_decode() || e.is_body() {
        "unreadable reply"
    } else {
        "request failed"
    };
    GithubError::Network { message: what.into() }
}
