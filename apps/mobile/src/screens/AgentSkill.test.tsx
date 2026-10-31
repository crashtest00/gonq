/** Covers the mobile Agent skill screen through renderMobileApp, porting AgentSkill.test.tsx: the line, front-matter-free read-only preview, Copy (full text, failure), Save as… (full text, saved name, failure, cancel), Close. */
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const copyText = vi.fn();
const saveDocumentAs = vi.fn();
vi.mock('@gonq/editor/platform/clipboard', () => ({ copyText: (t: string) => copyText(t) }));
vi.mock('@gonq/editor/platform/files', async (orig) => ({
  ...(await orig<typeof import('@gonq/editor/platform/files')>()),
  files: { saveDocumentAs: (d: unknown) => saveDocumentAs(d) },
}));

import { AGENT_SKILL, AGENT_SKILL_BODY } from '@gonq/editor/agent-skill/skill';
import { renderMobileApp, type User } from '../testing/renderMobileApp';

vi.setConfig({ testTimeout: 30000 });

beforeEach(() => {
  copyText.mockReset().mockResolvedValue(undefined);
  saveDocumentAs.mockReset().mockImplementation(async (d: { name: string }) => ({ name: d.name, path: null }));
});

async function openSkill(user: User) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('button', { name: 'Agent skill…' }));
  return screen.findByRole('region', { name: 'SKILL.md' });
}

it('shows the line, the buttons and the skill without its front matter in a read-only preview', async () => {
  const { user } = await renderMobileApp();
  const region = await openSkill(user);
  expect(screen.getByText('Give this to an AI agent so it can read and join comment threads in your Markdown files.')).toBeInTheDocument();
  const preview = within(region).getByTestId('markdown-preview');
  await waitFor(() => expect(preview.querySelector('.cm-heading-1')?.textContent).toBe('Gonq comment threads'), { timeout: 10000 });
  expect(preview.textContent).not.toContain('name: gonq-comment-threads');
  expect(preview.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'false');
  expect(AGENT_SKILL_BODY.startsWith('# Gonq comment threads')).toBe(true);
  for (const name of ['Copy', 'Save as…', 'Close']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
});

it('Copy writes the full SKILL.md, front matter included', async () => {
  const { user } = await renderMobileApp();
  await openSkill(user);
  await user.click(screen.getByRole('button', { name: 'Copy' }));
  expect(await screen.findByText('Copied to the clipboard.')).toBeInTheDocument();
  expect(copyText).toHaveBeenCalledWith(AGENT_SKILL);
  expect(AGENT_SKILL).toMatch(/^---\nname: gonq-comment-threads\n/);
});

it('a failed Copy says why', async () => {
  copyText.mockRejectedValue(new Error('denied'));
  const { user } = await renderMobileApp();
  await openSkill(user);
  await user.click(screen.getByRole('button', { name: 'Copy' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy: denied');
});

it('Save as… hands the full text to the file boundary and reports the saved name', async () => {
  const { user } = await renderMobileApp();
  await openSkill(user);
  await user.click(screen.getByRole('button', { name: 'Save as…' }));
  expect(saveDocumentAs).toHaveBeenCalledWith({ name: 'SKILL.md', text: AGENT_SKILL });
  expect(await screen.findByText('Saved SKILL.md.')).toBeInTheDocument();
});

it('a failed Save as… shows "Could not save: …" and the button stays', async () => {
  saveDocumentAs.mockRejectedValue(new Error('disk full'));
  const { user } = await renderMobileApp();
  await openSkill(user);
  await user.click(screen.getByRole('button', { name: 'Save as…' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save: disk full');
  expect(screen.getByRole('button', { name: 'Save as…' })).toBeEnabled();
});

it('a cancelled Save as… says nothing', async () => {
  saveDocumentAs.mockResolvedValue(null);
  const { user } = await renderMobileApp();
  await openSkill(user);
  await user.click(screen.getByRole('button', { name: 'Save as…' }));
  expect(screen.getByRole('status')).toHaveTextContent('');
});

it('Close returns to Documents', async () => {
  const { user } = await renderMobileApp();
  await openSkill(user);
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
});
