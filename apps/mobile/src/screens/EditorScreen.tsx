/**
 * The mobile editor screen: the shared MarkdownEditor on the active tab, the keyboard AccessoryBar below it (swapped for the TableBar while the caret is in a table, via the editor's onTable target) and (as
 * the screen's top-bar action) the Raw switch. useVisualViewport keeps the shell above the virtual keyboard and, after
 * each visual-viewport change, calls the editor handle's scrollCaretIntoView (CodeMirror's EditorView.scrollIntoView
 * effect) so the caret stays visible. editorScreen(title) builds the navigator Screen; EditorBridge pushes it when a document opens.
 */
import { createElement, useEffect, useRef, useState } from 'react';
import type { TableTarget } from '@gonq/editor/editor/tables';
import { MarkdownEditor, type EditorHandle } from '@gonq/editor/editor/MarkdownEditor';
import { useDocuments } from '../shell/documents';
import { useNavigator, type Screen } from '../shell/StackNavigator';
import { useVisualViewport } from '../shell/useVisualViewport';
import { AccessoryBar } from './AccessoryBar';
import { RawSwitch } from './RawSwitch';

const noop = () => {};

export function EditorScreen({ readOnly = false }: { readOnly?: boolean }) {
  const { session } = useDocuments();
  const editor = useRef<EditorHandle>(null);
  const [table, setTable] = useState<TableTarget | null>(null);
  useVisualViewport(() => editor.current?.scrollCaretIntoView());
  if (session.meta === null || session.activeId === null) return null;
  return (
    <div className="m-editor-screen">
      <MarkdownEditor
        ref={editor}
        tabId={session.activeId}
        text={session.text}
        raw={session.raw}
        readOnly={readOnly}
        tabIds={session.tabIds}
        docPath={session.meta.path}
        onOpenThread={noop}
        onTable={setTable}
        onContextMenu={noop}
        onChange={session.edited}
        onSelection={noop}
      />
      <AccessoryBar editor={editor} canUndo={session.canUndo} canRedo={session.canRedo} table={table} />
    </div>
  );
}

export const EDITOR_SCREEN_KEY = 'editor';

export const editorScreen = (title: string): Screen => ({
  key: EDITOR_SCREEN_KEY,
  title,
  render: () => createElement(EditorScreen),
  actions: () => createElement(RawSwitch),
});

/** Pushes the editor screen whenever a document becomes the active tab and the editor is not already on top. */
export function EditorBridge() {
  const { session } = useDocuments();
  const { top, push } = useNavigator();
  const name = session.meta?.name;
  useEffect(() => {
    if (session.activeId !== null && name !== undefined && top.key !== EDITOR_SCREEN_KEY) push(editorScreen(name));
    // Only a change of the active tab opens the editor; going Back must not push it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.activeId]);
  return null;
}
