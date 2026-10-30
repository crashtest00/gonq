//! gonq-core: the app logic shared by every Gonq front end, with no Tauri launch code. Holds the local `commands`
//! (with `DataPaths`, where settings.json and recent.json live), and the `github` and `ssh` modules with their commands,
//! plus the folder, recents and settings helpers they use. `init()` (in `plugin`) packages them all as the Tauri plugin
//! `gonq`, which an app installs with `.plugin(gonq_core::init())`; its commands are invoked as `plugin:gonq|<name>`.
pub mod command_names;
pub mod commands;
pub mod folder;
pub mod github;
pub mod plugin;
pub mod recents;
pub mod settings;
pub mod ssh;

pub use commands::DataPaths;
pub use plugin::init;
