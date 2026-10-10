import { expect, test } from '@playwright/test';

test('web build loads with the menu bar and no page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('menuitem', { name: 'File' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('File menu opens in a real browser', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await expect(page.getByRole('menuitem', { name: /Connect to Server/ })).toBeVisible();
});
