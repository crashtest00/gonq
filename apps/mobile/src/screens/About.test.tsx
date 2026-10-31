/** Covers the mobile About screen through renderMobileApp, porting AboutDialog.test.tsx: version matches package.json, real unmodified logo, link through openExternal, no tagline or extra rows, and REPO_URL being in the mobile opener allow-list. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import logoSvg from '@repo-assets/gonq-logo-OUTLINE.svg?raw';
import pkg from '../../package.json';
import capability from '../../src-tauri/capabilities/mobile.json';
import tauriConf from '../../src-tauri/tauri.conf.json';

const openExternal = vi.fn();
let openFails = false;
vi.mock('@gonq/editor/platform/external', async (orig) => ({
  ...(await orig<typeof import('@gonq/editor/platform/external')>()),
  openExternal: async (u: string) => {
    openExternal(u);
    if (openFails) throw new Error('no browser');
  },
}));

import { REPO_URL } from '@gonq/editor/platform/external';
import { APP_VERSION } from './AboutScreen';
import { renderMobileApp, type User } from '../testing/renderMobileApp';

beforeEach(() => {
  openExternal.mockReset();
  openFails = false;
});

async function openAbout(user: User) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: 'About Gonq' }));
  return screen.findByRole('heading', { name: 'Gonq' });
}

it('shows the package version, with no build number', async () => {
  expect(APP_VERSION).toBe(pkg.version);
  expect(tauriConf.version).toBe(pkg.version);
  expect(pkg.version).toMatch(/^0\.1\.\d+$/);
  const { user } = await renderMobileApp();
  await openAbout(user);
  expect(screen.getByText(`Version ${pkg.version}`)).toBeInTheDocument();
});

it('shows the real logo, the name and the repository link, and Close returns', async () => {
  const { user } = await renderMobileApp();
  await openAbout(user);
  expect(screen.getByRole('img', { name: 'Gonq logo' })).toHaveAttribute('src', expect.stringContaining('gonq-logo-OUTLINE.svg'));
  expect(REPO_URL).toBe('https://github.com/crashtest00/gonq');
  const link = screen.getByRole('link', { name: REPO_URL });
  expect(link).toHaveAttribute('href', REPO_URL);
  expect(link).toHaveClass('m-tap');
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
});

it('has no tagline, release notes or licences', async () => {
  const { user } = await renderMobileApp();
  await openAbout(user);
  const main = screen.getByRole('main');
  expect(within(main).queryByText(/release notes|licen[cs]e/i)).toBeNull();
  expect(within(main).getAllByRole('button').map((b) => b.textContent)).toEqual(['Close']);
  expect(within(main).getAllByRole('paragraph').map((p) => p.textContent)).toEqual([`Version ${pkg.version}`]);
});

it('opens the link through openExternal', async () => {
  const { user } = await renderMobileApp();
  await openAbout(user);
  await user.click(screen.getByRole('link', { name: REPO_URL }));
  expect(openExternal).toHaveBeenCalledWith(REPO_URL);
});

it('a failed open goes to the error banner', async () => {
  openFails = true;
  const { user } = await renderMobileApp();
  await openAbout(user);
  await user.click(screen.getByRole('link', { name: REPO_URL }));
  expect(await screen.findByRole('alert')).toHaveTextContent('no browser');
});

it('the logo file is used unmodified: its source is the repo asset', () => {
  expect(logoSvg).toContain('<svg');
  const source = readFileSync(join(__dirname, 'AboutScreen.tsx'), 'utf8');
  expect(source).toContain("from '@repo-assets/gonq-logo-OUTLINE.svg'");
});

it('REPO_URL matches an entry of the mobile opener allow-list', () => {
  const perm = capability.permissions.find((p) => typeof p === 'object' && p.identifier === 'opener:allow-open-url') as {
    allow: { url: string }[];
  };
  const matches = (pattern: string, url: string) =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(url);
  expect(perm.allow.some((e) => matches(e.url, REPO_URL))).toBe(true);
  expect(capability.permissions).not.toContain('opener:default');
});
