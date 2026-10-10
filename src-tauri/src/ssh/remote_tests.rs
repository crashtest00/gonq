//! Remote file commands against the in-process SFTP server (real files in a temp folder).

use super::fs::{self, Remote, RemoteError, RemoteStat, WriteOutcome};
use super::tests::{fixture, is_connected, none, write_key, Fixture, Setup};
use super::test_server::{new_key, Policy, TestServer};
use super::uri::RemotePath;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime};

struct R {
    f: Fixture,
    remote: Remote,
    /// The folder the user "picked" (and the server's home).
    home: PathBuf,
}

impl R {
    fn uri(&self, path: impl AsRef<Path>) -> String {
        RemotePath { key: self.f.key(), path: path.as_ref().to_string_lossy().into_owned() }.to_string()
    }
    fn at(&self, rel: &str) -> PathBuf {
        self.home.join(rel)
    }
    fn put(&self, rel: &str, text: &str) -> PathBuf {
        let p = self.at(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, text).unwrap();
        p
    }
    fn stat_on_disk(&self, rel: &str) -> RemoteStat {
        let m = std::fs::metadata(self.at(rel)).unwrap();
        RemoteStat { mtime: m.mtime() as u32, size: m.len() }
    }
    async fn read(&self, rel: &str) -> Result<(RemoteStat, Vec<u8>), RemoteError> {
        fs::read(&self.f.pool, &self.remote, &self.uri(self.at(rel))).await
    }
    async fn list(&self, rel: &str) -> Result<Vec<fs_entry::Entry>, RemoteError> {
        let path = if rel.is_empty() { self.home.clone() } else { self.at(rel) };
        fs::list_directory(&self.f.pool, &self.remote, &self.uri(path)).await
    }
    async fn save(&self, rel: &str, text: &str, expected: RemoteStat, force: bool) -> Result<WriteOutcome, RemoteError> {
        fs::write(&self.f.pool, &self.remote, &self.uri(self.at(rel)), text, expected, force).await
    }
    fn names_in(&self, rel: &str) -> Vec<String> {
        let mut v: Vec<String> =
            std::fs::read_dir(self.at(rel)).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }
}

mod fs_entry {
    pub use crate::folder::FolderEntry as Entry;
}

async fn setup_with(extra: impl FnOnce(&mut Setup)) -> R {
    let client = new_key();
    let mut s = Setup { allowed: vec![client.public_key().clone()], trusted: true, ..Default::default() };
    extra(&mut s);
    let f = fixture(s).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &client);
    let home = f.dir.path().join("home").canonicalize().unwrap();
    let r = R { f, remote: Remote::default(), home };
    assert!(is_connected(&r.f.connect(none()).await));
    fs::open_root(&r.f.pool, &r.remote, &r.uri(&r.home)).await.unwrap();
    r
}

async fn setup() -> R {
    setup_with(|_| {}).await
}

fn saved(o: Result<WriteOutcome, RemoteError>) -> (RemoteStat, bool, bool) {
    match o.unwrap() {
        WriteOutcome::Saved { stat, in_place, warn } => (stat, in_place, warn),
        other => panic!("expected a save, got {other:?}"),
    }
}

fn bump_mtime(path: &Path, secs: u64) {
    let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
    file.set_modified(SystemTime::now() + Duration::from_secs(secs)).unwrap();
}

// ---- listing ---------------------------------------------------------------------------------

#[tokio::test]
async fn the_listing_has_the_local_filter_and_order() {
    let r = setup().await;
    for f in ["b.md", "A.md", "c.txt", ".hidden.md", "noext", "d.MARKDOWN"] {
        r.put(f, "x");
    }
    for d in ["zeta", "Alpha", "beta", ".git"] {
        std::fs::create_dir(r.at(d)).unwrap();
    }
    let rows = r.list("").await.unwrap();
    let names: Vec<_> = rows.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["Alpha", "beta", "zeta", "A.md", "b.md", "d.MARKDOWN"]);
    assert!(rows[0].is_dir && !rows[3].is_dir);
    assert_eq!(rows[3].path, r.uri(r.at("A.md")), "rows carry ssh:// addresses");
    let sub = r.list("beta").await.unwrap();
    assert!(sub.is_empty());
}

