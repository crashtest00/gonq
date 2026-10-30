/**
 * Registers every app dialog with DialogHost and exports the typed handles App.tsx opens them with. Each entry
 * adapts an existing dialog component (its props and wording are unchanged) to resolve through `close`.
 */
import type { FileAccess } from '@gonq/editor/platform/files';
import { AboutDialog } from '../components/AboutDialog';
import { AgentSkillDialog } from '../components/AgentSkillDialog';
import { BranchChangeDialog } from '../components/BranchChangeDialog';
import { CommitDialog, type CommitChoice } from '../components/CommitDialog';
import { ConflictDialog, type ConflictChoice } from '../components/ConflictDialog';
import { ConnectDialog } from '../components/ConnectDialog';
import { CreateBranchDialog, type CreateBranchResult } from '../components/CreateBranchDialog';
import type { PendingCommit } from '@gonq/editor/features/github/createBranch';
import { OpenPrDialog, type OpenedPr } from '../components/OpenPrDialog';
import type { RepoRef } from '@gonq/editor/features/github/openPr';
import type { SessionBranch } from '@gonq/editor/features/github/sessionBranches';
import { SettingsDialog } from '../components/SettingsDialog';
import { RepoPickerDialog, type RepoChoice } from '../components/RepoPickerDialog';
import { UnsavedChangesDialog, type UnsavedChoice } from '../components/UnsavedChangesDialog';
import { registerDialog, type DialogClose } from '@gonq/editor/dialogs/DialogHost';

/** Resolves true when the user is signed in to GitHub on the way out (Open Repo / Open PR wait on it). */
export const settingsDialog = registerDialog(
  'settings',
  ({
    authorName,
    onSave,
    startSignIn,
    onSignOut,
    close,
  }: { authorName: string; onSave: (name: string) => Promise<void>; startSignIn?: boolean; onSignOut: () => Promise<void> } & DialogClose<boolean>) => (
    <SettingsDialog authorName={authorName} onSave={onSave} startSignIn={startSignIn} onSignOut={onSignOut} onClose={close} />
  ),
  false,
);

export const agentSkillDialog = registerDialog(
  'agent-skill',
  ({ files, close }: { files: FileAccess } & DialogClose<void>) => <AgentSkillDialog files={files} onClose={() => close()} />,
  undefined,
);

export const aboutDialog = registerDialog('about', ({ close }: DialogClose<void>) => <AboutDialog onClose={() => close()} />, undefined);

/** Resolves true when the connection was made (or the folder opened), false when the dialog was dismissed. */
export const connectDialog = registerDialog(
  'connect',
  ({
    host,
    reconnect,
    inUse,
    onOpened,
    close,
  }: { host?: string; reconnect: boolean; inUse: (account: string) => boolean; onOpened: (folderUri: string) => void } & DialogClose<boolean>) => (
    <ConnectDialog host={host} reconnect={reconnect} inUse={inUse} onOpened={onOpened} onClose={close} />
  ),
  false,
);

export type RepoPickerResult = { kind: 'chosen'; choice: RepoChoice } | { kind: 'closed' } | { kind: 'signed-out' };

export const repoPickerDialog = registerDialog(
  'repo-picker',
  ({ close }: DialogClose<RepoPickerResult>) => (
    <RepoPickerDialog
      onChoose={(choice) => close({ kind: 'chosen', choice })}
      onClose={() => close({ kind: 'closed' })}
      onSignedOut={() => close({ kind: 'signed-out' })}
    />
  ),
  { kind: 'closed' } as RepoPickerResult,
);

export const conflictDialog = registerDialog(
  'conflict',
  ({ name, deleted, close }: { name: string; deleted: boolean } & DialogClose<ConflictChoice>) => (
    <ConflictDialog name={name} deleted={deleted} onChoose={close} />
  ),
  'cancel' as ConflictChoice,
);

export const unsavedChangesDialog = registerDialog(
  'unsaved-changes',
  ({ name, close }: { name: string } & DialogClose<UnsavedChoice>) => <UnsavedChangesDialog name={name} onChoose={close} />,
  'cancel' as UnsavedChoice,
);

/** Resolves true when the user chose to close the document and change branch. */
export const branchChangeDialog = registerDialog(
  'branch-change',
  ({ name, close }: { name: string } & DialogClose<boolean>) => <BranchChangeDialog name={name} onChoose={close} />,
  false,
);

export const commitDialog = registerDialog(
  'commit',
  ({ owner, repo, branch, path, close }: { owner: string; repo: string; branch: string; path: string } & DialogClose<CommitChoice>) => (
    <CommitDialog owner={owner} repo={repo} branch={branch} path={path} onChoose={close} />
  ),
  'cancel' as CommitChoice,
);

/** Resolves with the finished create (and commit) outcome, or null when the dialog was dismissed. */
export const createBranchDialog = registerDialog(
  'create-branch',
  ({
    owner,
    repo,
    source,
    commit,
    onCreated,
    close,
  }: { owner: string; repo: string; source: string; commit: PendingCommit | null; onCreated: (branch: string) => void } & DialogClose<CreateBranchResult>) => (
    <CreateBranchDialog owner={owner} repo={repo} source={source} commit={commit} onCreated={onCreated} onClose={close} />
  ),
  null as CreateBranchResult,
);

/** File > Open PR…; resolves when closed. `onOpened` reports a pull request as soon as GitHub has created it. */
export const openPrDialog = registerDialog(
  'open-pr',
  ({
    preferred,
    tabBranches,
    sessionBranches,
    onOpened,
    close,
  }: { preferred: RepoRef | null; tabBranches: SessionBranch[]; sessionBranches: SessionBranch[]; onOpened: (opened: OpenedPr) => void } & DialogClose<void>) => (
    <OpenPrDialog preferred={preferred} tabBranches={tabBranches} sessionBranches={sessionBranches} onOpened={onOpened} onClose={() => close()} />
  ),
  undefined,
);
