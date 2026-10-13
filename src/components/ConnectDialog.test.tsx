import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import App from '../App';
import { ConnectDialog } from './ConnectDialog';
import { RECENT_FOLDERS_KEY, parseConnectInput } from '../platform/connect';
import { RemoteFileError, setConnectHandler, withConnect } from '../platform/remote';
import type { FileAccess } from '../platform/files';

vi.setConfig({ testTimeout: 30000 });

const invoke = vi.fn();
vi.mock('../platform/lifecycle', () => ({ guardClose: () => () => {} }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
const calls = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd).map((c) => c[1] as Record<string, unknown>);

const connected = { kind: 'connected', home: '/home/me', authority: 'me@nas' };
const tree: Record<string, string[]> = {
  '/home/me': ['docs', 'notes'],
  '/home/me/docs': ['drafts'],
  '/home/me/docs/drafts': [],
  '/home/me/notes': [],
  '/': ['home'],
  '/home': ['me'],
};
function listFoldersImpl({ uri }: Record<string, unknown>) {
  const path = String(uri).replace('ssh://me@nas', '');
  if (path === '/home/me/file.md') throw { kind: 'not_a_folder', message: path };
  if (!(path in tree)) throw { kind: 'not_found', message: path };
  return { uri: String(uri), folders: tree[path] };
}

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  invoke.mockReset();
  handlers = {
    ssh_list_hosts: () => ['nas', 'work'],
    ssh_connect: () => connected,
    ssh_disconnect: () => undefined,
    remote_list_folders: listFoldersImpl,
    remote_open_root: () => undefined,
    remote_list_directory: () => [],
  };
  invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    const h = handlers[cmd];
    if (!h) throw new Error(`unmocked ${cmd}`);
    return h(args);
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  setConnectHandler(null);
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

function renderDialog(props: Partial<React.ComponentProps<typeof ConnectDialog>> = {}) {
  const onOpened = vi.fn();
  const onClose = vi.fn();
  const inUse = vi.fn(() => false);
  const user = userEvent.setup();
  render(<ConnectDialog inUse={inUse} onOpened={onOpened} onClose={onClose} {...props} />);
  return { user, onOpened, onClose, inUse };
}
async function connectTo(user: ReturnType<typeof userEvent.setup>, text = 'me@nas') {
  await user.type(screen.getByLabelText('Host'), text);
  await user.click(screen.getByRole('button', { name: 'Connect' }));
}

test('parseConnectInput takes user@host, aliases and ssh:// URIs with a folder', () => {
  expect(parseConnectInput(' me@nas ')).toEqual({ target: 'me@nas', path: null });
  expect(parseConnectInput('nas')).toEqual({ target: 'nas', path: null });
  expect(parseConnectInput('ssh://me@nas:2222/home/me/docs')).toEqual({ target: 'me@nas:2222', path: '/home/me/docs' });
  expect(parseConnectInput('ssh://me@nas/')).toEqual({ target: 'me@nas', path: null });
  expect(parseConnectInput('ssh://me@nas/a%25b')).toEqual({ target: 'me@nas', path: '/a%b' });
});

describe('step 1: choose a host', () => {
  test('lists the hosts from ssh config and connects when one is clicked', async () => {
    const { user } = renderDialog();
    await user.click(await screen.findByRole('button', { name: 'work' }));
    expect(calls('ssh_connect')[0]).toEqual({ target: 'work', answers: {} });
  });
  test('no named hosts (missing or wildcard-only config) says so and still takes typed input', async () => {
    handlers.ssh_list_hosts = () => [];
    const { user } = renderDialog();
    expect(await screen.findByText(/No named hosts found/)).toBeInTheDocument();
    await connectTo(user);
    expect(await screen.findByLabelText(/Folder on/)).toBeInTheDocument();
  });
  test('an unreadable host list is treated as empty', async () => {
    handlers.ssh_list_hosts = () => {
      throw 'boom';
    };
    renderDialog();
    expect(await screen.findByText(/No named hosts found/)).toBeInTheDocument();
  });
  test('Connect is disabled for a blank field', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });
  test('a pasted ssh:// URI with a folder opens that folder in the picker', async () => {
    const { user } = renderDialog();
    await connectTo(user, 'ssh://me@nas/home/me/docs');
    expect(await screen.findByDisplayValue('/home/me/docs')).toBeInTheDocument();
    expect(calls('ssh_connect')[0].target).toBe('me@nas');
    expect(screen.getByText('drafts')).toBeInTheDocument();
  });
  test('Cancel closes without a disconnect: nothing was connected', async () => {
    const { user, onClose } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledWith(false);
    expect(calls('ssh_disconnect')).toHaveLength(0);
  });
  test('Escape cancels', async () => {
    const { user, onClose } = renderDialog();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith(false);
  });
});

