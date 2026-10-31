/**
 * The save rules every comment text box shares (desktop sidebar and mobile sheet): SAVE_TIP and SAVE_KEYS for the
 * tooltip and aria-keyshortcuts, saveOnModEnter(save) for the box's onKeyDown (Ctrl/Cmd+Enter saves; key repeat and IME
 * composition are ignored), saveKeyProps(label, save) = the title, aria-keyshortcuts and onKeyDown props of a box in one spread
 * (so an app's own sources hold no key handler), and useOnce(body, save), which lets a save run once until the body changes again.
 */
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export const SAVE_TIP = 'Ctrl+Enter (Cmd+Enter on macOS)';
export const SAVE_KEYS = 'Control+Enter Meta+Enter';

/** Ctrl/Cmd+Enter in a comment box saves it, like clicking its button; key repeat and IME composition are ignored. */
export const saveOnModEnter = (save: () => void) => (e: ReactKeyboardEvent) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
    e.preventDefault();
    if (!e.repeat) save();
  }
};

/** The props for a comment textarea whose Ctrl/Cmd+Enter runs `save`: tooltip `${label}: …`, aria-keyshortcuts and the key handler. */
export const saveKeyProps = (label: string, save: () => void) => ({
  title: `${label}: ${SAVE_TIP}`,
  'aria-keyshortcuts': SAVE_KEYS,
  onKeyDown: saveOnModEnter(save),
});

/** Wraps a save so it runs once until `body` changes again (a double click or rapid keys cannot send twice). */
export function useOnce(body: string, save: () => void) {
  const spent = useRef(false);
  useEffect(() => {
    spent.current = false;
  }, [body]);
  return () => {
    if (spent.current || body.trim() === '') return;
    spent.current = true;
    save();
  };
}
