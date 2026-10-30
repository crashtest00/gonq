//! gonq-core: the app logic shared by every Gonq front end, with no Tauri launch code. Holds the local `commands`
//! (with `DataPaths`, where settings.json and recent.json live), and the `github` and (feature `ssh`, on by default) `ssh` modules with their commands,
//! plus the folder, recents and settings helpers they use. `init()` (in `plugin`) packages them all as the Tauri plugin
//! `gonq`, which an app installs with `.plugin(gonq_core::init())`; its commands are invoked as `plugin:gonq|<name>`.
pub mod command_names;
pub mod commands;
pub mod folder;
pub mod github;
pub mod plugin;
pub mod recents;
pub mod settings;
#[cfg(feature = "ssh")]
pub mod ssh;

pub use commands::DataPaths;
pub use command_names::COMMANDS;
pub use plugin::init;
