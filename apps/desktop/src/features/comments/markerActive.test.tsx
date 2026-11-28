/** The marker of the thread open in the desktop Comments sidebar is active (cm-thread-active, aria-current); the list view, a draft, Close, closing the sidebar, a tab switch and deleting the thread clear it. */
import { settleEditors } from '@gonq/editor/testing/editor';
import { screen, within } from '@testing-library/react';
import { menu, openDocument, renderApp, testDoc, type User } from '../../testing/renderApp';

const A = 'c20260910143022a3f9c1';
const B = 'c20260910143022a3f9c2';
const blk = (id: string, status: string) => `<!--\n@thread ${id}\n@status ${status}\n\n[User | 2026-09-10T14:30:22+02:00]\nBody ${id.slice(-1)}\n-->`;
const DOC = `Para [💬](#md-thread-${A}) one [✅](#md-thread-${B}) two.\n\n${blk(A, 'open')}\n\n${blk(B, 'resolved')}\n`;

const active = () => (settleEditors(document.body), Array.from(document.querySelectorAll<HTMLElement>('.cm-thread-active')).map((m) => m.dataset.threadId));
const toggle = (user: User) => user.click(screen.getByRole('button', { name: 'Comments' }));
const side = () => screen.getByRole('complementary', { name: 'Comments' });
const openRow = (user: User, n: number) => user.click(within(within(side()).getByRole('list')).getAllByRole('button')[n]);

async function start() {
  const r = renderApp({ docs: [testDoc(DOC), testDoc('Other.\n', '/d/b.md')] });
  await openDocument(r.user);
  return r;
}

test('the open thread is active (also resolved), and the list view has none', async () => {
  const { user } = await start();
  await toggle(user);
  expect(active()).toEqual([]);
  await openRow(user, 0);
  expect(active()).toEqual([A]);
  expect(document.querySelector('.cm-thread-active')!.getAttribute('aria-current')).toBe('true');
  await user.click(screen.getByRole('button', { name: 'Close thread' }));
  expect(active()).toEqual([]);
  await openRow(user, 1);
  expect(active()).toEqual([B]);
  expect(document.querySelector('.cm-thread-active')!.classList.contains('cm-thread-resolved')).toBe(true);
});

test('closing the sidebar, a new-comment draft and a tab switch clear it', async () => {
  const { user } = await start();
  await toggle(user);
  await openRow(user, 0);
  await toggle(user);
  expect(active()).toEqual([]);
  await toggle(user);
  await openRow(user, 0);
  expect(active()).toEqual([A]);
  await user.click(within(side()).getByRole('button', { name: 'Close thread' }));
  await user.click(within(side()).getByRole('button', { name: /Add comment/ }));
  expect(active()).toEqual([]);
  await menu(user, 'File', /^Open…/);
  await screen.findByRole('tab', { name: /b\.md/ });
  expect(active()).toEqual([]);
  await user.click(screen.getByRole('tab', { name: /a\.md/ }));
  expect(active()).toEqual([]);
});

test('deleting the open thread leaves no active marker', async () => {
  const { user } = await start();
  await toggle(user);
  await openRow(user, 0);
  await user.click(screen.getByRole('button', { name: 'Delete thread' }));
  await user.click(await screen.findByRole('button', { name: 'Delete' }));
  expect(active()).toEqual([]);
});
