/** SSH platform code under __GONQ_APP__ = 'mobile': every ssh:// call fails with CONNECT_UNAVAILABLE_MOBILE and never reaches a command; desktop is unchanged. */
import { vi } from 'vitest';

const invoke = vi.fn();
vi.mock('./bindings', async () => (await import('../testing/mockBindings')).bindingsMock((...a: [string, Record<string, unknown>?]) => invoke(...a)));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
const readFile = vi.fn();
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: (...a: unknown[]) => readFile(...a), writeTextFile: vi.fn() }));

vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

import { CONNECT_UNAVAILABLE_MOBILE } from './app';
import { CONNECT_UNAVAILABLE, assertConnectAvailable, parseConnectInput, remoteUri, sshPathOf, CONNECT_UNAVAILABLE_MOBILE as reExported } from './connect';
import { files } from './files';
import { listDirectory, ListDirectoryError, pathExists } from './folders';
import { loadImage } from './images';
import { listRecents } from './recents';
import { RemoteFileError, isSshPath, parseSshPath, remoteExists, remoteHost, remoteRead, remoteWrite, setConnectHandler, withConnect } from './remote';

const URI = 'ssh://me@nas/home/me/notes.md';
const MSG = 'Connecting to a server is not part of the Gonq mobile app.';

beforeEach(() => {
  invoke.mockReset();
  readFile.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('mobile', () => {
  beforeEach(() => vi.stubGlobal('__GONQ_APP__', 'mobile'));

  it('assertConnectAvailable throws the mobile message, exported from connect.ts', () => {
    expect(reExported).toBe(CONNECT_UNAVAILABLE_MOBILE);
    expect(() => assertConnectAvailable()).toThrow(MSG);
  });

  it('leaves the pure helpers unchanged', () => {
    expect(parseConnectInput('ssh://me@nas/home/me')).toEqual({ target: 'me@nas', path: '/home/me' });
    expect(remoteUri('me@nas', '/a%b')).toBe('ssh://me@nas/a%25b');
    expect(sshPathOf('ssh://me@nas/a%25b')).toBe('/a%b');
    expect(isSshPath(URI)).toBe(true);
    expect(parseSshPath(URI)).toEqual({ user: 'me', host: 'nas', port: null, file: 'notes.md' });
    expect(remoteHost(URI)).toBe('nas');
  });

  async function unavailable(p: Promise<unknown>): Promise<RemoteFileError> {
    const e = await p.then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(RemoteFileError);
    expect((e as RemoteFileError).kind).toBe('unavailable');
    expect((e as RemoteFileError).message).toBe(MSG);
    return e as RemoteFileError;
  }

  it('remoteRead, remoteWrite, remoteExists and withConnect throw RemoteFileError "unavailable"', async () => {
    await unavailable(remoteRead(URI));
    await unavailable(remoteWrite(URI, 'x', { mtime: 1, size: 1 }, false));
    await unavailable(remoteExists(URI));
    await unavailable(withConnect(URI, 'open', async () => 1));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not offer the Connect handler a retry', async () => {
    const handler = vi.fn(async () => true);
    const off = setConnectHandler(handler);
    await unavailable(remoteRead(URI));
    off();
    expect(handler).not.toHaveBeenCalled();
  });

  it('opening an ssh:// path fails with the error, never a crash', async () => {
    await unavailable(files.openPath(URI));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('saving an ssh:// document fails with the error', async () => {
    await unavailable(files.saveDocument({ name: 'notes.md', path: URI, text: 'x', remote: { mtime: 1, size: 1 } }, new Set()));
  });

  it('listing an ssh:// folder fails with a ListDirectoryError carrying the message', async () => {
    const e = await listDirectory('ssh://me@nas/home/me').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ListDirectoryError);
    expect((e as ListDirectoryError).kind).toBe('unavailable');
    expect((e as ListDirectoryError).message).toBe(MSG);
  });

  it('pathExists on an ssh:// path fails with the error', async () => {
    await unavailable(pathExists(URI));
  });

  it('loading an image next to an ssh:// document fails with the error', async () => {
    await unavailable(loadImage('pic.png', URI));
    expect(readFile).not.toHaveBeenCalled();
  });

  it('opening an ssh:// recent shows the same error', async () => {
    invoke.mockImplementation(async (cmd: string) => (cmd === 'recent_documents_list' ? [{ path: URI, opened_at: 5 }] : undefined));
    const recent = (await listRecents())[0];
    expect(recent.path).toBe(URI);
    await unavailable(files.openPath(recent.path));
  });
});

describe('desktop (default)', () => {
  it('keeps the web message and the ssh:// behaviour', async () => {
    expect(CONNECT_UNAVAILABLE).toBe('Connecting to a server needs the desktop app.');
    expect(() => assertConnectAvailable()).not.toThrow();
    invoke.mockRejectedValue({ kind: 'not_found' });
    const e = await remoteRead(URI).catch((x: unknown) => x);
    expect((e as RemoteFileError).kind).toBe('not_found');
    expect(invoke).toHaveBeenCalled();
  });

  it('is not changed by an explicit "desktop"', async () => {
    vi.stubGlobal('__GONQ_APP__', 'desktop');
    invoke.mockResolvedValue(true);
    expect(await remoteExists(URI)).toBe(true);
  });
});
