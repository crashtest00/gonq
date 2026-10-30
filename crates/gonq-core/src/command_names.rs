//! The names of the commands the `gonq` plugin exposes (`COMMANDS`), as plain strings. The build script reads this file
//! with `#[path]` to generate their permissions (a build script cannot call the crate it builds), and `plugin` checks it
//! against the real command list, so a command added in one place and not the other fails a test. The SSH commands are listed
//! apart (`SSH`) and are in `COMMANDS` only when the `ssh` feature is on; the build script, which cannot see the crate's
//! features as cfg, generates permissions from `BASE` plus `SSH` in every build.

macro_rules! command_lists {
    (base: [$($b:literal),* $(,)?], ssh: [$($s:literal),* $(,)?]) => {
        /// The commands every build has, in registration order.
        #[allow(dead_code)]
        pub const BASE: &[&str] = &[$($b),*];
        /// The commands that exist only with the `ssh` feature, registered after `BASE`.
        #[allow(dead_code)]
        pub const SSH: &[&str] = &[$($s),*];
        /// Every plugin command of this build, in the order `plugin::commands` registers them.
        #[cfg(feature = "ssh")]
        #[allow(dead_code)]
        pub const COMMANDS: &[&str] = &[$($b,)* $($s),*];
        /// Every plugin command of this build, in the order `plugin::commands` registers them.
        #[cfg(not(feature = "ssh"))]
        #[allow(dead_code)]
        pub const COMMANDS: &[&str] = &[$($b),*];
    };
}

command_lists! {
    base: [
        "allow_document_folder",
        "list_directory",
        "path_exists",
        "recent_documents_add",
        "recent_documents_list",
        "recent_documents_remove",
        "allow_recent_document",
        "get_author_name",
        "set_author_name",
        "get_theme",
        "set_theme",
        "get_pane_widths",
        "set_pane_width",
        "github_start",
        "github_poll",
        "github_status",
        "github_sign_out",
        "github_list_repos",
        "github_list_branches",
        "github_list_folder",
        "github_read_file",
        "github_commit_file",
        "github_open_pulls_for_branches",
        "github_branch_exists",
        "github_create_branch",
        "github_branches_exist",
        "github_compare",
        "github_create_pull",
    ],
    ssh: [
        "ssh_list_hosts",
        "ssh_connect",
        "ssh_disconnect",
        "remote_list_folders",
        "remote_open_root",
        "remote_list_directory",
        "remote_read",
        "remote_write",
        "remote_exists",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// With the `ssh` feature `COMMANDS` ends with all 9 SSH commands; without it none of them is there.
    #[test]
    fn ssh_commands_follow_the_ssh_feature() {
        assert_eq!(SSH.len(), 9);
        for name in SSH {
            assert_eq!(COMMANDS.contains(name), cfg!(feature = "ssh"), "{name}");
        }
        assert_eq!(COMMANDS.len(), BASE.len() + if cfg!(feature = "ssh") { SSH.len() } else { 0 });
        assert!(BASE.iter().all(|c| !c.starts_with("ssh_") && !c.starts_with("remote_")));
    }
}
