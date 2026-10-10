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

test('File > New gives an empty document and typed text shows in it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /^New/ }).click();
  await expect(page.getByRole('tab', { name: /Untitled\.md/ })).toBeVisible();
  await expect(page.locator('article')).toHaveText('');
  await page.getByText('Click here to start writing.').click();
  await page.keyboard.type('Hello browser');
  await expect(page.locator('article')).toContainText('Hello browser');
});
