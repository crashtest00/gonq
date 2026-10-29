# Navigator Refresh

User guide to the **Refresh** control of the folder/repository navigator. The GitHub specifics (branch list, deleted
branches) are also in [github-review.md](github-review.md).

## Where it is

- The circular-arrow icon beside the folder or repository name in the navigator header (tooltip "Refresh").
- **View > Refresh Navigator** (no shortcut).
- The icon is always shown. With no folder or repository open it is disabled, and so is the menu item.

## Local folders

Refresh lists the open folder again and every folder you have expanded, so files added, renamed or deleted outside
Gonq appear. Expanded folders stay expanded and the scroll position does not move. Collapsed folders are not read.
Open tabs, unsaved edits and the highlighted current file are not touched. The Refresh button is a normal tab stop and works with Enter and Space.

## ssh:// folders

Same behaviour for a folder opened over SSH: the root and the expanded folders are listed again on the server. If
the connection was lost or the host is unreachable, the tree stays as it was and an error line explains why (for
example "Lost connection to <host>."); use Retry or Refresh again after reconnecting.

## GitHub repositories

The root, the expanded folders and the branch list are fetched again. If the open branch was deleted on GitHub,
Refresh switches to the default branch, asking first when the open document has uncommitted changes.

## While it runs and when it fails

The icon spins and the button is disabled until the listing finishes, so a second click cannot start another one. A
failed refresh never empties the tree: the rows and expanded folders stay and an error is shown.
