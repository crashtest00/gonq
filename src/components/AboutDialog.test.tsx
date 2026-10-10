import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { caretIn } from '../testing/inplace';
import App from '../App';
import pkg from '../../package.json';
import tauriConf from '../../src-tauri/tauri.conf.json';
import capability from '../../src-tauri/capabilities/default.json';
import { APP_VERSION } from './AboutDialog';
import logoSvg from '../assets/gonq-logo-OUTLINE.svg?raw';
import { REPO_URL } from '../platform/external';
import type { FileAccess } from '../platform/files';

const native = vi.hoisted(() => ({ on: false }));
const openUrl = vi.hoisted(() => vi.fn(async (_url: string) => {}));
vi.mock('../platform/external', async (orig) => ({
  ...(await orig<typeof import('../platform/external')>()),
  opensExternallyNatively: () => native.on,
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

vi.setConfig({ testTimeout: 30000 });

const files: FileAccess = {
  pickDocument: async () => null,
  loadImage: async () => null,
  saveDocument: async (d) => ({ name: d.name, path: d.path }),
  saveDocumentAs: async (d) => ({ name: d.name, path: null }),
};

async function openAbout(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('menuitem', { name: 'Help' }));
  await user.click(await screen.findByRole('menuitem', { name: 'About Gonq' }));
  return screen.findByRole('dialog', { name: 'Gonq' });
}

beforeEach(() => {
  native.on = false;
  openUrl.mockClear();
});

test('the shown version matches package.json and tauri.conf.json', async () => {
  expect(tauriConf.version).toBe(pkg.version);
  expect(APP_VERSION).toBe(pkg.version);
  const user = userEvent.setup();
  render(<App files={files} />);
  const d = await openAbout(user);
  expect(within(d).getByText(`Version ${pkg.version}`)).toBeInTheDocument();
});

test('the opener capability is scoped to the repository URL only', () => {
  const perm = capability.permissions.find((p) => typeof p === 'object' && p.identifier === 'opener:allow-open-url') as {
    allow: { url: string }[];
  };
  expect(perm.allow).toEqual([{ url: REPO_URL }]);
  expect(capability.permissions).not.toContain('opener:default');
});

test('About Gonq is available with no document open and shows logo, name and link', async () => {
  const user = userEvent.setup();
  render(<App files={files} />);
  const d = await openAbout(user);
  expect(within(d).getByRole('img', { name: 'Gonq logo' })).toHaveAttribute('src', expect.stringContaining('gonq-logo-OUTLINE.svg'));
  expect(within(d).getByRole('heading', { name: 'Gonq' })).toBeInTheDocument();
  const link = within(d).getByRole('link', { name: REPO_URL });
  expect(REPO_URL).toBe('https://github.com/crashtest00/gonq');
  expect(link).toHaveAttribute('href', REPO_URL);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
});

test('the logo the dialog uses has its GONQ wordmark as paths, not visible live text', () => {
  const svg = new DOMParser().parseFromString(logoSvg, 'image/svg+xml');
  const viewBoxWidth = Number(svg.documentElement.getAttribute('viewBox')?.split(/\s+/)[2]);
  // The outlined file keeps a few leftover <text> elements parked outside the viewBox; none may be visible.
  const visible = [...svg.getElementsByTagName('text')].filter(
    (t) => (t.textContent ?? '').trim() !== '' && Number(t.getAttribute('x')) < viewBoxWidth,
  );
  expect(visible).toEqual([]);
  expect(svg.querySelectorAll('g[aria-label="GONQ"] > path').length).toBe(4);
});

test('in the browser the link is a plain link and the opener is not used', async () => {
  const user = userEvent.setup();
  render(<App files={files} />);
  const d = await openAbout(user);
  await user.click(within(d).getByRole('link'));
  expect(openUrl).not.toHaveBeenCalled();
});

test('in the desktop app the link goes to the opener plugin', async () => {
  native.on = true;
  const user = userEvent.setup();
  render(<App files={files} />);
  const d = await openAbout(user);
  await user.click(within(d).getByRole('link'));
  expect(openUrl).toHaveBeenCalledTimes(1);
  expect(openUrl).toHaveBeenCalledWith(REPO_URL);
});

describe('closing', () => {
  test('Close button', async () => {
    const user = userEvent.setup();
    render(<App files={files} />);
    const d = await openAbout(user);
    await user.click(within(d).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  test('Escape', async () => {
    const user = userEvent.setup();
    render(<App files={files} />);
    await openAbout(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  test('backdrop click', async () => {
    const user = userEvent.setup();
    render(<App files={files} />);
    await openAbout(user);
    const overlay = document.querySelector('.bg-foreground\\/30') as HTMLElement;
    await user.click(overlay);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  test('clicking inside the dialog keeps it open', async () => {
    const user = userEvent.setup();
    render(<App files={files} />);
    const d = await openAbout(user);
    await user.click(within(d).getByRole('heading', { name: 'Gonq' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

test('focus is trapped while open', async () => {
  const user = userEvent.setup();
  render(<App files={files} />);
  const d = await openAbout(user);
  for (let i = 0; i < 4; i++) {
    await user.tab();
    expect(d.contains(document.activeElement)).toBe(true);
  }
});

test('closing keeps an edit made before opening, and focus returns to the Help menu', async () => {
  const user = userEvent.setup();
  const doc = { name: 'a.md', path: '/d/a.md', text: 'Hello world\n' };
  render(<App files={{ ...files, pickDocument: async () => doc }} />);
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Open/ }));
  await user.click(await screen.findByText('Hello world'));
  await caretIn(await screen.findByText('Hello world'));
  await user.keyboard('!!');
  // Opening the menu moves focus out of the document, which ends the edit.
  await openAbout(user);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByTestId('markdown-view')).toHaveTextContent('Hello world!!');
  expect(screen.getByRole('menuitem', { name: 'Help' })).toHaveFocus();
});
