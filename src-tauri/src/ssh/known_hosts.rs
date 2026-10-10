//! `~/.ssh/known_hosts`: check a server key, and append one line when the user trusts a host.
//!
//! Plain entries, `[host]:port` entries for non-22 ports, patterns with `*`, `?` and `!`, and
//! hashed `|1|salt|hash` entries are understood. Lines this code cannot read (markers such as
//! `@cert-authority` or `@revoked`, key types it does not know) are ignored, never fatal.

use base64::{engine::general_purpose::STANDARD, Engine};
use hmac::{Hmac, KeyInit, Mac};
use russh::keys::ssh_key::{HashAlg, PublicKey};
use sha1::Sha1;
use std::io::Write;
use std::path::Path;

#[derive(Debug, PartialEq, Eq)]
pub enum HostKeyStatus {
    /// An entry for this host has this key.
    Known,
    /// No entry for this host has a key of this type.
    Unknown,
    /// An entry for this host has a different key of the same type: a hard stop.
    Changed { line: usize, known_line: String },
}

/// The name `known_hosts` files an entry under: `host`, or `[host]:port` when the port is not 22.
fn host_token(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

fn hash_matches(entry: &str, token: &str) -> bool {
    let mut parts = entry.split('|').skip(2);
    let (Some(salt), Some(hash)) = (parts.next(), parts.next()) else {
        return false;
    };
    let (Ok(salt), Ok(hash)) = (STANDARD.decode(salt), STANDARD.decode(hash)) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha1>::new_from_slice(&salt) else {
        return false;
    };
    mac.update(token.as_bytes());
    mac.verify_slice(&hash).is_ok()
}

/// `*` and `?` wildcards, as in OpenSSH host patterns.
fn glob(pattern: &[u8], text: &[u8]) -> bool {
    match pattern.split_first() {
        None => text.is_empty(),
        Some((b'*', rest)) => (0..=text.len()).any(|i| glob(rest, &text[i..])),
        Some((b'?', rest)) => !text.is_empty() && glob(rest, &text[1..]),
        Some((c, rest)) => text.first().is_some_and(|t| t.eq_ignore_ascii_case(c)) && glob(rest, &text[1..]),
    }
}

fn hosts_field_matches(field: &str, token: &str) -> bool {
    let mut matched = false;
    for entry in field.split(',') {
        if entry.starts_with("|1|") {
            matched |= hash_matches(entry, token);
        } else if let Some(negated) = entry.strip_prefix('!') {
            if glob(negated.as_bytes(), token.as_bytes()) {
                return false;
            }
        } else if glob(entry.as_bytes(), token.as_bytes()) {
            matched = true;
        }
    }
    matched
}

pub fn check(path: &Path, host: &str, port: u16, key: &PublicKey) -> HostKeyStatus {
    let Ok(text) = std::fs::read_to_string(path) else {
        return HostKeyStatus::Unknown;
    };
    let token = host_token(&host.to_lowercase(), port);
    let mut known = false;
    for (i, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('@') {
            continue;
        }
        let mut fields = line.split_whitespace();
        let (Some(hosts), Some(_algo), Some(b64)) = (fields.next(), fields.next(), fields.next()) else {
            continue;
        };
        if !hosts_field_matches(hosts, &token) {
            continue;
        }
        let Ok(recorded) = PublicKey::from_openssh(&format!("{} {}", _algo, b64)) else {
            continue;
        };
        if recorded.algorithm() != key.algorithm() {
            continue;
        }
        if recorded.key_data() == key.key_data() {
            known = true;
        } else {
            return HostKeyStatus::Changed { line: i + 1, known_line: line.to_string() };
        }
    }
    if known {
        HostKeyStatus::Known
    } else {
        HostKeyStatus::Unknown
    }
}

/// `SHA256:…` fingerprint, as `ssh-keygen -l` prints it.
pub fn fingerprint(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

/// The key type as OpenSSH names it, e.g. `ssh-ed25519`.
pub fn key_type(key: &PublicKey) -> String {
    key.algorithm().to_string()
}

/// Appends exactly one line, `host key-type base64` (`[host]:port` for other ports), creating the
/// file and its folder when missing. A last line without a newline is finished first.
pub fn append(path: &Path, host: &str, port: u16, key: &PublicKey) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
        #[cfg(unix)]
        if !dir.as_os_str().is_empty() && !path.exists() {
            use std::os::unix::fs::PermissionsExt;
            // Only tighten a folder we may just have created; ignore failures.
            if dir.file_name().is_some_and(|n| n == ".ssh") {
                let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
            }
        }
    }
    let existing = std::fs::read(path).unwrap_or_default();
    let mut line = String::new();
    if !existing.is_empty() && !existing.ends_with(b"\n") {
        line.push('\n');
    }
    let openssh = key.to_openssh().map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
    // `to_openssh` yields "type base64 [comment]"; known_hosts takes the first two fields.
    let mut fields = openssh.split_whitespace();
    let (algo, b64) = (fields.next().unwrap_or_default(), fields.next().unwrap_or_default());
    line.push_str(&format!("{} {algo} {b64}\n", host_token(&host.to_lowercase(), port)));
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(line.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::keys::ssh_key::{Algorithm, PrivateKey};

    fn key() -> PublicKey {
        PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap().public_key().clone()
    }

    fn line(host: &str, k: &PublicKey) -> String {
        let o = k.to_openssh().unwrap();
        let mut f = o.split_whitespace();
        format!("{host} {} {}", f.next().unwrap(), f.next().unwrap())
    }

    fn hashed(host: &str, k: &PublicKey) -> String {
        let salt = [7u8; 20];
        let mut mac = Hmac::<Sha1>::new_from_slice(&salt).unwrap();
        mac.update(host.as_bytes());
        let h = mac.finalize().into_bytes();
        let l = line("x", k);
        let rest = l.split_once(' ').unwrap().1;
        format!("|1|{}|{} {rest}", STANDARD.encode(salt), STANDARD.encode(h))
    }

    fn file(content: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("known_hosts");
        std::fs::write(&p, content).unwrap();
        (dir, p)
    }

    #[test]
    fn missing_file_means_unknown() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(check(&dir.path().join("nope"), "nas", 22, &key()), HostKeyStatus::Unknown);
    }

    #[test]
    fn plain_entry_is_known() {
        let k = key();
        let (_d, p) = file(&format!("# comment\n\n{}\n", line("nas,10.0.0.5", &k)));
        assert_eq!(check(&p, "nas", 22, &k), HostKeyStatus::Known);
        assert_eq!(check(&p, "NAS", 22, &k), HostKeyStatus::Known);
        assert_eq!(check(&p, "other", 22, &k), HostKeyStatus::Unknown);
    }

    #[test]
    fn non_default_ports_use_brackets() {
        let k = key();
        let (_d, p) = file(&format!("{}\n", line("[nas]:2222", &k)));
        assert_eq!(check(&p, "nas", 2222, &k), HostKeyStatus::Known);
        assert_eq!(check(&p, "nas", 22, &k), HostKeyStatus::Unknown);
        assert_eq!(check(&p, "nas", 2223, &k), HostKeyStatus::Unknown);
    }

    #[test]
    fn hashed_entries_match() {
        let k = key();
        let (_d, p) = file(&format!("{}\n{}\n", hashed("nas", &k), hashed("[nas]:2200", &k)));
        assert_eq!(check(&p, "nas", 22, &k), HostKeyStatus::Known);
        assert_eq!(check(&p, "nas", 2200, &k), HostKeyStatus::Known);
        assert_eq!(check(&p, "nas2", 22, &k), HostKeyStatus::Unknown);
    }

    #[test]
    fn a_different_key_of_the_same_type_is_changed() {
        let (old, new) = (key(), key());
        let entry = line("nas", &old);
        let (_d, p) = file(&format!("# first\n{entry}\n"));
        assert_eq!(check(&p, "nas", 22, &new), HostKeyStatus::Changed { line: 2, known_line: entry });
    }

    #[test]
    fn a_hashed_entry_can_report_changed() {
        let (old, new) = (key(), key());
        let (_d, p) = file(&format!("{}\n", hashed("nas", &old)));
        assert!(matches!(check(&p, "nas", 22, &new), HostKeyStatus::Changed { line: 1, .. }));
    }

    #[test]
    fn a_key_of_another_type_is_unknown_not_changed() {
        let ecdsa = PrivateKey::random(&mut rand::rng(), Algorithm::Ecdsa { curve: russh::keys::ssh_key::EcdsaCurve::NistP256 })
            .unwrap()
            .public_key()
            .clone();
        let (_d, p) = file(&format!("{}\n", line("nas", &ecdsa)));
        assert_eq!(check(&p, "nas", 22, &key()), HostKeyStatus::Unknown);
    }

    #[test]
    fn wildcards_negation_and_markers() {
        let k = key();
        let (_d, p) = file(&format!(
            "@revoked nas {}\n@cert-authority *.lan ssh-ed25519 AAAA\n{}\n",
            line("x", &key()).split_once(' ').unwrap().1,
            line("*.corp,!bad.corp", &k)
        ));
        assert_eq!(check(&p, "a.corp", 22, &k), HostKeyStatus::Known);
        assert_eq!(check(&p, "bad.corp", 22, &k), HostKeyStatus::Unknown);
        assert_eq!(check(&p, "nas", 22, &k), HostKeyStatus::Unknown);
    }

    #[test]
    fn unreadable_lines_are_skipped() {
        let k = key();
        let (_d, p) = file(&format!("nas ssh-ed25519 !!!notbase64\njust-one-field\n{}\n", line("nas", &k)));
        assert_eq!(check(&p, "nas", 22, &k), HostKeyStatus::Known);
    }

    #[test]
    fn append_writes_exactly_one_line() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(".ssh").join("known_hosts");
        let k = key();
        append(&p, "NAS", 22, &k).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        assert_eq!(text, format!("{}\n", line("nas", &k)));
        assert_eq!(check(&p, "nas", 22, &k), HostKeyStatus::Known);
    }

    #[test]
    fn append_uses_brackets_and_finishes_an_unterminated_line() {
        let (a, b) = (key(), key());
        let (_d, p) = file(&line("old", &a));
        append(&p, "nas", 2222, &b).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        assert_eq!(text, format!("{}\n{}\n", line("old", &a), line("[nas]:2222", &b)));
        assert_eq!(text.lines().count(), 2);
    }

    #[test]
    fn fingerprint_is_sha256() {
        let f = fingerprint(&key());
        assert!(f.starts_with("SHA256:"), "{f}");
        assert!(!f.contains('='));
    }
}
