/** The keyboard shortcuts generated from the command registry, through the whole app: each key in the document and no-document states, outside and inside the editor, with Ctrl and Cmd. */
import { fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { lastSaved, openDocument, renderApp, testDoc, type User } from '../testing/renderApp';
import { caretAt, docText, editorView, type as typeText } from '../testing/editor';

vi.setConfig({ testTimeout: 30000 });
vi.mock('../platform/lifecycle', () => ({ guardClose: () => () => {} }));

beforeEach(() => localStorage.clear());

const TEXT = 'first paragraph\n\nlast paragraph';
const tabs = () => screen.queryAllByRole('tab');

type Mod = 'ctrlKey' | 'metaKey';
/** Presses a shortcut on `target`; returns false when the app called preventDefault. */
const press = (key: string, mod: Mod = 'ctrlKey', extra: KeyboardEventInit = {}, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, [mod]: true, ...extra });

/** A document opened and then edited (so Undo has something to undo). */
async function editedDoc(user: User, r: ReturnType<typeof renderApp>) {
  await openDocument(user);
  caretAt('last paragraph');
  typeText('!');
  expect(docText()).toBe(TEXT + '!');
  (document.activeElement as HTMLElement | null)?.blur();
  return r;
}

describe.each([['Ctrl', 'ctrlKey'], ['Cmd', 'metaKey']] as const)('%s shortcuts with no document open', (_, mod) => {
  test('Ctrl+N opens an untitled tab', () => {
    renderApp();
    expect(press('n', mod)).toBe(false);
    expect(tabs()).toHaveLength(1);
  });

  test('Ctrl+O asks to pick a document', async () => {
    const { pickDocument } = renderApp({ docs: testDoc(TEXT) });
    expect(press('o', mod)).toBe(false);
    await screen.findByTestId('editor');
    expect(pickDocument).toHaveBeenCalledTimes(1);
  });

  test('Ctrl+Shift+K runs Connect to Server, which says the desktop app is needed on the web', async () => {
    renderApp();
    expect(press('K', mod, { shiftKey: true })).toBe(false);
    expect(await screen.findByRole('alert')).toHaveTextContent('Connecting to a server needs the desktop app.');
  });

  test('Ctrl+, opens Settings', async () => {
    renderApp();
    expect(press(',', mod)).toBe(false);
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  test('Save, Save As, Close Tab, Undo and Redo keys do nothing without a document', () => {
    const { saveDocument, saveDocumentAs } = renderApp();
    for (const [key, extra] of [['s', {}], ['S', { shiftKey: true }], ['w', {}], ['z', {}], ['y', {}], ['Z', { shiftKey: true }]] as const) press(key, mod, extra);
    expect(saveDocument).not.toHaveBeenCalled();
    expect(saveDocumentAs).not.toHaveBeenCalled();
    expect(tabs()).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe.each([['Ctrl', 'ctrlKey'], ['Cmd', 'metaKey']] as const)('%s shortcuts with a document, outside the editor', (_, mod) => {
  test('Ctrl+S saves the document and Ctrl+Shift+S saves it as', async () => {
    const r = renderApp({ docs: testDoc(TEXT) });
    await editedDoc(r.user, r);
    expect(press('s', mod)).toBe(false);
    await vi.waitFor(() => expect(r.saveDocument).toHaveBeenCalledTimes(1));
    expect(lastSaved(r.saveDocument)).toBe(TEXT + '!');
    expect(press('S', mod, { shiftKey: true })).toBe(false);
    await vi.waitFor(() => expect(r.saveDocumentAs).toHaveBeenCalledTimes(1));
  });

  test('Ctrl+W closes the active tab; Ctrl+N and Ctrl+O add tabs', async () => {
    const r = renderApp({ docs: [testDoc(TEXT, '/d/a.md'), testDoc('other', '/d/b.md')] });
    await openDocument(r.user);
    press('o', mod);
    await vi.waitFor(() => expect(tabs()).toHaveLength(2));
    press('n', mod);
    await vi.waitFor(() => expect(tabs()).toHaveLength(3));
    press('w', mod);
    await vi.waitFor(() => expect(tabs()).toHaveLength(2));
  });

  test('Ctrl+Z undoes, then Ctrl+Y and Ctrl+Shift+Z redo, in the editor', async () => {
    const r = renderApp({ docs: testDoc(TEXT) });
    await editedDoc(r.user, r);
    press('z', mod);
    expect(docText()).toBe(TEXT);
    press('y', mod);
    expect(docText()).toBe(TEXT + '!');
    press('z', mod);
    expect(docText()).toBe(TEXT);
    press('Z', mod, { shiftKey: true });
    expect(docText()).toBe(TEXT + '!');
  });

  test('Alt with the key runs nothing', async () => {
    const r = renderApp({ docs: testDoc(TEXT) });
    await openDocument(r.user);
    expect(press('s', mod, { altKey: true })).toBe(true);
    expect(r.saveDocument).not.toHaveBeenCalled();
  });
});

describe('shortcuts inside the editor', () => {
  test('Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z are CodeMirror history, once each', async () => {
    const r = renderApp({ docs: testDoc(TEXT) });
    await openDocument(r.user);
    caretAt('last paragraph');
    typeText('!');
    editorView().focus();
    await r.user.keyboard('{Control>}z{/Control}');
    expect(docText()).toBe(TEXT);
    await r.user.keyboard('{Control>}y{/Control}');
    expect(docText()).toBe(TEXT + '!');
    await r.user.keyboard('{Control>}z{/Control}');
    await r.user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(docText()).toBe(TEXT + '!');
  });

  test('Ctrl+S, Ctrl+Shift+S, Ctrl+N and Ctrl+W still work with the editor focused', async () => {
    const r = renderApp({ docs: testDoc(TEXT) });
    await openDocument(r.user);
    editorView().focus();
    await r.user.keyboard('{Control>}s{/Control}');
    expect(r.saveDocument).toHaveBeenCalledTimes(1);
    await r.user.keyboard('{Control>}{Shift>}s{/Shift}{/Control}');
    expect(r.saveDocumentAs).toHaveBeenCalledTimes(1);
    await r.user.keyboard('{Control>}n{/Control}');
    expect(tabs()).toHaveLength(2);
    await r.user.keyboard('{Control>}w{/Control}');
    expect(tabs()).toHaveLength(1);
  });
});

test('Ctrl+S with the Settings dialog open still saves, as before', async () => {
  const r = renderApp({ docs: testDoc(TEXT) });
  await openDocument(r.user);
  press(',');
  const dialog = await screen.findByRole('dialog', { name: 'Settings' });
  expect(dialog).toBeInTheDocument();
  await r.user.keyboard('{Control>}s{/Control}');
  expect(r.saveDocument).toHaveBeenCalledTimes(1);
});
