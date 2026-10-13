import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { editorExtensions } from './extensions';

/** The live-preview editor, read-only: for showing a bundled Markdown document (Help > Agent skill…). */
export function MarkdownPreview({ text }: { text: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({ doc: text, extensions: [editorExtensions(false), EditorState.readOnly.of(true), EditorView.editable.of(false)] }),
      parent: host.current!,
    });
    return () => view.destroy();
  }, [text]);
  return <div ref={host} data-testid="markdown-preview" className="gonq-editor gonq-preview" />;
}
