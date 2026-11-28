import { expect, test } from '@playwright/test';

// The ☰ menu drawer on the Pixel 7 profile against /mobile/: ☰ leads the top bar (the editor has no Back, no ⋯), the
// drawer drills menu > items > submenu, runs a command (View > Raw Markdown) and closes by its control and the scrim.

test('☰ leads the home and editor top bars; the editor has no Back and no ⋯', async ({ page }) => {
  await page.goto('/mobile/');
  const bar = page.getByRole('banner');
  await expect(bar.getByRole('button').first()).toHaveAccessibleName('Menu');
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  await expect(bar.getByRole('button').first()).toHaveAccessibleName('Menu');
  await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More' })).toHaveCount(0);
});

test('runs a command through the drawer: View > Raw Markdown, then closes', async ({ page }) => {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).tap();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await drawer.getByRole('menuitem', { name: 'View' }).tap();
  await expect(drawer.getByRole('heading', { name: 'View' })).toBeVisible();
  await drawer.getByRole('menuitemcheckbox', { name: 'Raw Markdown' }).tap();
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
  await page.getByRole('button', { name: 'Menu' }).tap();
  await page.getByRole('menuitem', { name: 'View' }).tap();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Raw Markdown' })).toHaveAttribute('aria-checked', 'true');
});

test('drills into a submenu, goes back a level, and closes with ✕ and with the scrim', async ({ page }) => {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'Menu' }).tap();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await drawer.getByRole('menuitem', { name: 'View' }).tap();
  await drawer.getByRole('menuitem', { name: 'Theme' }).tap();
  await expect(drawer.getByRole('menuitemradio')).toHaveCount(3);
  await drawer.getByRole('button', { name: 'Back to menus' }).tap();
  await expect(drawer.getByRole('menuitem', { name: 'Theme' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Close menu' }).tap();
  await expect(drawer).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu' }).tap();
  await expect(drawer.getByRole('menuitem', { name: 'File' })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss menu' }).tap({ position: { x: 380, y: 300 } });
  await expect(drawer).toHaveCount(0);
});
