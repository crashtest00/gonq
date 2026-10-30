//! Pins the JSON that GithubError, RemoteError and ListError reach the webview as, against what the frontend parses:
//! `toGitHubError` (packages/editor/src/platform/github.ts) reads `{kind, message?, status?, reset_at?}` and
//! `toRemoteError` (remote.ts) reads `{kind, message}`. The generated bindings.ts types the same shapes.
use gonq_core::folder::ListError;
use gonq_core::github::error::GithubError;
use gonq_core::ssh::fs::RemoteError;
use serde_json::json;

#[test]
fn github_error_is_kind_tagged_with_flat_fields() {
    let v = |e: GithubError| serde_json::to_value(e).unwrap();
    assert_eq!(v(GithubError::NotSignedIn), json!({"kind": "not_signed_in"}));
    assert_eq!(v(GithubError::Network { message: "timed out".into() }), json!({"kind": "network", "message": "timed out"}));
    assert_eq!(v(GithubError::Http { status: 404, message: "Not Found".into() }), json!({"kind": "http", "status": 404, "message": "Not Found"}));
    assert_eq!(
        v(GithubError::RateLimited { reset_at: Some(1700000000), message: "slow down".into() }),
        json!({"kind": "rate_limited", "reset_at": 1700000000u64, "message": "slow down"})
    );
    assert_eq!(v(GithubError::AlreadyExists), json!({"kind": "already_exists"}));
}

#[test]
fn remote_and_list_errors_are_kind_and_message() {
    assert_eq!(serde_json::to_value(RemoteError::AuthRequired("me@host".into())).unwrap(), json!({"kind": "auth_required", "message": "me@host"}));
    assert_eq!(serde_json::to_value(RemoteError::NotAFolder("/x".into())).unwrap(), json!({"kind": "not_a_folder", "message": "/x"}));
    assert_eq!(serde_json::to_value(ListError::NotAllowed("/y".into())).unwrap(), json!({"kind": "not_allowed", "message": "/y"}));
    assert_eq!(serde_json::to_value(ListError::PermissionDenied("/z".into())).unwrap(), json!({"kind": "permission_denied", "message": "/z"}));
}
