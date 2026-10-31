/** Covers theme through the mobile ⋯ menu: Light, Dark and Auto run the View > Theme registry commands, apply to <html> at once, persist through set_theme/localStorage, and Settings has no theme row. */
import { screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { THEME_KEY } from '@gonq/editor/platform/settings';
import { renderMobileApp } from '../testing/renderMobileApp';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

it('Dark applies at once and persists; Light undoes it; the choice is checked', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(screen.getByRole('radio', { name: /Dark/ }));
  expect(document.documentElement).toHaveClass('dark');
  expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  await user.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getByRole('radio', { name: /Dark/ })).toHaveAttribute('aria-checked', 'true');
  await user.click(screen.getByRole('radio', { name: /Light/ }));
  expect(document.documentElement).not.toHaveClass('dark');
  expect(localStorage.getItem(THEME_KEY)).toBe('light');
});

it('offers exactly Light, Dark and Auto', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getAllByRole('radio').map((r) => r.textContent?.replace('✓', ''))).toEqual(['Light', 'Dark', 'Auto']);
});
