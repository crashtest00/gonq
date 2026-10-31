/**
 * The mobile GitHub session: <GithubProvider/> runs the shared useGithubController (repository and branch the navigator
 * shows, session branches, change-branch warning, Open Repo, refresh signal) and useGithub() hands it to screens,
 * together with `finishPick` for the repository picker screen. The sign-in dialog is the sign-in screen (useSignInPrompt);
 * the picker is a pushed screen whose result resolves the controller's pickRepo; the change-branch warning is a bottom
 * sheet ("Change branch?"). The commit conflict is the shared choice sheet (shell/dialogs.tsx, Cancel or Overwrite, both leave the tab unsaved). Create branch is a bottom sheet (screens/CreateBranchSheet.tsx, opened by the controller's createBranch dialog). Commit and Open PR have no mobile screens yet (M-22, M-23),
 * so those dialogs answer "cancel". Choosing a repository shows its navigator screen (replacing one already open).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useGithubController, type CreateBranchDone, type GithubDialogs, type RepoPick } from '@gonq/editor/controllers/github';
import { useSignInPrompt } from '../screens/GitHubSignIn';
import { CreateBranchSheet } from '../screens/CreateBranchSheet';
import { repoPickerScreen } from '../screens/RepoPicker';
import { repoScreen, REPO_SCREEN_KEY } from '../screens/RepoScreen';
import { BottomSheet } from './BottomSheet';
import { useDialogs } from './dialogs';
import { useDocuments } from './documents';
import { useNotices } from './notices';
import { useNavigator } from './StackNavigator';

export type Github = ReturnType<typeof useGithubController> & {
  /** Resolves the picker's promise (and closes the picker screen); called by the picker screen. */
  finishPick(result: RepoPick): void;
};

const GithubContext = createContext<Github | null>(null);

export function useGithub(): Github {
  const ctx = useContext(GithubContext);
  if (!ctx) throw new Error('useGithub needs a <GithubProvider>');
  return ctx;
}

export function GithubProvider({ children }: { children: ReactNode }) {
  const { session } = useDocuments();
  const { setError, setNotice } = useNotices();
  const { confirmConflict } = useDialogs();
  const nav = useNavigator();
  const navRef = useRef(nav);
  navRef.current = nav;
  const signIn = useSignInPrompt();
  const chosen = useRef('');
  const picking = useRef<((r: RepoPick) => void) | null>(null);
  const [creating, setCreating] = useState<{ args: Parameters<GithubDialogs['createBranch']>[0]; done: (r: CreateBranchDone | null) => void } | null>(null);
  const [warning, setWarning] = useState<{ name: string; answer: (ok: boolean) => void } | null>(null);

  const finishPick = useCallback((result: RepoPick) => {
    const resolve = picking.current;
    picking.current = null;
    if (result.kind === 'chosen') chosen.current = `${result.choice.owner}/${result.choice.repo}`;
    resolve?.(result);
    navRef.current.pop();
  }, []);

  const gh = useGithubController({
    session,
    dialogs: {
      signIn,
      pickRepo: () =>
        new Promise<RepoPick>((resolve) => {
          picking.current = resolve;
          navRef.current.push(repoPickerScreen);
        }),
      confirmBranchChange: (name) => new Promise<boolean>((answer) => setWarning({ name, answer })),
      chooseCommit: () => Promise.resolve('cancel'),
      showConflict: (conflict) => confirmConflict(conflict),
      createBranch: (args) => new Promise<CreateBranchDone | null>((done) => setCreating({ args, done })),
      openPr: () => Promise.resolve(undefined),
    },
    onError: setError,
    onNotice: setNotice,
    onRepoChosen: () => {
      const n = navRef.current;
      const screen = repoScreen(chosen.current);
      if (n.top.key === REPO_SCREEN_KEY) n.replace(screen);
      else n.push(screen);
    },
  });

  // Leaving the picker with Back closes it.
  const pickerOpen = nav.stack.some((s) => s.key === repoPickerScreen.key);
  useEffect(() => {
    if (!pickerOpen && picking.current !== null) {
      const resolve = picking.current;
      picking.current = null;
      resolve({ kind: 'closed' });
    }
  }, [pickerOpen]);

  // Cancel is focused when the warning opens, as on desktop.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const warned = warning !== null;
  useEffect(() => {
    if (warned) cancelRef.current?.focus();
  }, [warned]);
  const answer = (ok: boolean) => {
    warning?.answer(ok);
    setWarning(null);
  };
  return (
    <GithubContext.Provider value={{ ...gh, finishPick }}>
      {children}
      {creating !== null && (
        <CreateBranchSheet
          {...creating.args}
          onClose={(result) => {
            creating.done(result);
            setCreating(null);
          }}
        />
      )}
      <BottomSheet open={warning !== null} title="Change branch?" onClose={() => answer(false)}>
        <p style={{ margin: 0 }}>
          Changing branches will close {warning?.name}, and any uncommitted changes will be permanently lost.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" ref={cancelRef} className="m-tap" style={{ border: '1px solid var(--border)', flex: 1 }} onClick={() => answer(false)}>
            Cancel
          </button>
          <button type="button" className="m-tap" style={{ background: 'var(--destructive)', color: 'var(--destructive-foreground)', flex: 1 }} onClick={() => answer(true)}>
            Close document
          </button>
        </div>
      </BottomSheet>
    </GithubContext.Provider>
  );
}
