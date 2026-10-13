//! `ssh://user@host[:port]/absolute/path` — the one canonical spelling of a remote document.
//!
//! Everything that builds or reads such a string goes through [`RemotePath`], so two spellings of
//! the same file never become two tabs. Rules: the user is always present; the host is lower-cased
//! but otherwise as typed (an alias stays the alias); the port is left out when it is 22; the path
//! is absolute and `/`-separated, stored unescaped except that `%` is written `%25`.

use std::fmt;

pub const DEFAULT_PORT: u16 = 22;
const SCHEME: &str = "ssh://";

/// Identifies one connection: two aliases for the same server are two different keys.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConnKey {
    pub user: String,
    pub host: String,
    pub port: u16,
}

impl ConnKey {
    pub fn new(user: &str, host: &str, port: u16) -> Self {
        ConnKey { user: user.to_string(), host: host.to_lowercase(), port }
    }

    /// `user@host` or `user@host:port`, as shown to the user and used in URIs.
    pub fn authority(&self) -> String {
        let host = if self.host.contains(':') { format!("[{}]", self.host) } else { self.host.clone() };
        if self.port == DEFAULT_PORT {
            format!("{}@{host}", self.user)
        } else {
            format!("{}@{host}:{}", self.user, self.port)
        }
    }
}

impl fmt::Display for ConnKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.authority())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UriError {
    NotSsh,
    MissingUser,
    MissingHost,
    BadPort,
    /// The path part is missing or does not start with `/`.
    RelativePath,
}

impl fmt::Display for UriError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            UriError::NotSsh => "not an ssh:// address",
            UriError::MissingUser => "the address has no user",
            UriError::MissingHost => "the address has no host",
            UriError::BadPort => "the port is not a number from 1 to 65535",
            UriError::RelativePath => "the path must be absolute",
        })
    }
}

impl std::error::Error for UriError {}

/// A file or folder on a remote host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemotePath {
    pub key: ConnKey,
    /// Absolute, `/`-separated, unescaped. May still start with `/~` until resolved against the
    /// home directory (see [`RemotePath::resolve_home`]).
    pub path: String,
}

impl RemotePath {
    pub fn new(key: ConnKey, path: &str) -> Result<Self, UriError> {
        if !path.starts_with('/') {
            return Err(UriError::RelativePath);
        }
        Ok(RemotePath { key, path: path.to_string() })
    }

    pub fn parse(uri: &str) -> Result<Self, UriError> {
        let rest = strip_scheme(uri).ok_or(UriError::NotSsh)?;
        let slash = rest.find('/').ok_or(UriError::RelativePath)?;
        let (authority, path) = rest.split_at(slash);
        let (user, host, port) = parse_authority(authority)?;
        let user = user.ok_or(UriError::MissingUser)?;
        Ok(RemotePath { key: ConnKey::new(&user, &host, port.unwrap_or(DEFAULT_PORT)), path: unescape(path) })
    }

    /// True while the path is still `/~` or `/~/…` and needs the host's home directory.
    pub fn needs_home(&self) -> bool {
        self.path == "/~" || self.path.starts_with("/~/")
    }

    /// Replaces a leading `~` with `home` (the SFTP realpath of `.`); other paths are unchanged.
    pub fn resolve_home(&self, home: &str) -> RemotePath {
        if !self.needs_home() {
            return self.clone();
        }
        let rest = &self.path[2..];
        let home = home.trim_end_matches('/');
        RemotePath { key: self.key.clone(), path: format!("{home}{rest}") }
    }
}

impl fmt::Display for RemotePath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{SCHEME}{}{}", self.key.authority(), self.path.replace('%', "%25"))
    }
}

fn strip_scheme(s: &str) -> Option<&str> {
    let head = s.get(..SCHEME.len())?;
    head.eq_ignore_ascii_case(SCHEME).then(|| &s[SCHEME.len()..])
}

/// Only `%25` is an escape; any other `%` is kept as typed.
fn unescape(path: &str) -> String {
    path.replace("%25", "%")
}

/// Splits `[user@]host[:port]` (host may be a bracketed IPv6 address).
fn parse_authority(authority: &str) -> Result<(Option<String>, String, Option<u16>), UriError> {
    let (user, hostport) = match authority.rfind('@') {
        Some(i) => {
            let user = &authority[..i];
            if user.is_empty() {
                return Err(UriError::MissingUser);
            }
            (Some(user.to_string()), &authority[i + 1..])
        }
        None => (None, authority),
    };
    let (host, port) = if let Some(inner) = hostport.strip_prefix('[') {
        let end = inner.find(']').ok_or(UriError::MissingHost)?;
        let port = match &inner[end + 1..] {
            "" => None,
            p => Some(parse_port(p.strip_prefix(':').ok_or(UriError::BadPort)?)?),
        };
        (inner[..end].to_string(), port)
    } else {
        match hostport.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), Some(parse_port(p)?)),
            None => (hostport.to_string(), None),
        }
    };
    if host.is_empty() {
        return Err(UriError::MissingHost);
    }
    Ok((user, host, port))
}

