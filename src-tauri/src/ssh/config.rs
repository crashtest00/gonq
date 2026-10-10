//! `~/.ssh/config`: `Host` names and the `HostName`, `User`, `Port`, `IdentityFile` settings.
//!
//! `Match` blocks are skipped and `ProxyJump` is ignored; a missing or unreadable file is an
//! empty configuration.

use super::uri::{Target, DEFAULT_PORT};
use ssh2_config::{ParseRule, SshConfig};
use std::io::Cursor;
use std::path::{Path, PathBuf};

#[derive(Debug, Default)]
pub struct SshConfigFile {
    config: Option<SshConfig>,
}

/// A target with the config file's settings applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    /// The user to log in as: typed, else `User` from the config, else the local user.
    pub user: String,
    /// The name as typed (lower-cased). Together with `user` and `port` this is the connection's identity.
    pub alias: String,
    /// The name to dial and to look up in `known_hosts`: `HostName` when the config has one.
    pub hostname: String,
    /// Typed, else `Port` from the config, else 22.
    pub port: u16,
    /// `IdentityFile` entries in order, `~` expanded. Empty when the config names none.
    pub identity_files: Vec<PathBuf>,
}

impl SshConfigFile {
    pub fn load(path: &Path) -> Self {
        let Ok(text) = std::fs::read_to_string(path) else {
            return Self::default();
        };
        Self::parse(&text)
    }

    pub fn parse(text: &str) -> Self {
        let text = strip_match_blocks(text);
        let rules = ParseRule::ALLOW_UNKNOWN_FIELDS | ParseRule::ALLOW_UNSUPPORTED_FIELDS;
        let config = SshConfig::default().parse(&mut Cursor::new(text), rules).ok();
        SshConfigFile { config }
    }

    /// Every `Host` name that is not a pattern (no `*`, `?` or leading `!`), in file order, once each.
    pub fn list_hosts(&self) -> Vec<String> {
        let mut names: Vec<String> = Vec::new();
        let Some(config) = &self.config else {
            return names;
        };
        for host in config.get_hosts() {
            for clause in &host.pattern {
                let p = &clause.pattern;
                if clause.negated || p.is_empty() || p.contains(['*', '?', '!']) {
                    continue;
                }
                if !names.contains(p) {
                    names.push(p.clone());
                }
            }
        }
        names
    }

    pub fn resolve(&self, target: &Target) -> Resolved {
        let params = self.config.as_ref().map(|c| c.query(&target.host));
        let from_cfg = |f: fn(&ssh2_config::HostParams) -> Option<String>| params.as_ref().and_then(f);
        let user = target
            .user
            .clone()
            .or_else(|| from_cfg(|p| p.user.clone()))
            .unwrap_or_else(local_user);
        let hostname = from_cfg(|p| p.host_name.clone()).unwrap_or_else(|| target.host.clone());
        let port = target.port.or_else(|| params.as_ref().and_then(|p| p.port)).unwrap_or(DEFAULT_PORT);
        let identity_files = params
            .as_ref()
            .and_then(|p| p.identity_file.clone())
            .unwrap_or_default()
            .into_iter()
            .map(expand_tilde)
            .collect();
        Resolved { user, alias: target.host.clone(), hostname, port, identity_files }
    }
}