#[tokio::test]
async fn a_linked_folder_is_a_folder_and_a_broken_link_is_skipped() {
    let r = setup().await;
    std::fs::create_dir(r.at("real")).unwrap();
    std::os::unix::fs::symlink(r.at("real"), r.at("link")).unwrap();
    std::os::unix::fs::symlink(r.at("nowhere"), r.at("broken.md")).unwrap();
    let rows = r.list("").await.unwrap();
    let got: Vec<_> = rows.iter().map(|e| (e.name.as_str(), e.is_dir)).collect();
    assert_eq!(got, [("link", true), ("real", true)]);
}

#[tokio::test]
async fn listing_errors_are_typed() {
    let r = setup().await;
    r.put("a.md", "x");
    assert!(matches!(r.list("nope").await, Err(RemoteError::NotFound(_))));
    assert!(matches!(r.list("a.md").await, Err(RemoteError::NotAFolder(_))));
    std::fs::create_dir(r.at("locked")).unwrap();
    std::fs::set_permissions(r.at("locked"), std::fs::Permissions::from_mode(0o000)).unwrap();
    let got = r.list("locked").await;
    std::fs::set_permissions(r.at("locked"), std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(matches!(got, Err(RemoteError::PermissionDenied(_))), "{got:?}");
}

#[tokio::test]
async fn thousands_of_entries_list() {
    let r = setup().await;
    for i in 0..1500 {
        r.put(&format!("n{i}.md"), "");
    }
    assert_eq!(r.list("").await.unwrap().len(), 1500);
}

// ---- the folder picker -------------------------------------------------------------------------

#[tokio::test]
async fn list_folders_returns_folders_only_and_works_outside_any_root() {
    let r = setup().await;
    let elsewhere = r.f.dir.path().join("elsewhere").canonicalize().unwrap_or_else(|_| r.f.dir.path().join("elsewhere"));
    std::fs::create_dir_all(elsewhere.join("Beta")).unwrap();
    std::fs::create_dir_all(elsewhere.join("alpha")).unwrap();
    std::fs::create_dir_all(elsewhere.join(".hidden")).unwrap();
    std::fs::write(elsewhere.join("secret.md"), "x").unwrap();
    std::fs::write(elsewhere.join("notes.txt"), "x").unwrap();

    let listing = fs::list_folders(&r.f.pool, &r.uri(&elsewhere)).await.unwrap();
    assert_eq!(listing.folders, ["alpha", "Beta"]);
    assert_eq!(listing.uri, r.uri(elsewhere.canonicalize().unwrap()));
    // It grants nothing: the same folder is still closed to the other commands.
    assert!(matches!(
        fs::list_directory(&r.f.pool, &r.remote, &r.uri(&elsewhere)).await,
        Err(RemoteError::NotAllowed(_))
    ));
}

#[tokio::test]
async fn list_folders_resolves_the_home_shortcut() {
    let r = setup().await;
    std::fs::create_dir(r.at("docs")).unwrap();
    let uri = format!("ssh://{}/~", r.f.key().authority());
    let listing = fs::list_folders(&r.f.pool, &uri).await.unwrap();
    assert_eq!(listing.folders, ["docs"]);
    assert_eq!(listing.uri, r.uri(&r.home));
}

#[tokio::test]
async fn list_folders_on_a_file_or_missing_folder_is_typed() {
    let r = setup().await;
    r.put("a.md", "x");
    assert!(matches!(fs::list_folders(&r.f.pool, &r.uri(r.at("a.md"))).await, Err(RemoteError::NotAFolder(_))));
    assert!(matches!(fs::list_folders(&r.f.pool, &r.uri(r.at("zip"))).await, Err(RemoteError::NotFound(_))));
}

// ---- reading -----------------------------------------------------------------------------------

#[tokio::test]
async fn read_returns_the_exact_bytes_with_bom_and_crlf() {
    let r = setup().await;
    let text = "\u{feff}# T\r\nline\r\n\r\nlast no newline";
    r.put("a.md", text);
    let (stat, bytes) = r.read("a.md").await.unwrap();
    assert_eq!(bytes, text.as_bytes());
    assert_eq!(stat, r.stat_on_disk("a.md"));
    assert_eq!(stat.size, text.len() as u64);
}

#[tokio::test]
async fn read_returns_non_utf8_bytes_untouched() {
    let r = setup().await;
    std::fs::write(r.at("latin.md"), [b'a', 0xE9, b'\n']).unwrap();
    assert_eq!(r.read("latin.md").await.unwrap().1, vec![b'a', 0xE9, b'\n']);
}

#[tokio::test]
async fn read_a_large_file_in_full() {
    let r = setup().await;
    let big = "0123456789abcdef".repeat(200_000);
    r.put("big.md", &big);
    assert_eq!(r.read("big.md").await.unwrap().1, big.as_bytes());
}

#[tokio::test]
async fn read_errors_are_typed() {
    let r = setup().await;
    std::fs::create_dir(r.at("dir.md")).unwrap();
    r.put("secret.md", "x");
    std::fs::set_permissions(r.at("secret.md"), std::fs::Permissions::from_mode(0o000)).unwrap();
    assert!(matches!(r.read("missing.md").await, Err(RemoteError::NotFound(_))));
    assert!(matches!(r.read("secret.md").await, Err(RemoteError::PermissionDenied(_))));
    assert!(matches!(r.read("dir.md").await, Err(RemoteError::Io(_))));
    std::fs::set_permissions(r.at("secret.md"), std::fs::Permissions::from_mode(0o644)).unwrap();
}

#[tokio::test]
async fn read_follows_a_link_that_stays_inside_the_folder() {
    let r = setup().await;
    r.put("real.md", "inside");
    std::os::unix::fs::symlink(r.at("real.md"), r.at("alias.md")).unwrap();
    assert_eq!(r.read("alias.md").await.unwrap().1, b"inside");
}

#[test]
fn the_read_payload_is_mtime_size_then_the_bytes() {
    let out = super::read_payload(RemoteStat { mtime: 0x01020304, size: 5 }, b"hello".to_vec());
    assert_eq!(&out[..4], [1, 2, 3, 4]);
    assert_eq!(&out[4..12], [0, 0, 0, 0, 0, 0, 0, 5]);
    assert_eq!(&out[12..], b"hello");
}

// ---- the allow-list ----------------------------------------------------------------------------

#[tokio::test]
async fn nothing_is_reachable_before_a_folder_is_opened() {
    let r = setup().await;
    r.put("a.md", "x");
    let closed = Remote::default();
    let uri = r.uri(r.at("a.md"));
    assert!(matches!(fs::read(&r.f.pool, &closed, &uri).await, Err(RemoteError::NotAllowed(_))));
    assert!(matches!(fs::list_directory(&r.f.pool, &closed, &r.uri(&r.home)).await, Err(RemoteError::NotAllowed(_))));
    let stat = RemoteStat { mtime: 0, size: 0 };
    assert!(matches!(fs::write(&r.f.pool, &closed, &uri, "y", stat, true).await, Err(RemoteError::NotAllowed(_))));
    assert_eq!(std::fs::read_to_string(r.at("a.md")).unwrap(), "x");
}

#[tokio::test]
async fn paths_outside_the_folder_are_refused_including_dot_dot() {
    let r = setup().await;
    let outside = r.f.dir.path().join("outside.md");
    std::fs::write(&outside, "private").unwrap();
    r.put("sub/ok.md", "ok");
    std::fs::create_dir(r.f.dir.path().join("home2")).unwrap();
    std::fs::write(r.f.dir.path().join("home2/near.md"), "near").unwrap();

    let escape = format!("{}/sub/../../outside.md", r.home.display());
    let uri = r.uri(&escape);
    assert!(matches!(fs::read(&r.f.pool, &r.remote, &uri).await, Err(RemoteError::NotAllowed(_))));
    let sibling = r.uri(r.f.dir.path().join("home2/near.md"));
    assert!(matches!(fs::read(&r.f.pool, &r.remote, &sibling).await, Err(RemoteError::NotAllowed(_))), "a longer name is not inside");
    let parent = r.uri(r.f.dir.path());
    assert!(matches!(fs::list_directory(&r.f.pool, &r.remote, &parent).await, Err(RemoteError::NotAllowed(_))));
    let inside = format!("{}/sub/../sub/ok.md", r.home.display());
    assert_eq!(fs::read(&r.f.pool, &r.remote, &r.uri(&inside)).await.unwrap().1, b"ok");
    let stat = RemoteStat { mtime: 0, size: 0 };
    assert!(matches!(fs::write(&r.f.pool, &r.remote, &uri, "x", stat, true).await, Err(RemoteError::NotAllowed(_))));
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "private");
}

