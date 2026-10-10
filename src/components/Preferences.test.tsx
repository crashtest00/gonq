import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from './../App';
import type { FileAccess } from '../platform/files';
import { AUTHOR_KEY } from '../platform/settings';

vi.setConfig({ testTimeout: 30000 });

const files: FileAccess = {
  pickDocument: async () => ({ name: 'a.md', path: '/d/a.md', text: 'Some paragraph here.\n' }),
  loadImage: async () => null,
  saveDocument: async (d) => ({ name: d.name, path: d.path }),
  saveDocumentAs: async (d) => ({ name: d.name, path: null }),
};

beforeEach(() => localStorage.clear());

const dialog = () => screen.queryByRole('dialog', { name: 'Preferences' });

async function openPrefsFromMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
  await user.click(await screen.findByRole('menuitem', { name: /Preferences/ }));
  return screen.findByRole('dialog', { name: 'Preferences' });
}

test('Edit > Preferences… opens the dialog with the default name; Cancel and Escape close it', async () => {
  const user = userEvent.setup();
  render(<App files={files} />);
  const d = await openPrefsFromMenu(user);
  expect(within(d).getByLabelText('Author name')).toHaveValue('User');
  await user.click(within(d).getByRole('button', { name: 'Cancel' }));
  expect(dialog()).toBeNull();
  await openPrefsFromMenu(user);
  await user.keyboard('{Escape}');
  expect(dialog()).toBeNull();
});

test('Ctrl+, and Cmd+, open the dialog', async () => {
  const user = userEvent.setup();
  render(<App files={files} />);
  await user.keyboard('{Control>},{/Control}');
  expect(dialog()).not.toBeNull();
  await user.keyboard('{Escape}');
  await user.keyboard('{Meta>},{/Meta}');
  expect(dialog()).not.toBeNull();
});

test('saving stores the trimmed name', async () => {
  const user = userEvent.setup();
  render(<App files={files} />);
  let d = await openPrefsFromMenu(user);
  const input = within(d).getByLabelText('Author name');
  await user.clear(input);
  await user.type(input, '  Ann Lee  {Enter}');
  expect(dialog()).toBeNull();
  expect(localStorage.getItem(AUTHOR_KEY)).toBe('Ann Lee');
  d = await openPrefsFromMenu(user);
  expect(within(d).getByLabelText('Author name')).toHaveValue('Ann Lee');
});

test.each([
  ['blank', ''],
  ['whitespace only', '   '],
  ['a pipe', 'a|b'],
  ['a closing bracket', 'a]b'],
])('%s is refused with an inline error, nothing saved, dialog stays open', async (_label, bad) => {
  const user = userEvent.setup();
  render(<App files={files} />);
  const d = await openPrefsFromMenu(user);
  const input = within(d).getByLabelText('Author name');
  await user.clear(input);
  if (bad !== '') await user.click(input);
  if (bad !== '') await user.paste(bad);
  expect(within(d).getByRole('alert')).toBeInTheDocument();
  expect(within(d).getByRole('button', { name: 'Save' })).toBeDisabled();
  await user.keyboard('{Enter}');
  expect(dialog()).not.toBeNull();
  expect(localStorage.getItem(AUTHOR_KEY)).toBeNull();
});

test('renaming keeps existing messages byte-for-byte', async () => {
  const A = 'c20260910143022a3f9c1';
  const text = `Para [💬](#md-thread-${A}) here.\n\n<!--\n@thread ${A}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nFirst?\n-->\n`;
  const saved: string[] = [];
  const f: FileAccess = {
    ...files,
    pickDocument: async () => ({ name: 'a.md', path: '/d/a.md', text }),
    saveDocument: async (d) => {
      saved.push(d.text);
      return { name: d.name, path: d.path };
    },
  };
  const user = userEvent.setup();
  render(<App files={f} />);
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Open…/ }));
  await screen.findByTestId('markdown-view');
  const d = await openPrefsFromMenu(user);
  await user.clear(within(d).getByLabelText('Author name'));
  await user.type(within(d).getByLabelText('Author name'), 'Bo{Enter}');
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  await user.click(await screen.findByRole('button', { name: /First\?/ }));
  await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Two');
  await user.click(screen.getByRole('button', { name: 'Reply' }));
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
  const out = saved[saved.length - 1].replace(/\[Bo \| [^\]]+\]/, '[Bo | TS]');
  expect(out).toBe(text.replace('First?\n-->', 'First?\n\n[Bo | TS]\nTwo\n-->'));
});

test('a reply is written under the saved author name, and a changed name applies to the next one', async () => {
  localStorage.setItem(AUTHOR_KEY, 'Ann Lee');
  const A = 'c20260910143022a3f9c1';
  const text = `Para [💬](#md-thread-${A}) here.\n\n<!--\n@thread ${A}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nFirst?\n-->\n`;
  const saved: string[] = [];
  const f: FileAccess = {
    ...files,
    pickDocument: async () => ({ name: 'a.md', path: '/d/a.md', text }),
    saveDocument: async (d) => {
      saved.push(d.text);
      return { name: d.name, path: d.path };
    },
  };
  const user = userEvent.setup();
  render(<App files={f} />);
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Open…/ }));
  await screen.findByTestId('markdown-view');
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  await user.click(await screen.findByRole('button', { name: /First\?/ }));
  await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'One');
  await user.click(screen.getByRole('button', { name: 'Reply' }));

  const d = await openPrefsFromMenu(user);
  await user.clear(within(d).getByLabelText('Author name'));
  await user.type(within(d).getByLabelText('Author name'), 'Bo{Enter}');
  await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Two');
  await user.click(screen.getByRole('button', { name: 'Reply' }));

  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
  const out = saved[saved.length - 1];
  expect(out).toMatch(/\[Ann Lee \| [^\]]+\]\nOne\n/);
  expect(out).toMatch(/\[Bo \| [^\]]+\]\nTwo\n/);
});