/// Drops each `Match` line and the settings under it, up to the next `Host` line.
fn strip_match_blocks(text: &str) -> String {
    let mut skipping = false;
    let mut out = String::with_capacity(text.len());
    for line in text.lines() {
        let word = line.trim_start().split(|c: char| c.is_whitespace() || c == '=').next().unwrap_or("");
        if word.eq_ignore_ascii_case("match") {
            skipping = true;
        } else if word.eq_ignore_ascii_case("host") {
            skipping = false;
        }
        if !skipping {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

fn expand_tilde(p: PathBuf) -> PathBuf {
    if let Ok(rest) = p.strip_prefix("~") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    p
}

/// The local account name, the fallback when neither the user nor the config gives one.
pub fn local_user() -> String {
    ["USER", "USERNAME", "LOGNAME"]
        .iter()
        .find_map(|v| std::env::var(v).ok().filter(|s| !s.is_empty()))
        .unwrap_or_else(|| "user".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
Host nas
    HostName 192.168.1.20
    User admin
    Port 2222
    IdentityFile ~/.ssh/nas_key
    IdentityFile /keys/second

Host work-*
    User jack

Host *.corp !skip.corp
    User corp

Host dev staging
    HostName build.example.com

Match host nas
    User sneaky

Host last
    HostName last.example.com

Host *
    User fallback
";

    fn target(s: &str) -> Target {
        Target::parse(s).unwrap()
    }

    #[test]
    fn alias_resolves_to_its_settings() {
        let cfg = SshConfigFile::parse(SAMPLE);
        let r = cfg.resolve(&target("nas"));
        assert_eq!(r.alias, "nas");
        assert_eq!(r.hostname, "192.168.1.20");
        assert_eq!(r.user, "admin");
        assert_eq!(r.port, 2222);
        assert_eq!(r.identity_files.len(), 2);
        assert!(r.identity_files[0].ends_with(".ssh/nas_key"));
        assert!(!r.identity_files[0].starts_with("~"));
        assert_eq!(r.identity_files[1], PathBuf::from("/keys/second"));
    }

    #[test]
    fn typed_user_and_port_beat_the_config() {
        let cfg = SshConfigFile::parse(SAMPLE);
        let r = cfg.resolve(&target("bob@nas:22"));
        assert_eq!((r.user.as_str(), r.port), ("bob", 22));
        assert_eq!(r.hostname, "192.168.1.20");
    }

    #[test]
    fn wildcard_blocks_apply_but_are_not_listed() {
        let cfg = SshConfigFile::parse(SAMPLE);
        assert_eq!(cfg.resolve(&target("work-box")).user, "jack");
        assert_eq!(cfg.resolve(&target("elsewhere")).user, "fallback");
        assert_eq!(cfg.resolve(&target("elsewhere")).hostname, "elsewhere");
        assert_eq!(cfg.resolve(&target("elsewhere")).port, 22);
        assert_eq!(cfg.list_hosts(), ["nas", "dev", "staging", "last"]);
    }

    #[test]
    fn match_blocks_are_ignored() {
        let cfg = SshConfigFile::parse(SAMPLE);
        assert_eq!(cfg.resolve(&target("nas")).user, "admin");
        assert_eq!(cfg.resolve(&target("last")).hostname, "last.example.com");
    }

    #[test]
    fn missing_file_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = SshConfigFile::load(&dir.path().join("config"));
        assert!(cfg.list_hosts().is_empty());
        let r = cfg.resolve(&target("nas"));
        assert_eq!((r.hostname.as_str(), r.port), ("nas", 22));
        assert_eq!(r.user, local_user());
        assert!(r.identity_files.is_empty());
    }

    #[test]
    fn unreadable_garbage_is_empty() {
        let cfg = SshConfigFile::parse("Host\n  Port notanumber\n");
        assert!(cfg.list_hosts().is_empty());
    }

    #[test]
    fn load_reads_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config");
        std::fs::write(&path, SAMPLE).unwrap();
        assert_eq!(SshConfigFile::load(&path).list_hosts().len(), 4);
    }

    #[test]
    fn host_names_are_lower_cased_when_resolved() {
        let cfg = SshConfigFile::parse("Host nas\n  User admin\n");
        assert_eq!(cfg.resolve(&target("NAS")).user, "admin");
    }

    #[test]
    fn proxy_jump_is_ignored() {
        let cfg = SshConfigFile::parse("Host inner\n  HostName 10.0.0.2\n  ProxyJump bastion\n");
        let r = cfg.resolve(&target("inner"));
        assert_eq!(r.hostname, "10.0.0.2");
    }
}