#[tokio::test]
async fn a_link_that_leads_out_of_the_folder_is_refused() {
    let r = setup().await;
    let outside = r.f.dir.path().join("outside.md");
    std::fs::write(&outside, "private").unwrap();
    std::os::unix::fs::symlink(&outside, r.at("leak.md")).unwrap();
    std::os::unix::fs::symlink(r.f.dir.path(), r.at("updir")).unwrap();
    assert!(matches!(r.read("leak.md").await, Err(RemoteError::NotAllowed(_))));
    assert!(matches!(r.list("updir").await, Err(RemoteError::NotAllowed(_))));
    let stat = r.stat_on_disk("leak.md");
    assert!(matches!(r.save("leak.md", "x", stat, true).await, Err(RemoteError::NotAllowed(_))));
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "private");
}

#[tokio::test]
async fn a_folder_reached_through_a_link_is_usable() {
    let r = setup().await;
    let real = r.f.dir.path().join("realplace");
    std::fs::create_dir(&real).unwrap();
    std::fs::write(real.join("a.md"), "via link").unwrap();
    std::os::unix::fs::symlink(&real, r.at("linked")).unwrap();
    let other = Remote::default();
    fs::open_root(&r.f.pool, &other, &r.uri(r.at("linked"))).await.unwrap();
    let got = fs::read(&r.f.pool, &other, &r.uri(r.at("linked/a.md"))).await.unwrap();
    assert_eq!(got.1, b"via link");
}

