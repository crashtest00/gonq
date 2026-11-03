/**
 * <BackNavigation/>: the navigator's own Back, the lowest handler on the stack of shell/back.tsx: the top screen goes back as the top bar's Back control does. In the editor a tab with unsaved
 * changes asks first (the same prompt as its Close control) and a clean one returns to the previous screen. On the Documents
 * screen a tab that is still unsaved asks before anything else; with none, Back leaves the app. A Back arriving while such a
 * question or a leave is under way is ignored, so it can neither double the prompt nor skip a screen.
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
      const { session } = doc;
      const dirty = top.key === EDITOR_SCREEN_KEY ? session.dirtyIds().filter((id) => id === session.activeId) : stack.length > 1 ? [] : session.dirtyIds();
      if (dirty.length === 0 && stack.length > 1) return pop();
      busy.current = true;
      const done = dirty.length > 0 ? doc.closeTabById(dirty[0]) : leaveApp();
      done.catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => (busy.current = false));
    },
    'nav',
  );
  return null;
}
