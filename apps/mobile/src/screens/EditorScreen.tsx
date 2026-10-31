/**
 * The mobile editor screen: the shared MarkdownEditor on the active tab (its handle, selection and table target live in the CommandHost; a long press on the text opens the EditorSheet), the keyboard AccessoryBar below it (swapped for the TableBar while the caret is in a table, via the editor's onTable target) and the tab strip above the editor, the Outline drawer over it and (as
 * the screen's top-bar actions) the Outline and Comments buttons, the Raw switch and the ⋯ menu. The docked CommentsSheet replaces the accessory bar while open; a tapped comment marker opens its thread, and the open thread's anchor is revealed (also on keyboard changes). useVisualViewport keeps the shell above the virtual keyboard and, after
 * each visual-viewport change, calls the editor handle's scrollCaretIntoView (CodeMirror's EditorView.scrollIntoView
 * effect) so the caret stays visible. editorScreen(title) builds the navigator Screen; EditorBridge pushes it when a document opens.
 */
import { createElement, Fragment, useEffect, useRef, useState } from 'react';
import { parseCommentMarkers } from '@gonq/editor/comment-threads';
import { listThreads, threadKey } from '@gonq/editor/model/threads';
import { MarkdownEditor } from '@gonq/editor/editor/MarkdownEditor';
import { useCommandHost } from '../shell/commandContext';
import { useComments } from '../shell/comments';
import { useDocuments } from '../shell/documents';
import { useNavigator, type Screen } from '../shell/StackNavigator';
import { useVisualViewport } from '../shell/useVisualViewport';
import { AccessoryBar } from './AccessoryBar';
import { CommentsButton, CommentsSheet } from './CommentsSheet';
import { EditorSheet, useLongPress } from './EditorSheet';
import { OutlineButton, OutlineDrawer } from './OutlineDrawer';
import { MoreMenu } from './MoreMenu';
import { RawSwitch } from './RawSwitch';
import { TabStrip } from './TabStrip';

const noop = () => {};

/** Scrolls the thread's marker to the top of the editor, so the docked Comments sheet below never covers its anchor. */
function revealThread(editor: ReturnType<typeof useCommandHost>['editor'], text: string, key: string) {
  const item = listThreads(text).find((t) => t.key === key);
  const marker = item && parseCommentMarkers(text).get(item.thread.id)?.[item.ordinal];
  if (marker) editor.current?.reveal(marker.from);
}

export function EditorScreen({ readOnly = false }: { readOnly?: boolean }) {
  const { session } = useDocuments();
  const { ctx, editor, setSelection, setTable } = useCommandHost();
  const [sheet, setSheet] = useState(false);
  const { releasing, ...press } = useLongPress(() => setSheet(true));
  const comments = useComments();
  const open = comments.open;
  const selectedKey = comments.selectedKey;
  const text = session.text;
  const textRef = useRef(text);
  textRef.current = text;
  // A thread open in the sheet keeps its anchor in view, also when the keyboard changes the visible height.
  const keepAnchor = () => (open && selectedKey !== null ? revealThread(editor, textRef.current, selectedKey) : editor.current?.scrollCaretIntoView());
  useVisualViewport(keepAnchor);
  useEffect(() => {
    if (!open || selectedKey === null) return;
    // After the sheet is laid out, so the editor has its new height.
    const frame = requestAnimationFrame(() => revealThread(editor, textRef.current, selectedKey));
    return () => cancelAnimationFrame(frame);
  }, [open, selectedKey, editor]);
  if (session.meta === null || session.activeId === null) return null;
  return (
    <div className="m-editor-screen" {...press}>
      <TabStrip />
      <MarkdownEditor
        ref={editor}
        tabId={session.activeId}
        text={session.text}
        raw={session.raw}
        readOnly={readOnly || ctx.readOnly}
        tabIds={session.tabIds}
        docPath={session.meta.path}
        onOpenThread={(id, ordinal) => {
          const key = threadKey(id, ordinal);
          if (listThreads(text).some((t) => t.key === key)) comments.openThread(key);
        }}
        onTable={setTable}
        onContextMenu={noop}
        onChange={session.edited}
        onSelection={setSelection}
      />
      <OutlineDrawer />
      <CommentsSheet />
      {!open && <AccessoryBar editor={editor} canUndo={session.canUndo} canRedo={session.canRedo} table={ctx.tableTarget} />}
      <EditorSheet open={sheet} onClose={() => setSheet(false)} releasing={releasing} />
    </div>
  );
}

export const EDITOR_SCREEN_KEY = 'editor';

export const editorScreen = (title: string): Screen => ({
  key: EDITOR_SCREEN_KEY,
  title,
  render: () => createElement(EditorScreen),
  actions: () => createElement(Fragment, null, createElement(OutlineButton), createElement(CommentsButton), createElement(RawSwitch), createElement(MoreMenu)),
});

/**
 * Pushes the editor screen whenever a document becomes the active tab and the editor is not already on top; while it is
 * on top, its title follows the active tab and closing the last tab goes back to the screen below.
 */
export function EditorBridge() {
  const { session } = useDocuments();
  const { top, push, pop, replace } = useNavigator();
  const name = session.meta?.name;
  useEffect(() => {
    if (session.activeId !== null && name !== undefined && top.key !== EDITOR_SCREEN_KEY) push(editorScreen(name));
    // Only a change of the active tab opens the editor; going Back must not push it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.activeId]);
  useEffect(() => {
    if (top.key !== EDITOR_SCREEN_KEY) return;
    if (session.activeId === null) pop();
    else if (name !== undefined && top.title !== name) replace(editorScreen(name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.activeId, name]);
  return null;
}