#[tokio::test]
async fn open_root_needs_an_existing_folder() {
    let r = setup().await;
    r.put("a.md", "x");
    let other = Remote::default();
    assert!(matches!(fs::open_root(&r.f.pool, &other, &r.uri(r.at("a.md"))).await, Err(RemoteError::NotAFolder(_))));
    assert!(matches!(fs::open_root(&r.f.pool, &other, &r.uri(r.at("gone"))).await, Err(RemoteError::NotFound(_))));
    assert!(matches!(fs::read(&r.f.pool, &other, &r.uri(r.at("a.md"))).await, Err(RemoteError::NotAllowed(_))));
}

#[tokio::test]
async fn a_recent_file_grants_that_file_only() {
    let r = setup().await;
    r.put("a.md", "mine");
    r.put("b.md", "not granted");
    let fresh = Remote::default();
    super::allow_recent(&fresh, &r.uri(r.at("a.md"))).unwrap();
    assert_eq!(fs::read(&r.f.pool, &fresh, &r.uri(r.at("a.md"))).await.unwrap().1, b"mine");
    assert!(matches!(fs::read(&r.f.pool, &fresh, &r.uri(r.at("b.md"))).await, Err(RemoteError::NotAllowed(_))));
    assert!(matches!(fs::list_directory(&r.f.pool, &fresh, &r.uri(&r.home)).await, Err(RemoteError::NotAllowed(_))));
    assert!(super::allow_recent(&fresh, "ssh://me@nas/~/a.md").is_err());
}