fn parse_port(p: &str) -> Result<u16, UriError> {
    match p.parse::<u16>() {
        Ok(n) if n > 0 => Ok(n),
        _ => Err(UriError::BadPort),
    }
}

/// What the user typed in the Connect box: `host`, `user@host`, `user@host:port`, an alias, or a
/// pasted `ssh://` address (any path after the authority is ignored).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub user: Option<String>,
    pub host: String,
    pub port: Option<u16>,
}

impl Target {
    pub fn parse(input: &str) -> Result<Target, UriError> {
        let input = input.trim();
        let rest = strip_scheme(input).unwrap_or(input);
        let authority = rest.split('/').next().unwrap_or("");
        let (user, host, port) = parse_authority(authority)?;
        Ok(Target { user, host: host.to_lowercase(), port })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> RemotePath {
        RemotePath::parse(s).unwrap()
    }

    #[test]
    fn default_port_is_dropped() {
        let r = p("ssh://me@nas:22/home/me/a.md");
        assert_eq!(r.key.port, 22);
        assert_eq!(r.to_string(), "ssh://me@nas/home/me/a.md");
    }

    #[test]
    fn other_ports_are_kept() {
        assert_eq!(p("ssh://me@nas:2222/a.md").to_string(), "ssh://me@nas:2222/a.md");
    }

    #[test]
    fn host_is_lower_cased_path_is_not() {
        let r = p("ssh://Me@NAS.Example.COM/Home/A.md");
        assert_eq!(r.key.user, "Me");
        assert_eq!(r.key.host, "nas.example.com");
        assert_eq!(r.path, "/Home/A.md");
    }

    #[test]
    fn percent_round_trips() {
        let r = p("ssh://me@nas/notes/100%25 done.md");
        assert_eq!(r.path, "/notes/100% done.md");
        assert_eq!(r.to_string(), "ssh://me@nas/notes/100%25 done.md");
        let literal = RemotePath::new(ConnKey::new("me", "nas", 22), "/a%41.md").unwrap();
        assert_eq!(literal.to_string(), "ssh://me@nas/a%2541.md");
        assert_eq!(p(&literal.to_string()), literal);
    }

    #[test]
    fn spaces_and_odd_characters_are_kept() {
        let r = p("ssh://me@nas/my notes/what? #1.md");
        assert_eq!(r.path, "/my notes/what? #1.md");
        assert_eq!(r.to_string(), "ssh://me@nas/my notes/what? #1.md");
    }

    #[test]
    fn tilde_resolves_against_home() {
        let r = p("ssh://me@nas/~/notes/a.md");
        assert!(r.needs_home());
        let done = r.resolve_home("/home/me");
        assert_eq!(done.path, "/home/me/notes/a.md");
        assert!(!done.needs_home());
        assert_eq!(p("ssh://me@nas/~").resolve_home("/home/me/").path, "/home/me");
        assert_eq!(p("ssh://me@nas/~x/a").resolve_home("/h").path, "/~x/a");
    }

    #[test]
    fn user_is_required_and_path_must_be_absolute() {
        assert_eq!(RemotePath::parse("ssh://nas/a.md"), Err(UriError::MissingUser));
        assert_eq!(RemotePath::parse("ssh://me@nas"), Err(UriError::RelativePath));
        assert_eq!(RemotePath::parse("http://me@nas/a"), Err(UriError::NotSsh));
        assert_eq!(RemotePath::parse("ssh://me@/a"), Err(UriError::MissingHost));
        assert_eq!(RemotePath::parse("ssh://me@nas:x/a"), Err(UriError::BadPort));
        assert_eq!(RemotePath::parse("ssh://me@nas:0/a"), Err(UriError::BadPort));
    }

    #[test]
    fn scheme_is_case_insensitive() {
        assert_eq!(p("SSH://me@nas/a.md").to_string(), "ssh://me@nas/a.md");
    }

    #[test]
    fn ipv6_hosts_are_bracketed() {
        let r = p("ssh://me@[::1]:2200/a.md");
        assert_eq!((r.key.host.as_str(), r.key.port), ("::1", 2200));
        assert_eq!(r.to_string(), "ssh://me@[::1]:2200/a.md");
    }

    #[test]
    fn aliases_for_one_server_are_distinct_keys() {
        assert_ne!(ConnKey::new("me", "nas", 22), ConnKey::new("me", "nas.lan", 22));
        assert_eq!(ConnKey::new("me", "NAS", 22), ConnKey::new("me", "nas", 22));
    }

    #[test]
    fn target_accepts_what_the_user_types() {
        assert_eq!(Target::parse("nas").unwrap(), Target { user: None, host: "nas".into(), port: None });
        assert_eq!(
            Target::parse(" Me@NAS:2222 ").unwrap(),
            Target { user: Some("Me".into()), host: "nas".into(), port: Some(2222) }
        );
        assert_eq!(
            Target::parse("ssh://me@nas/some/where.md").unwrap(),
            Target { user: Some("me".into()), host: "nas".into(), port: None }
        );
        assert!(Target::parse("").is_err());
    }
}
