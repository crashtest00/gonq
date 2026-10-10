import { vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
const writeTextFile = vi.fn();
const readFile = vi.fn();
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: (...a: unknown[]) => readFile(...a), writeTextFile: (...a: unknown[]) => writeTextFile(...a) }));

vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

import { NotUtf8Error, files } from './files';
import { ListDirectoryError, listDirectory, pathExists } from './folders';
import {
  RemoteConflictError,
  RemoteFileError,
  remoteAccount,
  remoteErrorMessage,
  remoteHost,
  setConnectHandler,
  type RemoteErrorKind,
} from './remote';

const URI = 'ssh://me@nas/home/me/notes.md';

function payload(text: string | Uint8Array, mtime = 100, size = 7): ArrayBuffer {
  const body = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, mtime);
  view.setBigUint64(4, BigInt(size));
  out.set(body, 12);
  return out.buffer;
}

beforeEach(() => {
  invoke.mockReset();
  readFile.mockReset();
  writeTextFile.mockReset();
  setConnectHandler(null);
});

describe('openPath', () => {
  it('routes ssh:// to remote_read, keeping the text and the server stat exactly', async () => {
    const text = '﻿# Hi\r\n\r\nthere  \r\n';
    invoke.mockResolvedValue(payload(text, 1700000000, 4242));
    const doc = await files.openPath!(URI);
    expect(invoke).toHaveBeenCalledWith('remote_read', { uri: URI });
    expect(doc).toEqual({ name: 'notes.md', path: URI, text, remote: { mtime: 1700000000, size: 4242 } });
    expect(readFile).not.toHaveBeenCalled();
  });
  it('refuses non-UTF-8 like a local file', async () => {
    invoke.mockResolvedValue(payload(new Uint8Array([0x23, 0xff, 0xfe])));
    await expect(files.openPath!(URI)).rejects.toThrow(NotUtf8Error);
  });
  it('keeps local paths on the local fs', async () => {
    readFile.mockResolvedValue(new TextEncoder().encode('# x'));
    invoke.mockResolvedValue(undefined);
    await files.openPath!('/tmp/x.md');
    expect(readFile).toHaveBeenCalledWith('/tmp/x.md');
    expect(invoke).not.toHaveBeenCalledWith('remote_read', expect.anything());
  });
});