#[tokio::test]
async fn disconnecting_takes_the_grants_back() {
    let r = setup().await;
    r.put("a.md", "x");
    assert!(r.read("a.md").await.is_ok());
    r.remote.allow.revoke(&r.f.key());
    r.f.pool.disconnect(&r.f.key()).await;
    assert!(matches!(r.read("a.md").await, Err(RemoteError::NotAllowed(_))));
}

#[tokio::test]
async fn exists_answers_for_granted_and_recorded_paths_only() {
    let r = setup().await;
    r.put("a.md", "x");
    let outside = r.f.dir.path().join("o.md");
    std::fs::write(&outside, "x").unwrap();
    assert!(fs::exists(&r.f.pool, &r.remote, &r.uri(r.at("a.md")), false).await);
    assert!(!fs::exists(&r.f.pool, &r.remote, &r.uri(r.at("gone.md")), false).await);
    assert!(!fs::exists(&r.f.pool, &r.remote, &r.uri(&outside), false).await, "not granted");
    assert!(fs::exists(&r.f.pool, &r.remote, &r.uri(&outside), true).await, "a recent entry may be asked about");
    assert!(!fs::exists(&r.f.pool, &r.remote, "not a uri", true).await);
}

// ---- saving ------------------------------------------------------------------------------------

#[tokio::test]
async fn save_replaces_the_file_atomically_and_returns_the_new_stat() {
    let r = setup().await;
    r.put("a.md", "old");
    std::fs::set_permissions(r.at("a.md"), std::fs::Permissions::from_mode(0o600)).unwrap();
    let before = r.stat_on_disk("a.md");
    let ino = std::fs::metadata(r.at("a.md")).unwrap().ino();

    let text = "\u{feff}new\r\ntext é\r\n";
    let (stat, in_place, warn) = saved(r.save("a.md", text, before, false).await);
    assert!(!in_place && !warn);
    assert_eq!(std::fs::read(r.at("a.md")).unwrap(), text.as_bytes(), "written exactly as held");
    assert_eq!(stat, r.stat_on_disk("a.md"));
    assert_ne!(std::fs::metadata(r.at("a.md")).unwrap().ino(), ino, "a new file was renamed into place");
    assert_eq!(std::fs::metadata(r.at("a.md")).unwrap().mode() & 0o7777, 0o600, "permission bits kept");
    assert_eq!(r.names_in(""), ["a.md"], "no temporary file left");
}

#[tokio::test]
async fn saving_twice_in_a_row_uses_the_returned_stat() {
    let r = setup().await;
    r.put("a.md", "one");
    let (s1, ..) = saved(r.save("a.md", "two", r.stat_on_disk("a.md"), false).await);
    let (s2, ..) = saved(r.save("a.md", "three!", s1, false).await);
    assert_eq!(std::fs::read_to_string(r.at("a.md")).unwrap(), "three!");
    assert_eq!(s2.size, 6);
}

#[tokio::test]
async fn a_changed_size_is_a_conflict_and_nothing_is_written() {
    let r = setup().await;
    r.put("a.md", "opened");
    let seen = r.stat_on_disk("a.md");
    std::fs::write(r.at("a.md"), "changed on the server").unwrap();
    let out = r.save("a.md", "mine", seen, false).await.unwrap();
    assert!(matches!(out, WriteOutcome::Conflict { deleted: false, current: Some(c) } if c.size == 21), "{out:?}");
    assert_eq!(std::fs::read_to_string(r.at("a.md")).unwrap(), "changed on the server");
    assert_eq!(r.names_in(""), ["a.md"]);
}

#[tokio::test]
async fn a_changed_mtime_with_the_same_size_is_a_conflict() {
    let r = setup().await;
    r.put("a.md", "abcd");
    let seen = r.stat_on_disk("a.md");
    std::fs::write(r.at("a.md"), "wxyz").unwrap();
    bump_mtime(&r.at("a.md"), 30);
    let out = r.save("a.md", "mine", seen, false).await.unwrap();
    assert!(matches!(out, WriteOutcome::Conflict { deleted: false, .. }), "{out:?}");
    assert_eq!(std::fs::read_to_string(r.at("a.md")).unwrap(), "wxyz");
}

