import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from './../App';
import { parseCommentThreads } from '../comment-threads';
import type { FileAccess } from '../platform/files';

vi.setConfig({ testTimeout: 30000 });

const A = 'c20260910143022a3f9c1';
const DOC = `Para one [💬](#md-thread-${A}) here.\n\n<!--\n@thread ${A}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nFirst?\n-->\n`;

async function setup() {
  const saved: string[] = [];
  const files: FileAccess = {
    pickDocument: async () => ({ name: 'a.md', path: '/d/a.md', text: DOC }),
    loadImage: async () => null,
    saveDocument: async (d) => {
      saved.push(d.text);
      return { name: d.name, path: d.path };
    },
    saveDocumentAs: async (d) => ({ name: d.name, path: null }),
  };
  const user = userEvent.setup();
  render(<App files={files} />);
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Open/ }));
  await screen.findByTestId('markdown-view');
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  await user.click(await screen.findByRole('button', { name: /First\?/ }));
  return { user, saved };
}

async function save(user: ReturnType<typeof userEvent.setup>, saved: string[]) {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
  return saved[saved.length - 1];
}

describe('resolve and reopen', () => {
  test('Resolve swaps the badge, button and marker glyph; Reopen reverts', async () => {
    const { user, saved } = await setup();
    const view = screen.getByTestId('markdown-view');
    expect(view.textContent).toContain('💬');
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(view.textContent).toContain('✅');
    expect(view.textContent).not.toContain('💬');
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
    const resolved = await save(user, saved);
    expect(parseCommentThreads(resolved)[0].status).toBe('resolved');
    expect(resolved).toContain('✅');

    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(view.textContent).toContain('💬');
    const reopened = await save(user, saved);
    expect(reopened).toBe(DOC);
  });
});
