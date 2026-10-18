//! Markdown paths the OS hands to the app: command-line arguments of the first launch or of a
//! second launch (forwarded by the single-instance plugin), and macOS "open file" events.
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Event carrying `Vec<String>` of absolute paths to open, emitted once the frontend has
/// called `take_launch_paths`. Paths that arrive earlier are queued for that call.
pub const OPEN_PATHS_EVENT: &str = "launch-open-paths";

const MARKDOWN_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

#[derive(Default)]
struct Inner {
    /// True once the frontend has taken the queue and listens for the event.
    ready: bool,
    queue: Vec<String>,
}

#[derive(Default)]
pub struct LaunchPaths(Mutex<Inner>);

impl LaunchPaths {
    /// Returns the paths to emit now, or None when they were queued for the frontend's first take.
    pub fn deliver(&self, paths: Vec<String>) -> Option<Vec<String>> {
        if paths.is_empty() {
            return None;
        }
        let mut inner = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if inner.ready {
            Some(paths)
        } else {
            inner.queue.extend(paths);
            None
        }
    }

    /// Drains the queue and marks the frontend ready for events.
    pub fn take(&self) -> Vec<String> {
        let mut inner = self.0.lock().unwrap_or_else(|e| e.into_inner());
        inner.ready = true;
        std::mem::take(&mut inner.queue)
    }

}

pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| MARKDOWN_EXTENSIONS.iter().any(|m| e.eq_ignore_ascii_case(m)))
}

/// The existing Markdown files named by a command line (`args[0]` is the program). Flags are
/// skipped, `file://` URLs are accepted, relative paths resolve against `cwd`; duplicates drop.
pub fn paths_from_args(args: &[String], cwd: &Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for arg in args.iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let path = match arg.strip_prefix("file://") {
            Some(_) => match url::Url::parse(arg).ok().and_then(|u| u.to_file_path().ok()) {
                Some(p) => p,
                None => continue,
            },
            None => PathBuf::from(arg),
        };
        let path = if path.is_absolute() { path } else { cwd.join(path) };
        if !is_markdown(&path) || !path.is_file() {
            continue;
        }
        let path = path.canonicalize().unwrap_or(path);
        let s = path.to_string_lossy().into_owned();
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn picks_existing_markdown_files_only() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("B.MARKDOWN");
        let txt = dir.path().join("c.txt");
        for f in [&a, &b, &txt] {
            std::fs::write(f, "x").unwrap();
        }
        let got = paths_from_args(
            &args(&["gonq", "--flag", a.to_str().unwrap(), txt.to_str().unwrap(), "missing.md", b.to_str().unwrap(), a.to_str().unwrap()]),
            dir.path(),
        );
        let canon = |p: &Path| p.canonicalize().unwrap().to_string_lossy().into_owned();
        assert_eq!(got, vec![canon(&a), canon(&b)]);
    }

    #[test]
    fn resolves_relative_paths_and_file_urls() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("my doc.md");
        std::fs::write(&a, "x").unwrap();
        let url = url::Url::from_file_path(&a).unwrap().to_string();
        let want = a.canonicalize().unwrap().to_string_lossy().into_owned();
        assert_eq!(paths_from_args(&args(&["gonq", "my doc.md"]), dir.path()), vec![want.clone()]);
        assert_eq!(paths_from_args(&args(&["gonq", &url]), Path::new("/")), vec![want]);
    }

    #[test]
    fn queues_until_the_frontend_takes_then_emits() {
        let lp = LaunchPaths::default();
        assert_eq!(lp.deliver(vec!["a.md".into()]), None);
        assert_eq!(lp.deliver(vec!["b.md".into()]), None);
        assert_eq!(lp.take(), vec!["a.md".to_string(), "b.md".to_string()]);
        assert_eq!(lp.take(), Vec::<String>::new());
        assert_eq!(lp.deliver(vec!["c.md".into()]), Some(vec!["c.md".to_string()]));
        assert_eq!(lp.deliver(vec![]), None);
    }
}
