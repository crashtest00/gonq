import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from './../App';
import { AGENT_SKILL } from '../agent-skill/skill';
import type { FileAccess } from '../platform/files';

vi.setConfig({ testTimeout: 30000 });

const files = (over: Partial<FileAccess> = {}): FileAccess => ({
  pickDocument: async () => null,
  loadImage: async () => null,
  saveDocument: async (d) => ({ name: d.name, path: d.path }),
  saveDocumentAs: async (d) => ({ name: d.name, path: null }),
  ...over,
});

async function openSkill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('menuitem', { name: 'Help' }));
  await user.click(await screen.findByRole('menuitem', { name: /Agent skill/ }));
  return screen.findByRole('dialog', { name: 'Agent skill' });
}

test('the bundled skill is a SKILL.md with front matter', () => {
  expect(AGENT_SKILL).toMatch(/^---\nname: gonq-comment-threads\n/);
});

test('Help > Agent skill… shows the skill; Escape closes it', async () => {
  const user = userEvent.setup();
  render(<App files={files()} />);
  const d = await openSkill(user);
  expect(within(d).getByLabelText('SKILL.md').textContent).toBe(AGENT_SKILL);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Agent skill' })).toBeNull();
});

test('Copy puts the skill on the clipboard', async () => {
  const user = userEvent.setup();
  render(<App files={files()} />);
  const d = await openSkill(user);
  await user.click(within(d).getByRole('button', { name: 'Copy' }));
  expect(await within(d).findByText('Copied to the clipboard.')).toBeInTheDocument();
  expect(await navigator.clipboard.readText()).toBe(AGENT_SKILL);
});

test('Save as… hands SKILL.md to the file boundary, and reports a failure', async () => {
  const user = userEvent.setup();
  const saveDocumentAs = vi.fn(async (d: { name: string }) => ({ name: d.name, path: '/x/SKILL.md' }));
  const { unmount } = render(<App files={files({ saveDocumentAs })} />);
  let d = await openSkill(user);
  await user.click(within(d).getByRole('button', { name: 'Save as…' }));
  expect(saveDocumentAs).toHaveBeenCalledWith({ name: 'SKILL.md', text: AGENT_SKILL });
  expect(await within(d).findByText('Saved SKILL.md.')).toBeInTheDocument();
  unmount();

  render(<App files={files({ saveDocumentAs: async () => { throw new Error('disk full'); } })} />);
  d = await openSkill(user);
  await user.click(within(d).getByRole('button', { name: 'Save as…' }));
  expect(await within(d).findByRole('alert')).toHaveTextContent('disk full');
});