describe('step 2: connect', () => {
  test('a working saved key connects with no prompt, straight to the picker at home', async () => {
    const { user } = renderDialog();
    await connectTo(user);
    expect(await screen.findByDisplayValue('/home/me')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Password/)).not.toBeInTheDocument();
    expect(calls('ssh_connect')).toHaveLength(1);
    expect(calls('ssh_connect')[0].answers).toEqual({});
  });

  test('shows a spinner while ssh_connect runs; Cancel leaves the unidentified session alone', async () => {
    let release: (v: unknown) => void = () => {};
    handlers.ssh_connect = () => new Promise((r) => (release = r));
    const { user, onClose } = renderDialog();
    await connectTo(user);
    expect(await screen.findByRole('status')).toHaveTextContent('Connecting to me@nas');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledWith(false);
    // The authority is unknown until connected, so nothing is disconnected on a guess.
    expect(calls('ssh_disconnect')).toHaveLength(0);
    release(connected);
    await act(async () => {});
    // The late result does not reopen anything.
    expect(screen.queryByLabelText(/Folder on/)).not.toBeInTheDocument();
  });

  describe('unknown host key', () => {
    beforeEach(() => {
      let trusted = false;
      handlers.ssh_connect = (a) => {
        const answers = a.answers as { trust_fingerprint?: string };
        if (answers.trust_fingerprint === 'SHA256:abc') trusted = true;
        return trusted ? connected : { kind: 'needs_host_key', key_type: 'ssh-ed25519', fingerprint: 'SHA256:abc' };
      };
    });
    test('shows the fingerprint; Trust sends it back and continues', async () => {
      const { user } = renderDialog();
      await connectTo(user);
      expect(await screen.findByText('SHA256:abc')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Trust' }));
      expect(await screen.findByLabelText(/Folder on/)).toBeInTheDocument();
      expect(calls('ssh_connect')[1].answers).toEqual({ trust_fingerprint: 'SHA256:abc' });
    });
    test('Cancel stops; nothing is connected yet, so nothing is disconnected', async () => {
      const { user, onClose } = renderDialog();
      await connectTo(user);
      await screen.findByText('SHA256:abc');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledWith(false);
      expect(calls('ssh_connect')).toHaveLength(1);
      expect(calls('ssh_disconnect')).toHaveLength(0);
    });
  });

  describe('changed host key', () => {
    beforeEach(() => {
      handlers.ssh_connect = () => ({ kind: 'host_key_changed', fingerprint: 'SHA256:new', known_line: '~/.ssh/known_hosts:7' });
    });
    test('warns, names the line to remove, and offers no way to continue', async () => {
      const { user } = renderDialog();
      await connectTo(user);
      expect(await screen.findByRole('alert')).toHaveTextContent(/host key .* has changed/);
      expect(screen.getByText('~/.ssh/known_hosts:7')).toBeInTheDocument();
      expect(screen.getByText('SHA256:new')).toBeInTheDocument();
      const buttons = screen.getAllByRole('button').map((b) => b.textContent);
      expect(buttons).toEqual(['Cancel']);
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(calls('ssh_connect')).toHaveLength(1);
    });
    test('Cancel closes without a disconnect', async () => {
      const { user, onClose } = renderDialog();
      await connectTo(user);
      await screen.findByRole('alert');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledWith(false);
      expect(calls('ssh_disconnect')).toHaveLength(0);
    });
  });

  describe('passphrase', () => {
    beforeEach(() => {
      handlers.ssh_connect = (a) => {
        const answers = a.answers as { passphrase?: string; skip_passphrase?: string[] };
        if (answers.passphrase === 'open sesame' || answers.skip_passphrase?.includes('/home/me/.ssh/id_ed25519')) return connected;
        return { kind: 'needs_passphrase', key_path: '/home/me/.ssh/id_ed25519' };
      };
    });
    test('asks for the key passphrase and sends it', async () => {
      const { user } = renderDialog();
      await connectTo(user);
      expect(await screen.findByLabelText(/Passphrase for \/home\/me\/\.ssh\/id_ed25519/)).toHaveAttribute('type', 'password');
      await user.type(screen.getByLabelText(/Passphrase for/), 'open sesame');
      await user.click(screen.getByRole('button', { name: 'Unlock' }));
      expect(await screen.findByLabelText(/Folder on/)).toBeInTheDocument();
      expect(calls('ssh_connect')[1].answers).toEqual({ passphrase: 'open sesame' });
    });
    test('Skip sends skip_passphrase with the key path', async () => {
      const { user } = renderDialog();
      await connectTo(user);
      await user.click(await screen.findByRole('button', { name: 'Skip' }));
      expect(await screen.findByLabelText(/Folder on/)).toBeInTheDocument();
      expect(calls('ssh_connect')[1].answers).toEqual({ skip_passphrase: ['/home/me/.ssh/id_ed25519'] });
    });
    test('Cancel stops without a disconnect; the passphrase is never stored', async () => {
      const { user, onClose } = renderDialog();
      await connectTo(user);
      await user.type(await screen.findByLabelText(/Passphrase for/), 'secret-phrase');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledWith(false);
      expect(calls('ssh_disconnect')).toHaveLength(0);
      expect(JSON.stringify({ ...localStorage })).not.toContain('secret-phrase');
    });
  });

  describe('password', () => {
    beforeEach(() => {
      let left = 3;
      handlers.ssh_connect = (a) => {
        const answers = a.answers as { password?: string };
        if (answers.password === 'right') return connected;
        if (answers.password !== undefined) left -= 1;
        return left === 0 ? { kind: 'auth_failed', tried: ['ssh-agent', 'password'] } : { kind: 'needs_password', attempts_left: left };
      };
    });
    test('the first prompt shows attempts left; a wrong password shows fewer and says so', async () => {
      const { user } = renderDialog();
      await connectTo(user);
      expect(await screen.findByLabelText('Password for me@nas')).toBeInTheDocument();
      expect(screen.getByText(/3 attempts left/)).toBeInTheDocument();
      expect(screen.queryByText('Wrong password.')).not.toBeInTheDocument();
      await user.type(screen.getByLabelText(/Password for/), 'nope');
      await user.click(screen.getByRole('button', { name: 'Log in' }));
      expect(await screen.findByText('Wrong password.')).toBeInTheDocument();
      expect(screen.getByText(/2 attempts left/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Password for/)).toHaveValue('');
    });
    test('the right password continues to the picker', async () => {
      const { user } = renderDialog();
      await connectTo(user);
      await user.type(await screen.findByLabelText(/Password for/), 'right');
      await user.keyboard('{Enter}');
      expect(await screen.findByLabelText(/Folder on/)).toBeInTheDocument();
      expect(calls('ssh_connect')[1].answers).toEqual({ password: 'right' });
    });
    test('running out of attempts shows AuthFailed with what was tried', async () => {
      const { user } = renderDialog();
      await connectTo(user);
      for (let i = 0; i < 3; i++) {
        await user.type(await screen.findByLabelText(/Password for/), 'bad');
        await user.click(screen.getByRole('button', { name: 'Log in' }));
      }
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't log in to me@nas");
      expect(screen.getByText('ssh-agent')).toBeInTheDocument();
      expect(screen.getByText('password')).toBeInTheDocument();
    });
    test('Cancel stops without a disconnect', async () => {
      const { user, onClose } = renderDialog();
      await connectTo(user);
      await screen.findByLabelText(/Password for/);
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledWith(false);
      expect(calls('ssh_disconnect')).toHaveLength(0);
    });
  });

  test('Unreachable shows the reason; Back returns to the host field with its text', async () => {
    handlers.ssh_connect = () => ({ kind: 'unreachable', reason: 'connection refused' });
    const { user } = renderDialog();
    await connectTo(user);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reach me@nas: connection refused");
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Host')).toHaveValue('me@nas');
  });

  test('Cancel does not disconnect a session an open tab still uses', async () => {
    const inUse = vi.fn(() => true);
    const { user, onClose } = renderDialog({ inUse });
    await connectTo(user);
    await screen.findByLabelText(/Folder on/);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledWith(false);
    expect(inUse).toHaveBeenCalledWith('me@nas');
    expect(calls('ssh_disconnect')).toHaveLength(0);
  });
});

