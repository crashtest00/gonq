# Reviewing Markdown on GitHub with Gonq

## What it does

Gonq can open Markdown files straight from a GitHub repository, let you edit them (comment threads included), commit
the result to a branch and open a pull request, without leaving the app. Nothing is cloned to disk.

## One-time setup: the OAuth App

Gonq signs in with GitHub's [device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).
Whoever ships Gonq registers an OAuth App once (GitHub > Settings > Developer settings > OAuth Apps) and ticks **Enable
Device Flow**. The app's client ID is public; there is no client secret anywhere. The ID is the `CLIENT_ID` constant in
`src-tauri/src/github/mod.rs`.

Gonq asks for the `repo` scope. GitHub describes it as "Grants full access to public and private repositories including
read and write access to code" (see [scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)).
Gonq only reads files and branches, writes commits to branches, and opens pull requests, but the scope is GitHub's and
is that broad. The signed-in user needs write access to the repository.

## The flow

1. **Edit > Settings… > GitHub > Sign In** A dialog shows a short code and an address. Copy the code (there is a Copy button
   beside it), choose **Open github.com/login/device** (or copy the address), paste the code on that GitHub page and
   approve. The dialog says "Waiting for approval on github.com…" and finishes by itself once you approve. Gonq never
   sees your password.
2. **File > Open Repo…** lists your repositories; filter and pick one. The folder sidebar becomes the repository
   navigator: the repository name, a **branch dropdown** (with a filter box) and a folder tree of Markdown files.
   Picking another branch reloads the tree.
3. Click a file to open it in a tab. Edit as usual.
4. **File > Commit…** commits the tab's file to the tab's branch with the message `Edit <path> from Gonq`, after a
   confirmation showing file, repository, branch and message. **Ctrl+S** does the same on a GitHub tab, because there
   is no local file to save to. Local tabs still save normally.
5. **Create branch** (the icon in the navigator header) makes `gonq/<name>` from the current branch; the `gonq/`
   prefix is fixed. If the tab has uncommitted changes, the branch is created and the file committed to it.
6. On a branch that is not a `gonq/` branch, the Commit dialog warns: "This commits directly to <branch>. Branch
   protection and review rules are GitHub's; Gonq does not check them." Its **Commit to new branch…** button creates
   a `gonq/` branch instead.
7. **File > Open PR…** (greyed until a repository or GitHub tab is open) has three steps, left to right: **Branch to
   merge**, **Merge into**, and **Review changes** (the changed files). **Open PR** then shows an editable title and
   body, pre-filled by Gonq; its **Open PR** button creates the pull request, and the result offers **Open in
   browser**.
8. **Edit > Settings… > GitHub > Sign Out** forgets the token.

## Rules a reviewer will notice

- A tab on a branch with an open pull request is read-only. A banner says "Pull request #N is open for this branch.
  You can read this document but not change it." and links to it; Commit and Ctrl+S refuse.
- Changing branch in the navigator closes the active GitHub document. If it has uncommitted changes, a "Change
  branch?" warning says they will be permanently lost.
- Branches Gonq creates are named `gonq/<name>`.
- The Open PR branch list comes from this session: branches Gonq committed to, plus branches of open GitHub tabs. It
  is kept in memory only, so after a restart it is empty until you open a file from a branch.

## Platforms

Where no keychain is available (Linux without a secret service), the dialog says "No keychain is available, so this
sign-in lasts for this session only." and you sign in again next launch. Elsewhere the token is kept in the OS keychain.

The web build shows the same menu items; the actions fail with an error such as "Signing in to GitHub needs the Gonq
desktop app".

## Not supported

Fork-based submission, multiple accounts, draft pull requests, reviewers, checking comment threads before opening a
PR, deleting branches (do it on GitHub), and pull request status inside Gonq.
