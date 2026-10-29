//! gonq-core: the app logic shared by every Gonq front end, with no Tauri launch code. Holds the local `commands`
//! (with `DataPaths`, where settings.json and recent.json live), and the `github` and `ssh` modules with their commands,
//! plus the folder, recents and settings helpers they use. An app registers the commands by path in `generate_handler!`.
pub mod commands;
pub mod folder;
pub mod github;
pub mod recents;
pub mod settings;
pub mod ssh;

pub use commands::DataPaths;