describe('step 3: pick a folder', () => {
  test('browses folders only: double-click enters, Up goes back, Open picks the folder shown', async () => {
    const { user, onOpened, onClose } = renderDialog();
    await connectTo(user);
    await screen.findByDisplayValue('/home/me');
    await user.dblClick(screen.getByRole('button', { name: 'docs' }));
    expect(await screen.findByDisplayValue('/home/me/docs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'drafts' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Up' }));
    await screen.findByDisplayValue('/home/me');
    await user.dblClick(screen.getByRole('button', { name: 'docs' }));
    await screen.findByDisplayValue('/home/me/docs');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(calls('remote_open_root')).toEqual([{ uri: 'ssh://me@nas/home/me/docs' }]);
    expect(onOpened).toHaveBeenCalledWith('ssh://me@nas/home/me/docs');
    expect(JSON.parse(localStorage.getItem(RECENT_FOLDERS_KEY)!)).toEqual(['ssh://me@nas/home/me/docs']);
  });

  test.each([
    ['..', '..', '/home'],
    ['a relative name', 'docs', '/home/me/docs'],
    ['~/x', '~/docs', '/home/me/docs'],
    ['~', '~', '/home/me'],
  ])('a typed %s is resolved to an absolute path on the same host', async (_n, typed, expected) => {
    const { user } = renderDialog();
    await connectTo(user);
    const path = await screen.findByDisplayValue('/home/me');
    await user.clear(path);
    await user.type(path, `${typed}{Enter}`);
    await screen.findByDisplayValue(expected);
    const uris = calls('remote_list_folders').map((c) => c.uri);
    expect(uris[uris.length - 1]).toBe(`ssh://me@nas${expected}`);
    expect(uris.every((u) => String(u).startsWith('ssh://me@nas/'))).toBe(true);
  });

  test('a single click does not enter a folder', async () => {
    const { user } = renderDialog();
    await connectTo(user);
    await screen.findByDisplayValue('/home/me');
    await user.click(screen.getByRole('button', { name: 'docs' }));
    expect(screen.getByDisplayValue('/home/me')).toBeInTheDocument();
  });

  test('the path field goes to a typed folder; nonexistent and not-a-folder paths show a message and keep the listing', async () => {
    const { user } = renderDialog();
    await connectTo(user);
    const path = await screen.findByDisplayValue('/home/me');
    await user.clear(path);
    await user.type(path, '/nope{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('There is no folder /nope.');
    expect(screen.getByRole('button', { name: 'docs' })).toBeInTheDocument();
    await user.clear(path);
    await user.type(path, '/home/me/file.md{Enter}');
    expect(await screen.findByText('/home/me/file.md is not a folder.')).toBeInTheDocument();
    await user.clear(path);
    await user.type(path, '/home/me/docs{Enter}');
    expect(await screen.findByRole('button', { name: 'drafts' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('Up is disabled at the root', async () => {
    const { user } = renderDialog();
    await connectTo(user, 'ssh://me@nas/');
    await screen.findByDisplayValue('/home/me');
    const path = screen.getByDisplayValue('/home/me');
    await user.clear(path);
    await user.type(path, '/{Enter}');
    await screen.findByRole('button', { name: 'home' });
    expect(screen.getByRole('button', { name: 'Up' })).toBeDisabled();
  });

  test('a pasted folder that does not exist falls back to home with a message', async () => {
    const { user } = renderDialog();
    await connectTo(user, 'ssh://me@nas/gone');
    expect(await screen.findByDisplayValue('/home/me')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('There is no folder /gone. Showing your home folder instead.');
  });

  test('a pasted file path starts in its folder', async () => {
    const { user } = renderDialog();
    await connectTo(user, 'ssh://me@nas/home/me/file.md');
    expect(await screen.findByDisplayValue('/home/me')).toBeInTheDocument();
  });

  test('starts in the last folder used on this host', async () => {
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(['ssh://me@nas/home/me/docs']));
    const { user } = renderDialog();
    await connectTo(user);
    expect(await screen.findByDisplayValue('/home/me/docs')).toBeInTheDocument();
  });

  test('a very large directory shows the first 200 rows and reveals more on request', async () => {
    const many = Array.from({ length: 450 }, (_, i) => `d${String(i).padStart(3, '0')}`);
    handlers.remote_list_folders = ({ uri }) => ({ uri, folders: many });
    const { user } = renderDialog();
    await connectTo(user);
    const list = await screen.findByRole('list', { name: 'Folders' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(201);
    await user.click(screen.getByRole('button', { name: 'Show more (250 more)' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(401);
  });

  test('a connection that drops while browsing offers Reconnect, which returns to the same folder', async () => {
    const { user } = renderDialog();
    await connectTo(user);
    await screen.findByDisplayValue('/home/me');
    handlers.remote_list_folders = (a) => {
      handlers.remote_list_folders = listFoldersImpl;
      throw { kind: 'disconnected', message: 'me@nas' };
    };
    await user.dblClick(screen.getByRole('button', { name: 'docs' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Lost the connection');
    await user.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(await screen.findByDisplayValue('/home/me')).toBeInTheDocument();
    expect(calls('ssh_connect')).toHaveLength(2);
  });

  test('Cancel closes without a disconnect', async () => {
    const { user, onClose } = renderDialog();
    await connectTo(user);
    await screen.findByDisplayValue('/home/me');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledWith(false);
    expect(calls('ssh_disconnect')).toEqual([{ host: 'me@nas' }]);
    expect(calls('remote_open_root')).toHaveLength(0);
  });

  test('a failed Open stays in the picker with the reason', async () => {
    handlers.remote_open_root = () => {
      throw { kind: 'permission_denied', message: 'x' };
    };
    const { user, onClose } = renderDialog();
    await connectTo(user);
    await screen.findByDisplayValue('/home/me');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied for /home/me.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
  });
});

describe('recent folders', () => {
  const recent = 'ssh://me@nas/home/me/docs';
  beforeEach(() => localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify([recent, 'ssh://you@other:2222/srv'])));

  test('lists host + folder; choosing one reconnects straight to its folder, skipping the picker', async () => {
    const { user, onOpened, onClose } = renderDialog();
    const entry = await screen.findByRole('button', { name: /me@nas\s*\/home\/me\/docs/ });
    expect(screen.getByRole('button', { name: /you@other:2222\s*\/srv/ })).toBeInTheDocument();
    await user.click(entry);
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(calls('ssh_connect')[0].target).toBe('me@nas');
    expect(calls('list_folders')).toHaveLength(0);
    expect(calls('remote_list_folders')).toHaveLength(0);
    expect(calls('remote_open_root')).toEqual([{ uri: recent }]);
    expect(onOpened).toHaveBeenCalledWith(recent);
  });

  test('a recent entry still asks for a host key or password when the server needs it', async () => {
    handlers.ssh_connect = (a) => ((a.answers as { password?: string }).password ? connected : { kind: 'needs_password', attempts_left: 3 });
    const { user, onClose } = renderDialog();
    await user.click(await screen.findByRole('button', { name: /me@nas\s*\/home\/me\/docs/ }));
    await user.type(await screen.findByLabelText(/Password for/), 'pw');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(calls('remote_open_root')).toEqual([{ uri: recent }]);
  });

  test('a recent folder that is gone opens the picker with a message instead', async () => {
    handlers.remote_open_root = () => {
      throw { kind: 'not_found', message: recent };
    };
    const { user, onClose } = renderDialog();
    await user.click(await screen.findByRole('button', { name: /me@nas\s*\/home\/me\/docs/ }));
    expect(await screen.findByLabelText(/Folder on/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't open that folder: There is no folder /home/me/docs.");
    expect(onClose).not.toHaveBeenCalled();
  });

  test('keeps at most the 5 newest', async () => {
    const { user } = renderDialog();
    await connectTo(user);
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) {
      handlers.remote_list_folders = ({ uri }) => ({ uri, folders: [] });
      const path = await screen.findByLabelText(/^Folder on/ , { selector: 'input' });
      await user.clear(path);
      await user.type(path, `/${n}{Enter}`);
      await screen.findByDisplayValue(`/${n}`);
      if (n === 'f') await user.click(screen.getByRole('button', { name: 'Open' }));
    }
    expect(JSON.parse(localStorage.getItem(RECENT_FOLDERS_KEY)!).length).toBeLessThanOrEqual(5);
  });
});

describe('Cancel while the folder is opening', () => {
  test('on the opening step a recent entry is not opened: no root, no recent, one close, session released', async () => {
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(['ssh://me@nas/home/me/docs']));
    let release: () => void = () => {};
    handlers.remote_open_root = () => new Promise<void>((r) => (release = r));
    const { user, onOpened, onClose } = renderDialog();
    await user.click(await screen.findByRole('button', { name: /me@nas\s*\/home\/me\/docs/ }));
    await screen.findByText('Opening the folder…');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls('ssh_disconnect')).toEqual([{ host: 'me@nas' }]);
    release();
    await act(async () => {});
    expect(onOpened).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(false);
    expect(localStorage.getItem(RECENT_FOLDERS_KEY)).toBe(JSON.stringify(['ssh://me@nas/home/me/docs']));
  });

  test('a failure after Cancel does not bring the picker back', async () => {
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(['ssh://me@nas/home/me/docs']));
    let fail: (e: unknown) => void = () => {};
    handlers.remote_open_root = () => new Promise<void>((_r, j) => (fail = j));
    const { user, onClose } = renderDialog();
    await user.click(await screen.findByRole('button', { name: /me@nas\s*\/home\/me\/docs/ }));
    await screen.findByText('Opening the folder…');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    fail({ kind: 'disconnected', message: 'gone' });
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('in the picker, Cancel during Open does not open the folder', async () => {
    let release: () => void = () => {};
    handlers.remote_open_root = () => new Promise<void>((r) => (release = r));
    const { user, onOpened, onClose } = renderDialog();
    await connectTo(user);
    await screen.findByDisplayValue('/home/me');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(calls('remote_open_root')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls('ssh_disconnect')).toEqual([{ host: 'me@nas' }]);
    release();
    await act(async () => {});
    expect(onOpened).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(false);
    expect(localStorage.getItem(RECENT_FOLDERS_KEY)).toBeNull();
  });

  test('Back after a failed connect, then another host, does not disconnect on a guess', async () => {
    handlers.ssh_connect = () => ({ kind: 'unreachable', reason: 'timeout' });
    const { user } = renderDialog();
    await connectTo(user);
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: 'work' }));
    expect(calls('ssh_connect').map((c) => c.target)).toEqual(['me@nas', 'work']);
    expect(calls('ssh_disconnect')).toHaveLength(0);
  });
});

describe('reconnect (a save or expand that needs a login)', () => {
  test('connects straight away without asking for the host or a folder, and reports true', async () => {
    const { onClose } = renderDialog({ host: 'me@nas', reconnect: true });
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(calls('ssh_connect')[0].target).toBe('me@nas');
    expect(calls('remote_list_folders')).toHaveLength(0);
  });
  test('Cancel reports false and leaves the session for the tab that needs it', async () => {
    handlers.ssh_connect = () => ({ kind: 'needs_password', attempts_left: 3 });
    const { user, onClose } = renderDialog({ host: 'me@nas', reconnect: true });
    await screen.findByLabelText(/Password for/);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledWith(false);
    expect(calls('ssh_disconnect')).toHaveLength(0);
  });
});

describe('in the app', () => {
  const files: FileAccess = {
    pickDocument: async () => null,
    saveDocument: async (d) => ({ name: d.name, path: d.path }),
    saveDocumentAs: async (d) => ({ name: d.name, path: '/x/copy.md' }),
  };
  async function openFileMenu(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
  }

  test('File > Connect to Server… sits right under Open Folder…', async () => {
    const user = userEvent.setup();
    render(<App files={files} />);
    await openFileMenu(user);
    const names = (await screen.findAllByRole('menuitem')).map((i) => i.textContent);
    const at = names.findIndex((n) => n?.startsWith('Open Folder'));
    expect(names[at + 1]).toMatch(/^Connect to Server…/);
    expect(names[at + 1]).toContain('Ctrl+Shift+K');
  });

  test.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
  ])('%s+Shift+K opens the dialog', async (_n, mod) => {
    render(<App files={files} />);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', shiftKey: true, bubbles: true, ...mod }));
    });
    expect(await screen.findByRole('dialog', { name: 'Connect to Server' })).toBeInTheDocument();
  });

  test('picking a folder makes it the one navigator root, with user@host under the name', async () => {
    handlers.remote_list_directory = ({ uri }) =>
      uri === 'ssh://me@nas/home/me/docs' ? [{ name: 'a.md', path: 'ssh://me@nas/home/me/docs/a.md', is_dir: false }] : [];
    const user = userEvent.setup();
    render(<App files={files} />);
    await user.click(await screen.findByRole('button', { name: 'Show folder navigator' }).catch(() => screen.getByRole('button', { name: /folder/i })));
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', shiftKey: true, ctrlKey: true, bubbles: true }));
    });
    await user.click(await screen.findByRole('button', { name: 'nas' }));
    await screen.findByDisplayValue('/home/me');
    await user.dblClick(screen.getByRole('button', { name: 'docs' }));
    await screen.findByDisplayValue('/home/me/docs');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const nav = await screen.findByRole('complementary', { name: 'Folder navigator' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(nav).getByText('docs')).toBeInTheDocument();
    expect(within(nav).getByText('me@nas')).toBeInTheDocument();
    expect(await within(nav).findByRole('button', { name: 'a.md' })).toBeInTheDocument();
    // The home directory is never listed unless picked.
    expect(calls('remote_list_directory').map((c) => c.uri)).toEqual(['ssh://me@nas/home/me/docs']);
  });

  test('a save that needs a login opens the dialog and resumes when it connects', async () => {
    handlers.ssh_connect = (a) => ((a.answers as { password?: string }).password ? connected : { kind: 'needs_password', attempts_left: 3 });
    const user = userEvent.setup();
    render(<App files={files} />);
    let first = true;
    const run = vi.fn(async () => {
      if (first) {
        first = false;
        throw { kind: 'auth_required', message: 'me@nas' };
      }
      return 'saved';
    });
    let result: Promise<string> | undefined;
    act(() => {
      result = withConnect('ssh://me@nas/home/me/n.md', 'save', run);
    });
    await user.type(await screen.findByLabelText('Password for me@nas'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await expect(result).resolves.toBe('saved');
    expect(run).toHaveBeenCalledTimes(2);
    expect(calls('ssh_connect')[0].target).toBe('me@nas');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('two back-to-back logins on different hosts each get a fresh dialog', async () => {
    handlers.ssh_connect = (a) =>
      (a.answers as { password?: string }).password
        ? { kind: 'connected', home: '/h', authority: String(a.target) }
        : { kind: 'needs_password', attempts_left: 3 };
    const user = userEvent.setup();
    render(<App files={files} />);
    let a: Promise<string> | undefined;
    let b: Promise<string> | undefined;
    const fail = (m: string) => async () => {
      throw { kind: 'auth_required', message: m };
    };
    let tries = { a: 0, b: 0 };
    act(() => {
      a = withConnect('ssh://me@nas/n.md', 'save', async () => {
        if (tries.a++ === 0) await fail('me@nas')();
        return 'a';
      });
      b = withConnect('ssh://you@other/n.md', 'save', async () => {
        if (tries.b++ === 0) await fail('you@other')();
        return 'b';
      });
    });
    await user.type(await screen.findByLabelText('Password for me@nas'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await expect(a).resolves.toBe('a');
    await user.type(await screen.findByLabelText('Password for you@other'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await expect(b).resolves.toBe('b');
    expect(calls('ssh_connect').map((c) => c.target)).toEqual(['me@nas', 'me@nas', 'you@other', 'you@other']);
  });

  test('a save that needs a login waits for a dialog the user opened instead of taking it over', async () => {
    handlers.ssh_connect = (a) => (String(a.target) === 'me@nas' ? { kind: 'needs_host_key', key_type: 'ssh-ed25519', fingerprint: 'SHA256:abc' } : connected);
    const user = userEvent.setup();
    render(<App files={files} />);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', shiftKey: true, ctrlKey: true, bubbles: true }));
    });
    await user.type(await screen.findByLabelText('Host'), 'me@nas');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByText(/SHA256:abc/);
    let tries = 0;
    let saved: Promise<string> | undefined;
    act(() => {
      saved = withConnect('ssh://you@other/n.md', 'save', async () => {
        if (tries++ === 0) throw { kind: 'auth_required', message: 'you@other' };
        return 'saved';
      });
    });
    await act(async () => {});
    // The user's dialog is untouched, and nothing was disconnected or started for the save.
    expect(screen.getByText(/SHA256:abc/)).toBeInTheDocument();
    expect(calls('ssh_connect')).toHaveLength(1);
    expect(calls('ssh_disconnect')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(saved).resolves.toBe('saved');
    expect(calls('ssh_connect').map((c) => c.target)).toEqual(['me@nas', 'you@other']);
  });

  test('cancelling the login the save needed fails the save with its message', async () => {
    handlers.ssh_connect = () => ({ kind: 'needs_password', attempts_left: 3 });
    const user = userEvent.setup();
    render(<App files={files} />);
    let result: Promise<unknown> | undefined;
    act(() => {
      result = withConnect('ssh://me@nas/home/me/n.md', 'save', async () => {
        throw { kind: 'auth_required', message: 'me@nas' };
      });
    });
    const settled = result!.catch((e) => e);
    await screen.findByLabelText(/Password for/);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await settled).toBeInstanceOf(RemoteFileError);
  });

  test('without the desktop runtime the item is present and the item and shortcut show an error, not a dialog', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const user = userEvent.setup();
    render(<App files={files} />);
    await openFileMenu(user);
    const item = await screen.findByRole('menuitem', { name: /Connect to Server/ });
    expect(item).toBeEnabled();
    await user.click(item);
    expect(await screen.findByRole('alert')).toHaveTextContent('Connecting to a server needs the desktop app.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      // A new tab clears the banner.
      await user.click(screen.getByRole('button', { name: 'New tab' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      act(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', shiftKey: true, bubbles: true, ...mod }));
      });
      expect(await screen.findByRole('alert')).toHaveTextContent('Connecting to a server needs the desktop app.');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
    expect(invoke).not.toHaveBeenCalled();
  });
});