#[tokio::test]
async fn a_deleted_file_is_a_conflict_and_force_recreates_it() {
    let r = setup().await;
    r.put("a.md", "x");
    let seen = r.stat_on_disk("a.md");
    std::fs::remove_file(r.at("a.md")).unwrap();
    let out = r.save("a.md", "mine", seen, false).await.unwrap();
    assert_eq!(out, WriteOutcome::Conflict { deleted: true, current: None });
    assert!(!r.at("a.md").exists());
    let (stat, ..) = saved(r.save("a.md", "mine", seen, true).await);
    assert_eq!(std::fs::read_to_string(r.at("a.md")).unwrap(), "mine");
    assert_eq!(stat.size, 4);
}

#[tokio::test]
async fn force_overwrites_a_changed_file() {
    let r = setup().await;
    r.put("a.md", "opened");
    let seen = r.stat_on_disk("a.md");
    std::fs::write(r.at("a.md"), "theirs, longer").unwrap();
    saved(r.save("a.md", "mine", seen, true).await);
    assert_eq!(std::fs::read_to_string(r.at("a.md")).unwrap(), "mine");
}

#[tokio::test]
async fn without_posix_rename_the_file_is_written_in_place_and_the_user_is_warned_once() {
    let r = setup_with(|s| s.no_posix_rename = true).await;
    r.put("a.md", "old");
    let ino = std::fs::metadata(r.at("a.md")).unwrap().ino();
    let (s1, in_place, warn) = saved(r.save("a.md", "first", r.stat_on_disk("a.md"), false).await);
    assert!(in_place && warn);
    assert_eq!(std::fs::read_to_string(r.at("a.md")).unwrap(), "first");
    assert_eq!(std::fs::metadata(r.at("a.md")).unwrap().ino(), ino, "same file, truncated and written");
    let (_, in_place, warn) = saved(r.save("a.md", "second", s1, false).await);
    assert!(in_place && !warn, "the warning is once per host");
    assert_eq!(r.names_in(""), ["a.md"]);
}

#[tokio::test]
async fn without_fsync_the_atomic_save_still_works() {
    let r = setup_with(|s| s.no_fsync = true).await;
    r.put("a.md", "old");
    let (_, in_place, _) = saved(r.save("a.md", "new", r.stat_on_disk("a.md"), false).await);
    assert!(!in_place);
    assert_eq!(std::fs::read_to_string(r.at("a.md")).unwrap(), "new");
}

#[tokio::test]
async fn a_folder_that_is_not_writable_falls_back_to_writing_in_place() {
    let r = setup().await;
    r.put("ro/a.md", "old");
    let seen = r.stat_on_disk("ro/a.md");
    std::fs::set_permissions(r.at("ro"), std::fs::Permissions::from_mode(0o555)).unwrap();
    let out = r.save("ro/a.md", "new", seen, false).await;
    std::fs::set_permissions(r.at("ro"), std::fs::Permissions::from_mode(0o755)).unwrap();
    let (_, in_place, warn) = saved(out);
    assert!(in_place && warn);
    assert_eq!(std::fs::read_to_string(r.at("ro/a.md")).unwrap(), "new");
}

