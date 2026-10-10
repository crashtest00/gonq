import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from './../App';
import { AGENT_SKILL, AGENT_SKILL_BODY } from '../agent-skill/skill';
import fixture from '../agent-skill/fixtures/agent-edited.md?raw';
import { parseCommentThreads, parseCommentMarkers, danglingMarkers } from '../comment-threads';
import { AGENT_GUIDANCE } from '../comment-threads/guidance';
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
  expect(within(d).getByLabelText('SKILL.md')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Agent skill' })).toBeNull();
});

test('the dialog renders formatted Markdown without the front matter', async () => {
  const user = userEvent.setup();
  render(<App files={files()} />);
  const d = await openSkill(user);
  expect(within(d).getByRole('heading', { level: 1, name: 'Gonq comment threads' })).toBeInTheDocument();
  expect(within(d).getByRole('heading', { level: 2, name: 'Format' })).toBeInTheDocument();
  expect(within(d).getByRole('heading', { level: 2, name: 'What you must not do' })).toBeInTheDocument();
  expect(within(d).getAllByRole('listitem').length).toBeGreaterThan(10);
  expect(d.querySelector('pre')).not.toBeNull();
  expect(d.querySelector('hr')).toBeNull();
  expect(d.textContent).not.toContain('name: gonq-comment-threads');
  expect(d.textContent).not.toContain('---');
  // The example thread block is shown, not hidden as a real thread would be.
  expect(d.textContent).toContain('@thread c20260910143022a3f9c1d7e2b4');
  expect(AGENT_SKILL_BODY.startsWith('# Gonq comment threads')).toBe(true);
});

describe('Copy', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else delete (navigator as { clipboard?: unknown }).clipboard;
    delete (document as { execCommand?: unknown }).execCommand;
  });

  test('writes exactly SKILL.md with navigator.clipboard', async () => {
    const user = userEvent.setup();
    render(<App files={files()} />);
    const d = await openSkill(user);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(within(d).getByRole('button', { name: 'Copy' }));
    expect(await within(d).findByText('Copied to the clipboard.')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(AGENT_SKILL);
  });

  test('falls back to a hidden textarea and execCommand without navigator.clipboard', async () => {
    const user = userEvent.setup();
    render(<App files={files()} />);
    const d = await openSkill(user);
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    let copied: string | null = null;
    document.execCommand = vi.fn((cmd: string) => {
      const sel = document.querySelector('textarea');
      copied = cmd === 'copy' && sel ? sel.value.slice(sel.selectionStart, sel.selectionEnd) : null;
      return true;
    });
    await user.click(within(d).getByRole('button', { name: 'Copy' }));
    expect(await within(d).findByText('Copied to the clipboard.')).toBeInTheDocument();
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(copied).toBe(AGENT_SKILL);
    expect(document.querySelector('textarea')).toBeNull();
  });

  test('reports a failed fallback', async () => {
    const user = userEvent.setup();
    render(<App files={files()} />);
    const d = await openSkill(user);
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn(() => false);
    await user.click(within(d).getByRole('button', { name: 'Copy' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('Could not copy');
  });
});

describe('SKILL.md content', () => {
  const has = (re: RegExp) => expect(AGENT_SKILL).toMatch(re);
  test('forbids editing or deleting existing messages and threads, as guidance.ts does', () => {
    expect(AGENT_SKILL).toContain('Never edit or delete existing messages or threads');
    expect(AGENT_GUIDANCE).toContain('Never edit or delete existing messages or threads');
  });
  test('ordinal pairing of duplicate ids', () => has(/Nth marker[^\n]*pairs with the Nth block/));
  test('ids are never shortened', () => has(/Ids are never shortened/));
  test('the #md-thread- namespace is a rule', () => has(/Markers always use the `#md-thread-` namespace/));
  test('no marker inside another marker', () => has(/Never place a marker inside another marker/));
  test('glyphs are the literal Unicode characters', () => has(/literal Unicode characters 💬 and ✅: no images/));
  test('markers stay out of code, comments and links', () => has(/fenced code block, inline code, an HTML comment, or another link/));
});

test('a file edited strictly by following SKILL.md parses and renders in Gonq', async () => {
  const threads = parseCommentThreads(fixture);
  expect(threads.map((t) => [t.id, t.status])).toEqual([
    ['c20260910143022a3f9c1d7e2b4', 'open'],
    ['c20261009101500b7d2e4a91f03', 'open'],
    ['c20261009101712e5f60c3a8b21', 'resolved'],
  ]);
  for (const t of threads) {
    expect(t.id).toMatch(/^c\d{14}[0-9a-f]{12}$/);
    expect(t.markers).toHaveLength(1);
    expect(t.markers[0].status).toBe(t.status);
  }
  expect(danglingMarkers(fixture).size).toBe(0);
  expect(parseCommentMarkers(fixture).size).toBe(3);
  expect(threads[0].anchor).toBe('holds through Q3');
  expect(threads[0].messages.map((m) => m.author)).toEqual(['User', 'plan-checker:4821']);
  expect(threads[0].messages[1].body.trim()).toBe('Q2 actuals, extrapolated. Citation added.');
  expect(threads[1].messages.map((m) => m.author)).toEqual(['plan-checker:4821']);
  expect(threads[2].messages.map((m) => m.body.trim())).toEqual([
    'Is November confirmed with the vendor?',
    'Confirmed in the vendor email of 8 October. Resolving.',
  ]);
  for (const m of threads.flatMap((t) => t.messages)) expect(m.timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);

  const user = userEvent.setup();
  const doc = { name: 'plan.md', path: '/d/plan.md', text: fixture };
  render(<App files={files({ pickDocument: async () => doc })} />);
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Open…/ }));
  await screen.findByTestId('markdown-view');
  expect(screen.getAllByRole('button', { name: '💬' })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: '✅' })).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  const rows = within(screen.getByRole('list')).getAllByRole('listitem');
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent('Open');
  expect(rows[0]).toHaveTextContent('holds through Q3');
  expect(rows[2]).toHaveTextContent('Resolved');
  await user.click(within(rows[0]).getByRole('button'));
  const authors = screen.getAllByText(/^(User|plan-checker:4821)$/).map((e) => e.textContent);
  expect(authors).toEqual(['User', 'plan-checker:4821']);
  expect(screen.getByText('Q2 actuals, extrapolated. Citation added.')).toBeInTheDocument();
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
