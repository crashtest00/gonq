import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from './../App';
import { SHOW_MARKERS_KEY } from '../platform/settings';

vi.setConfig({ testTimeout: 30000 });

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

async function openView() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('menuitem', { name: 'View' }));
  return { user, item: await screen.findByRole('menuitemcheckbox', { name: /Show markers in active block/ }) };
}

test('is checked by default', async () => {
  const { item } = await openView();
  expect(item).toBeChecked();
});

test('choosing it toggles the check mark and persists', async () => {
  const { user, item } = await openView();
  await user.click(item);
  expect(localStorage.getItem(SHOW_MARKERS_KEY)).toBe('false');
  await user.click(screen.getByRole('menuitem', { name: 'View' }));
  const off = await screen.findByRole('menuitemcheckbox', { name: /Show markers in active block/ });
  expect(off).not.toBeChecked();
  await user.click(off);
  expect(localStorage.getItem(SHOW_MARKERS_KEY)).toBe('true');
});

test('a stored "off" is restored on start', async () => {
  localStorage.setItem(SHOW_MARKERS_KEY, 'false');
  const { item } = await openView();
  expect(item).not.toBeChecked();
});

test('a corrupt stored value falls back to on', async () => {
  localStorage.setItem(SHOW_MARKERS_KEY, 'garbage');
  const { item } = await openView();
  expect(item).toBeChecked();
});

test('an unreadable store falls back to on and does not throw', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  const { item } = await openView();
  expect(item).toBeChecked();
});

test('Insert and Format menus stay empty', async () => {
  const user = userEvent.setup();
  render(<App />);
  for (const name of ['Insert', 'Format']) {
    await user.click(screen.getByRole('menuitem', { name }));
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
    await user.keyboard('{Escape}');
  }
});
