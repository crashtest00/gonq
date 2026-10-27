/**
 * CommandContext: what a registered command reads (document, editor, theme state) and calls (the app's own
 * actions). App.tsx builds one per render; the logic behind each action stays in App.tsx.
 */
import type { RefObject } from 'react';
import type { EditorHandle } from '../editor/MarkdownEditor';
import type { TableTarget } from '../editor/tables';
import type { openDialog } from '../dialogs/DialogHost';
import type { useDocument } from '../document/useDocument';
import type { FileAccess } from '../platform/files';
import type { ThemeChoice } from '../platform/settings';

type Action = () => unknown;

export interface CommandContext {
  hasDocument: boolean;
  canUndo: boolean;
  canRedo: boolean;
  raw: boolean;
  theme: ThemeChoice;
  tableTarget: TableTarget | null;
  editor: RefObject<EditorHandle>;
  session: ReturnType<typeof useDocument>;
  files: FileAccess;
  setError: (message: string | null) => void;
  openDialog: typeof openDialog;
  save: Action;
  saveAs: Action;
  /** The active tab is a GitHub file: Save (Ctrl+S) commits it. */
  isGithubTab: boolean;
  /** The active tab is read-only: a pull request is open for its GitHub branch. */
  readOnly: boolean;
  /** Commits the active GitHub tab after a confirmation dialog. */
  commit: Action;
  newFile: Action;
  openFile: Action;
  /** Closes the active tab (asking about unsaved changes); does nothing without one. */
  closeTab: Action;
  openFolder: Action;
  openConnect: Action;
  openRepo: Action;
  /** A repository is open in the navigator or a GitHub tab is open: File > Open PR… has a repository to work on. */
  canOpenPr: boolean;
  /** Signs in if needed, then shows the Open PR dialog. */
  openPr: Action;
  openSettings: Action;
  githubSignIn: Action;
  githubSignOut: Action;
  /** Picks an image and inserts it at the caret. */
  insertImage: Action;
  insertToc: Action;
  /** Switches the active tab between Raw and Formatted. */
  setRaw: (raw: boolean) => void;
  setTheme: (theme: ThemeChoice) => void;
  openAgentSkill: Action;
  openAbout: Action;
  /** The editor has selected text (Cut and Copy need it). */
  hasSelection: boolean;
  /** A comment can be started at the selection or caret. */
  canAddComment: boolean;
  addComment: Action;
}
