import { Facet } from '@codemirror/state';

/** What the editor's widgets need from the app around it; read when a widget is built or clicked, so it is always current. */
export interface EditorHost {
  /** Path of the document in the active tab (null for an unsaved one); relative images resolve against it. */
  docPath(): string | null;
  /** A thread marker was clicked: `ordinal` is its place among the markers sharing the thread's id. */
  openThread(id: string, ordinal: number): void;
}

const NONE: EditorHost = { docPath: () => null, openThread: () => {} };

export const editorHost = Facet.define<EditorHost, EditorHost>({ combine: (hosts) => hosts[0] ?? NONE });
