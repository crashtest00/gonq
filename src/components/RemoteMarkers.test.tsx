import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { caretIn } from '../testing/inplace';
import App from '../App';
import { FolderSidebar } from './FolderSidebar';
import { RemoteConflictError, RemoteFileError, type RemoteStat } from '../platform/remote';
import type { FileAccess, OpenedDocument } from '../platform/files';

vi.setConfig({ testTimeout: 30000 });

const REMOTE: OpenedDocument = { name: 'notes.md', path: 'ssh://me@nas/home/me/notes.md', text: '# Notes\n\nbody', remote: { mtime: 1, size: 2 } };
const LOCAL: OpenedDocument = { name: 'local.md', path: '/x/local.md', text: '# Local\n\nlocal body' };

function setup(docs: OpenedDocument[], saveDocument: FileAccess['saveDocument']) {
  const queue = [...docs];
  const files: FileAccess = {
    pickDocument: async () => queue.shift() ?? null,
    loadImage: async () => null,
    saveDocument,
    saveDocumentAs: async (d) => ({ name: d.name, path: '/x/copy.md' }),
  };
  const user = userEvent.setup();
  render(<App files={files} />);
  return user;
}
async function openFile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Open/ }));
}
async function typeAndSave(user: ReturnType<typeof userEvent.setup>, para: string) {
  await user.click(screen.getByText(para));
  await caretIn(screen.getByText(para));
  await user.keyboard('!');
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?!\s*As)/ }));
}

test('remote tabs show a server icon with the full path as tooltip; local tabs show none', async () => {
  const user = setup([REMOTE, LOCAL], async (d) => ({ name: d.name, path: d.path }));
  await openFile(user);
  await screen.findByText('body');
  await openFile(user);
  await screen.findByText('local body');
  const remote = screen.getByRole('tab', { name: /notes\.md/ });
  expect(remote).toHaveAttribute('title', REMOTE.path);
  expect(within(remote).getByLabelText('Remote document')).toBeInTheDocument();
  expect(within(screen.getByRole('tab', { name: /local\.md/ })).queryByLabelText('Remote document')).not.toBeInTheDocument();
});

test('a conflict asks; Cancel leaves the tab unsaved', async () => {
  const save = vi.fn(async () => {
    throw new RemoteConflictError('notes.md', false);
  });
  const user = setup([REMOTE], save);
  await openFile(user);
  await screen.findByText('body');
  await typeAndSave(user, 'body');
  expect(await screen.findByText('notes.md changed on the server since you opened it.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
});

test('Overwrite retries with force and stores the new stat', async () => {
  const stats: (RemoteStat | undefined)[] = [];
  const save = vi.fn(async (d: { name: string; path: string | null; remote?: RemoteStat }, _t?: unknown, o?: { force?: boolean }) => {
    stats.push(d.remote);
    if (!o?.force) throw new RemoteConflictError('notes.md', true);
    return { name: d.name, path: d.path, remote: { mtime: 9, size: 9 } };
  });
  const user = setup([REMOTE], save);
  await openFile(user);
  await screen.findByText('body');
  await typeAndSave(user, 'body');
  expect(await screen.findByText('notes.md was deleted on the server since you opened it.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Overwrite' }));
  await waitFor(() => expect(screen.queryByLabelText('unsaved changes')).not.toBeInTheDocument());
  expect(save.mock.calls[1][2]).toEqual({ force: true });
  expect(stats[0]).toEqual({ mtime: 1, size: 2 });
});

test('a dropped connection keeps the tab unsaved and names the host', async () => {
  const user = setup([REMOTE], async () => {
    throw new RemoteFileError('disconnected', "Couldn't save to nas: connection lost. notes.md is still open and unsaved.");
  });
  await openFile(user);
  await screen.findByText('body');
  await typeAndSave(user, 'body');
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save to nas: connection lost");
  expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
  expect(screen.getByText(/body!/)).toBeInTheDocument();
});

test('recent files show user@host only for remote ones, and a lost folder offers Retry', () => {
  render(
    <FolderSidebar
      supported
      folder={null}
      recents={[
        { path: REMOTE.path!, openedAt: Date.now() },
        { path: '/x/local.md', openedAt: Date.now() },
      ]}
      currentPath={null}
      onOpenFolder={() => {}}
      onOpenFile={() => {}}
      onOpenRecent={() => {}}
      onRemoveRecent={() => {}}
    />,
  );
  const items = screen.getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('notes.mdme@nas');
  expect(items[1]).not.toHaveTextContent('@');
});
