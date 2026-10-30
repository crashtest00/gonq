/**
 * renderApp: renders <App/> with fake file access and a user-event session, the setup App.test.tsx and
 * App.edit.test.tsx build by hand; plus menu() and openDocument() to drive File > Open. Use it for new
 * App-level tests in a per-feature file.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from '../App';
import type { FileAccess, OpenedDocument } from '@gonq/editor/platform/files';

export type User = ReturnType<typeof userEvent.setup>;

export interface RenderAppOptions {
  /**
   * What File > Open… returns: one document (returned every time) or a queue (one per pick, then a cancel).
   * Default: none, so File > Open… behaves as a cancelled dialog.
   */
  docs?: OpenedDocument | OpenedDocument[];
  /** Replaces any of the fake file-access functions. */
  files?: Partial<FileAccess>;
}

/** An opened document named after the last segment of `path`. */
export function testDoc(text: string, path: string | null = '/d/a.md'): OpenedDocument {
  return { name: path ? path.slice(path.lastIndexOf('/') + 1) : 'Untitled.md', path, text };
}

/**
 * Renders the whole app. Save writes to the document's own path (or /d/new.md for one without);
 * Save As writes /d/copy.md. Both are vi.fn()s, so tests can read what was saved from their calls.
 *
 * Module mocks (e.g. vi.mock('@gonq/editor/platform/lifecycle') to capture the window-close guard) are hoisted
 * per test file, so they stay in the test file.
 */
export function renderApp({ docs, files: overrides = {} }: RenderAppOptions = {}) {
  const queue = Array.isArray(docs) ? [...docs] : null;
  const single = Array.isArray(docs) ? null : docs ?? null;
  const pickDocument = vi.fn(async (): Promise<OpenedDocument | null> => (queue ? queue.shift() ?? null : single));
  const saveDocument = vi.fn(async (d: { name: string; path: string | null }) => ({ name: d.name, path: d.path ?? '/d/new.md' }));
  const saveDocumentAs = vi.fn(async () => ({ name: 'copy.md', path: '/d/copy.md' }));
  const files: FileAccess = { pickDocument, saveDocument, saveDocumentAs, ...overrides };
  const user = userEvent.setup();
  const result = render(<App files={files} />);
  return { ...result, user, files, pickDocument, saveDocument, saveDocumentAs };
}

/** Opens a top-level menu and picks an item, e.g. menu(user, 'File', /^Save As/). */
export async function menu(user: User, bar: string, item: string | RegExp) {
  await user.click(screen.getByRole('menuitem', { name: bar }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

/** File > Open…, then waits for the editor to show the document. */
export async function openDocument(user: User) {
  await menu(user, 'File', /^Open…/);
  return screen.findByTestId('editor');
}

/** The text of the last saved document, from renderApp's saveDocument (or saveDocumentAs) mock. */
export function lastSaved(save: { mock: { calls: unknown[][] } }): string | undefined {
  const call = save.mock.calls[save.mock.calls.length - 1];
  return (call?.[0] as { text?: string } | undefined)?.text;
}
