/**
 * <BackNavigation/>: the navigator's own Back, the lowest handler on the stack of shell/back.tsx: a screen above the root goes
 * back as the top bar's Back control does. In the editor and on the Documents screen (the roots) Back leaves the app, after
 * asking about each tab with unsaved changes (the same prompt as its Close control); Cancel keeps the app open. A Back arriving
 * while such a question or a leave is under way is ignored, so it can neither double the prompt nor skip a screen.
 */
import { useRef } from 'react';
import { leaveApp } from '@gonq/editor/platform/backButton';
import { EDITOR_SCREEN_KEY } from '../screens/EditorScreen';
import { useBackHandler } from './back';
import { useDocuments } from './documents';
import { useNotices } from './notices';
import { useNavigator } from './StackNavigator';

export function BackNavigation() {
  const { top, stack, pop } = useNavigator();
  const doc = useDocuments();
  const { setError } = useNotices();
  const busy = useRef(false);
  useBackHandler(
    true,
    () => {
      if (busy.current) return;
      const inEditor = top.key === EDITOR_SCREEN_KEY;
      if (!inEditor && stack.length > 1) return pop();
      // The editor and the Documents screen are the root: Back leaves the app, after asking about each unsaved tab.
      busy.current = true;
      doc
        .confirmAllTabs()
        .then((ok) => (ok ? leaveApp() : undefined))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => (busy.current = false));
    },
    'nav',
  );
  return null;
}
