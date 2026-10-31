/**
 * The mobile document session: <DocumentProvider/> runs the shared useDocumentController (files from the platform
 * seam, errors and notices into the shell's banner) and useDocuments() hands it to screens. Unsaved-changes and
 * conflict questions answer "cancel" until their dialogs arrive (M-28). runFileCommand(id, ctx) runs a registry
 * command by id (File > New for the "+" button) without adding any command.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { registry, type CommandContext } from '@gonq/editor/commands';
import { useDocumentController } from '@gonq/editor/controllers/document';
import { files } from '@gonq/editor/platform/files';
import { useNotices } from './notices';

export type Documents = ReturnType<typeof useDocumentController>;

const DocumentsContext = createContext<Documents | null>(null);

export function DocumentProvider({ children }: { children: ReactNode }) {
  const { setError, setNotice } = useNotices();
  const doc = useDocumentController({
    files,
    confirmUnsaved: () => Promise.resolve('cancel'),
    confirmConflict: () => Promise.resolve('cancel'),
    onError: setError,
    onNotice: setNotice,
    onSaving: () => {},
  });
  return <DocumentsContext.Provider value={doc}>{children}</DocumentsContext.Provider>;
}

export function useDocuments(): Documents {
  const ctx = useContext(DocumentsContext);
  if (!ctx) throw new Error('useDocuments needs a <DocumentProvider>');
  return ctx;
}

/** Runs the registered command `id` with the parts of the context it reads; throws when no such command exists. */
export function runFileCommand(id: string, ctx: Partial<CommandContext>): void {
  const command = registry.commands().find((c) => c.id === id);
  if (command === undefined) throw new Error(`Unknown command ${id}`);
  void command.run?.(ctx as CommandContext);
}