#[tokio::test]
async fn a_read_only_file_is_a_permission_error_and_stays_as_it_was() {
    let r = setup().await;
    r.put("a.md", "old");
    std::fs::set_permissions(r.at("a.md"), std::fs::Permissions::from_mode(0o444)).unwrap();
    std::fs::set_permissions(&r.home, std::fs::Permissions::from_mode(0o555)).unwrap();
    let out = r.save("a.md", "new", r.stat_on_disk("a.md"), false).await;
    std::fs::set_permissions(&r.home, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(matches!(out, Err(RemoteError::PermissionDenied(_))), "{out:?}");
    assert_eq!(std::fs::read_to_string(r.at("a.md")).unwrap(), "old");
}

#[tokio::test]
async fn a_leftover_temporary_file_goes_on_the_next_successful_save() {
    let r = setup().await;
    r.put("a.md", "old");
    r.put(".a.md.gonq-deadbeef.tmp", "half");
    r.put(".b.md.gonq-00000001.tmp", "another file's");
    r.put("keep.tmp", "not ours");
    saved(r.save("a.md", "new", r.stat_on_disk("a.md"), false).await);
    assert_eq!(r.names_in(""), [".b.md.gonq-00000001.tmp", "a.md", "keep.tmp"]);
}

#[tokio::test]
async fn only_markdown_files_can_be_written() {
    let r = setup().await;
    r.put("notes.txt", "keep");
    r.put("real.conf", "keep");
    std::os::unix::fs::symlink(r.at("real.conf"), r.at("sneaky.md")).unwrap();
    let stat = RemoteStat { mtime: 0, size: 0 };
    for name in ["notes.txt", "sneaky.md", ".md", "noext"] {
        let out = r.save(name, "x", stat, true).await;
        assert!(matches!(out, Err(RemoteError::NotAllowed(_))), "{name}: {out:?}");
    }
    assert_eq!(std::fs::read_to_string(r.at("notes.txt")).unwrap(), "keep");
    assert_eq!(std::fs::read_to_string(r.at("real.conf")).unwrap(), "keep");
    assert_eq!(r.names_in(""), ["notes.txt", "real.conf", "sneaky.md"]);
    r.put("upper.MARKDOWN", "a");
    saved(r.save("upper.MARKDOWN", "b", r.stat_on_disk("upper.MARKDOWN"), false).await);
}

#[tokio::test]
async fn a_save_through_a_link_inside_the_folder_replaces_the_target_and_keeps_the_link() {
    let r = setup().await;
    r.put("real.md", "old");
    std::os::unix::fs::symlink(r.at("real.md"), r.at("alias.md")).unwrap();
    let seen = r.stat_on_disk("real.md");
    saved(r.save("alias.md", "new", seen, false).await);
    assert_eq!(std::fs::read_to_string(r.at("real.md")).unwrap(), "new");
    assert!(std::fs::symlink_metadata(r.at("alias.md")).unwrap().file_type().is_symlink());
}

// ---- connection loss ---------------------------------------------------------------------------

#[tokio::test]
async fn a_connection_lost_mid_save_leaves_the_original_untouched() {
    let r = setup_with(|s| s.kill_on_write = Some(1)).await;
    r.put("a.md", "original");
    let out = r.save("a.md", "never lands", r.stat_on_disk("a.md"), false).await;
    assert!(matches!(out, Err(RemoteError::Disconnected(_))), "{out:?}");
    assert_eq!(std::fs::read_to_string(r.at("a.md")).unwrap(), "original");
    assert!(r.f.server.writes.load(Ordering::SeqCst) >= 1);
}

#[tokio::test]
async fn after_the_server_comes_back_the_next_command_reconnects_silently() {
    let client = new_key();
    let r = {
        let r = setup_with(|_| {}).await;
        // Replace the key the fixture wrote so that the restarted server can accept it.
        write_key(&r.f.ssh_dir().join("id_ed25519"), &client);
        let policy = Policy { allowed_keys: vec![client.public_key().clone()], root: r.home.clone(), ..Default::default() };
        r.f.server.stop();
        tokio::time::sleep(Duration::from_millis(200)).await;
        let again = TestServer::start_on(r.f.server.port, r.f.server.host_key.clone(), policy).await;
        r.put("a.md", "after");
        // Keep the restarted server alive for the test's length.
        std::mem::forget(again);
        r
    };
    assert_eq!(r.read("a.md").await.unwrap().1, b"after");
    let (_, in_place, _) = saved(r.save("a.md", "saved after reconnect", r.stat_on_disk("a.md"), false).await);
    assert!(!in_place);
}

#[tokio::test]
async fn a_host_that_stays_down_is_reported_as_a_lost_connection_or_unreachable() {
    let r = setup().await;
    r.put("a.md", "x");
    assert!(r.read("a.md").await.is_ok());
    r.f.server.stop();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let out = r.read("a.md").await;
    assert!(matches!(out, Err(RemoteError::Disconnected(_)) | Err(RemoteError::Unreachable(_))), "{out:?}");
    assert!(!fs::exists(&r.f.pool, &r.remote, &r.uri(r.at("a.md")), false).await, "false when unreachable");
}

#[tokio::test]
async fn a_session_that_needs_the_user_says_auth_required() {
    let f = fixture(Setup { password: Some("pw"), trusted: true, ..Default::default() }).await;
    let home = f.dir.path().join("home");
    let remote = Remote::default();
    let file = RemotePath { key: f.key(), path: home.join("a.md").to_string_lossy().into_owned() };
    super::allow_recent(&remote, &file.to_string()).unwrap();
    let out = fs::read(&f.pool, &remote, &file.to_string()).await;
    assert_eq!(out, Err(RemoteError::AuthRequired(f.key().authority())));
}

#[tokio::test]
async fn a_changed_host_key_says_host_key_changed() {
    let client = new_key();
    let f = fixture(Setup { allowed: vec![client.public_key().clone()], trusted: true, ..Default::default() }).await;
    write_key(&f.ssh_dir().join("id_ed25519"), &client);
    // known_hosts holds a different key for this host.
    std::fs::write(f.ssh_dir().join("known_hosts"), "").unwrap();
    super::known_hosts::append(&f.ssh_dir().join("known_hosts"), "127.0.0.1", f.server.port, new_key().public_key()).unwrap();
    let remote = Remote::default();
    let file = RemotePath { key: f.key(), path: f.dir.path().join("home/a.md").to_string_lossy().into_owned() };
    super::allow_recent(&remote, &file.to_string()).unwrap();
    let out = fs::read(&f.pool, &remote, &file.to_string()).await;
    assert!(matches!(out, Err(RemoteError::HostKeyChanged(_))), "{out:?}");
}

// ---- wire shapes -------------------------------------------------------------------------------

#[test]
fn errors_serialise_like_list_errors() {
    let json = serde_json::to_value(RemoteError::NotFound("ssh://me@nas/a.md".into())).unwrap();
    assert_eq!(json, serde_json::json!({"kind": "not_found", "message": "ssh://me@nas/a.md"}));
    let kinds = [
        (RemoteError::Unreachable(String::new()), "unreachable"),
        (RemoteError::AuthRequired(String::new()), "auth_required"),
        (RemoteError::HostKeyChanged(String::new()), "host_key_changed"),
        (RemoteError::Disconnected(String::new()), "disconnected"),
        (RemoteError::PermissionDenied(String::new()), "permission_denied"),
        (RemoteError::NotAFolder(String::new()), "not_a_folder"),
        (RemoteError::NotAllowed(String::new()), "not_allowed"),
        (RemoteError::Io(String::new()), "io"),
    ];
    for (e, kind) in kinds {
        assert_eq!(serde_json::to_value(e).unwrap()["kind"], kind);
    }
}

#[test]
fn outcomes_and_stats_cross_the_wire_in_snake_case() {
    let saved = WriteOutcome::Saved { stat: RemoteStat { mtime: 7, size: 9 }, in_place: false, warn: false };
    assert_eq!(
        serde_json::to_value(saved).unwrap(),
        serde_json::json!({"status": "saved", "stat": {"mtime": 7, "size": 9}, "in_place": false, "warn": false})
    );
    let conflict = WriteOutcome::Conflict { deleted: true, current: None };
    assert_eq!(serde_json::to_value(conflict).unwrap(), serde_json::json!({"status": "conflict", "deleted": true, "current": null}));
    let stat: RemoteStat = serde_json::from_str(r#"{"mtime": 1, "size": 2}"#).unwrap();
    assert_eq!(stat, RemoteStat { mtime: 1, size: 2 });
}