describe('saveDocument', () => {
  const doc = { name: 'notes.md', path: URI, text: '# Hi\r\n  ', remote: { mtime: 5, size: 6 } };
  it('sends the text unchanged with the stat the tab holds, and returns the new stat', async () => {
    invoke.mockResolvedValue({ status: 'saved', stat: { mtime: 9, size: 10 }, in_place: false, warn: false });
    const saved = await files.saveDocument(doc);
    expect(invoke).toHaveBeenCalledWith('remote_write', { uri: URI, text: '# Hi\r\n  ', expected: { mtime: 5, size: 6 }, force: false });
    expect(saved).toMatchObject({ name: 'notes.md', path: URI, remote: { mtime: 9, size: 10 } });
    expect(saved?.inPlaceHost).toBeUndefined();
    expect(writeTextFile).not.toHaveBeenCalled();
  });
  it('reports the first in-place save so the app can warn once', async () => {
    invoke.mockResolvedValue({ status: 'saved', stat: { mtime: 9, size: 10 }, in_place: true, warn: true });
    expect((await files.saveDocument(doc))?.inPlaceHost).toBe(URI);
  });
  it('throws a conflict, and Overwrite retries with force', async () => {
    invoke.mockResolvedValueOnce({ status: 'conflict', deleted: false, current: { mtime: 8, size: 6 } });
    await expect(files.saveDocument(doc)).rejects.toMatchObject({ name: 'RemoteConflictError', deleted: false });
    invoke.mockResolvedValueOnce({ status: 'saved', stat: { mtime: 9, size: 10 }, in_place: false, warn: false });
    await files.saveDocument(doc, undefined, { force: true });
    expect(invoke).toHaveBeenLastCalledWith('remote_write', expect.objectContaining({ force: true }));
  });
  it('words a deleted file differently', () => {
    expect(new RemoteConflictError('notes.md', true).message).toBe('notes.md was deleted on the server since you opened it.');
    expect(new RemoteConflictError('notes.md', false).message).toBe('notes.md changed on the server since you opened it.');
  });
  it('waits for the Connect flow on auth_required, then saves', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    setConnectHandler(handler);
    invoke.mockRejectedValueOnce({ kind: 'auth_required', message: 'me@nas' });
    invoke.mockResolvedValueOnce({ status: 'saved', stat: { mtime: 9, size: 10 }, in_place: false, warn: false });
    await files.saveDocument(doc);
    expect(handler).toHaveBeenCalledWith(URI);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('gives up with a sentence when Connect is cancelled or absent', async () => {
    invoke.mockRejectedValue({ kind: 'auth_required', message: 'me@nas' });
    await expect(files.saveDocument(doc)).rejects.toBeInstanceOf(RemoteFileError);
    setConnectHandler(async () => false);
    await expect(files.saveDocument(doc)).rejects.toMatchObject({ kind: 'auth_required' });
  });
  it('a dropped connection says so, naming the host', async () => {
    invoke.mockRejectedValue({ kind: 'disconnected', message: 'gone' });
    await expect(files.saveDocument(doc)).rejects.toThrow("Couldn't save to nas: connection lost.");
  });
  it('Save As is the local dialog', async () => {
    const { save } = await import('@tauri-apps/plugin-dialog');
    (save as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await files.saveDocumentAs({ name: 'notes.md', text: 'x' })).toBeNull();
    expect(save).toHaveBeenCalled();
  });
});

describe('loadImage', () => {
  it('is null for relative images in remote documents', async () => {
    expect(await files.loadImage({ name: 'a.md', path: URI, text: '' }, 'img/a.png')).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe('every RemoteError kind has a sentence naming host and file', () => {
  const kinds: RemoteErrorKind[] = [
    'unreachable',
    'auth_required',
    'host_key_changed',
    'disconnected',
    'not_found',
    'permission_denied',
    'not_a_folder',
    'not_allowed',
    'io',
  ];
  for (const op of ['open', 'save', 'list'] as const) {
    for (const kind of kinds) {
      it(`${op}/${kind}`, () => {
        const msg = remoteErrorMessage(kind, op, URI, 'detail');
        expect(msg).toContain('nas');
        if (kind !== 'unreachable' || op === 'save') expect(msg).toContain(kind === 'not_a_folder' || op !== 'list' ? 'notes.md' : 'nas');
        expect(msg).not.toMatch(/undefined|\[object/);
      });
    }
  }
  it('uses the example wording', () => {
    expect(remoteErrorMessage('disconnected', 'save', URI)).toMatch(/^Couldn't save to nas: connection lost\./);
    expect(remoteErrorMessage('not_allowed', 'open', URI)).toContain('Markdown');
    expect(remoteErrorMessage('unreachable', 'open', URI)).toBe("Couldn't reach nas. notes.md was not opened.");
  });
  it('a failed open maps the Rust error', async () => {
    invoke.mockRejectedValue({ kind: 'not_found', message: 'x' });
    await expect(files.openPath!(URI)).rejects.toThrow('Couldn\'t open notes.md on nas: notes.md was not found.');
  });
});

describe('folders', () => {
  it('lists ssh:// through remote_list_directory', async () => {
    invoke.mockResolvedValue([{ name: 'a.md', path: 'ssh://me@nas/d/a.md', is_dir: false }]);
    expect(await listDirectory('ssh://me@nas/d')).toEqual([{ name: 'a.md', path: 'ssh://me@nas/d/a.md', isDir: false }]);
    expect(invoke).toHaveBeenCalledWith('remote_list_directory', { uri: 'ssh://me@nas/d' });
  });
  it('maps disconnected to "Lost connection to <host>." and carries the kind', async () => {
    invoke.mockRejectedValue({ kind: 'disconnected', message: 'x' });
    await expect(listDirectory('ssh://me@nas/d')).rejects.toMatchObject({ kind: 'disconnected', message: 'Lost connection to nas.' });
    invoke.mockRejectedValue({ kind: 'auth_required', message: 'me@nas' });
    await expect(listDirectory('ssh://me@nas/d')).rejects.toBeInstanceOf(ListDirectoryError);
  });
  it('pathExists routes to remote_exists', async () => {
    invoke.mockResolvedValue(false);
    expect(await pathExists(URI)).toBe(false);
    expect(invoke).toHaveBeenCalledWith('remote_exists', { uri: URI });
  });
  it('local paths still use list_directory / path_exists', async () => {
    invoke.mockResolvedValue([]);
    await listDirectory('/docs');
    expect(invoke).toHaveBeenCalledWith('list_directory', { path: '/docs' });
    await pathExists('/docs');
    expect(invoke).toHaveBeenCalledWith('path_exists', { path: '/docs' });
  });
});

test('host and account labels', () => {
  expect(remoteHost('ssh://me@nas:2222/a.md')).toBe('nas:2222');
  expect(remoteAccount('ssh://me@nas/a.md')).toBe('me@nas');
});
