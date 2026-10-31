/**
 * The mobile CommandContext: <CommandHostProvider/> builds the full registry context the ⋯ menu and the long-press
 * sheet run commands against (document session, GitHub controller, theme, the screens Settings…/Agent skill…/About
 * push) and owns the editor handle and the editor's selection. useCommandHost() hands { ctx, editor, setSelection } to
 * screens; the editor screen fills the editor ref and reports selection and caret through setSelection.
 * Commands the mobile app cannot run yet (Add Comment until M-27) raise a clear error in the banner.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { CommandContext } from '@gonq/editor/commands';
import { openDialog } from '@gonq/editor/dialogs/DialogHost';
import type { EditorHandle, EditorSelection } from '@gonq/editor/editor/MarkdownEditor';
import type { TableTarget } from '@gonq/editor/editor/tables';
import { isCommentableAt, selectionRange } from '@gonq/editor/model/newThread';
import { files } from '@gonq/editor/platform/files';
import { pickImage } from '@gonq/editor/platform/images';
import { aboutScreen } from '../screens/AboutScreen';
import { agentSkillScreen } from '../screens/AgentSkillScreen';
import { REPO_SCREEN_KEY } from '../screens/RepoScreen';
import { settingsScreen } from '../screens/SettingsScreen';
import { useDocuments } from './documents';
import { useFolder } from './folder';
import { useGithub } from './github';
import { useNotices } from './notices';
import { useNavigator } from './StackNavigator';
import { useThemeChoice } from './theme';

export const ADD_COMMENT_UNAVAILABLE = 'Adding comments is not available yet in the Gonq app.';
export const CONNECT_UNAVAILABLE = 'Connecting to a server is not part of the Gonq app.';

export interface CommandHost {
  ctx: CommandContext;
  editor: RefObject<EditorHandle>;
  /** The editor screen reports its selection (null when empty) and the caret offset. */
  setSelection(selection: EditorSelection | null, head: number): void;
  /** The editor screen reports the table the caret is in (null outside a table); Format > Table reads it. */
  setTable(target: TableTarget | null): void;
}

const HostContext = createContext<CommandHost | null>(null);

export function useCommandHost(): CommandHost {
  const host = useContext(HostContext);
  if (!host) throw new Error('useCommandHost needs a <CommandHostProvider>');
  return host;
}

export function CommandHostProvider({ children }: { children: ReactNode }) {
  const doc = useDocuments();
  const { session } = doc;
  const gh = useGithub();
  const folder = useFolder();
  const nav = useNavigator();
  const [theme, setTheme] = useThemeChoice();
  const { setError } = useNotices();
  const editor = useRef<EditorHandle>(null);
  const [selection, setSel] = useState<EditorSelection | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [table, setTable] = useState<TableTarget | null>(null);
  const setSelection = useCallback((sel: EditorSelection | null, head: number) => {
    setSel(sel);
    setCaret(head);
  }, []);
  // Switching tabs forgets the selection of the tab before.
  useEffect(() => {
    setSel(null);
    setCaret(null);
    setTable(null);
  }, [session.activeId]);

  const text = session.text;
  const hasRange = selection !== null && selectionRange(text, selection.from, selection.to) !== null;
  const canAddAtCaret = caret !== null && caret <= text.length && isCommentableAt(text, caret);
  const readOnly = gh.readOnlyPull !== null;
  const docPath = session.meta?.path ?? null;
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const ctx: CommandContext = {
    hasDocument: doc.hasDocument,
    canUndo: session.canUndo,
    canRedo: session.canRedo,
    raw: session.raw,
    theme,
    tableTarget: table,
    editor,
    session,
    files,
    setError,
    openDialog,
    save: () => void doc.save(),
    saveAs: () => void doc.saveAs(),
    isGithubTab: session.meta?.github !== undefined,
    readOnly,
    commit: () => void doc.save(),
    newFile: doc.newFile,
    openFile: () => void doc.openFile(),
    closeTab: doc.closeTab,
    openFolder: () => void folder.openFolder(),
    openConnect: () => setError(CONNECT_UNAVAILABLE),
    openRepo: () => void gh.openRepo(),
    canOpenPr: gh.canOpenPr,
    openPr: () => void gh.openPr(),
    canRefreshNavigator: nav.stack.some((s) => s.key === REPO_SCREEN_KEY),
    refreshNavigator: gh.refreshNavigator,
    openSettings: () => nav.push(settingsScreen),
    insertImage: () =>
      pickImage(docPath).then((picked) => {
        if (picked === null) return;
        editor.current?.insertImage(picked.src, picked.alt);
        setError(null);
      }, fail),
    insertToc: () => {
      try {
        editor.current?.insertToc();
        setError(null);
      } catch (e) {
        fail(e);
      }
    },
    setRaw: session.setRaw,
    setTheme,
    openAgentSkill: () => nav.push(agentSkillScreen),
    openAbout: () => nav.push(aboutScreen),
    hasSelection: selection !== null && selection.from !== selection.to,
    canAddComment: !readOnly && doc.hasDocument && (hasRange || canAddAtCaret),
    addComment: () => setError(ADD_COMMENT_UNAVAILABLE),
  };
  const host: CommandHost = { ctx, editor, setSelection, setTable };
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}
