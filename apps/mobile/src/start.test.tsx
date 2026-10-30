/** Covers theme-before-paint: startMobile applies the saved theme before it renders anything, and index.html carries the viewport and the inline theme script. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen } from '@testing-library/react';
import { startMobile } from './start';

afterEach(() => {
  document.documentElement.classList.remove('dark');
  localStorage.clear();
  document.body.innerHTML = '';
});

it('has .dark on <html> by the time the first content renders', async () => {
  localStorage.setItem('gonq.theme', 'dark');
  const root = document.createElement('div');
  document.body.appendChild(root);
  expect(document.documentElement).not.toHaveClass('dark');
  await startMobile(root);
  await screen.findByRole('img', { name: 'Gonq logo' });
  expect(document.documentElement).toHaveClass('dark');
});

it('stays light for the light choice', async () => {
  localStorage.setItem('gonq.theme', 'light');
  const root = document.createElement('div');
  document.body.appendChild(root);
  await startMobile(root);
  await screen.findByRole('img', { name: 'Gonq logo' });
  expect(document.documentElement).not.toHaveClass('dark');
});

it('index.html sets the phone viewport and applies the stored theme in an inline script', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  expect(html).toContain('width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content');
  expect(html).toMatch(/localStorage\.getItem\('gonq\.theme'\)[\s\S]*classList\.add\('dark'\)/);
});

it('is built as the mobile app: __GONQ_APP__ is "mobile"', async () => {
  const { appKind } = await import('@gonq/editor/platform/app');
  expect(appKind()).toBe('mobile');
});
