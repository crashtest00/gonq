// THROWAWAY prototype spec (spike 0b3e3429): active comment marker, mobile sheet, light + dark screenshots.
import { expect, test } from '@playwright/test';
import { DOC } from './proto-doc';

test('mobile: marker of the thread open in the sheet is active, list view clears it', async ({ page }) => {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'New' }).click();
  const sw = page.getByRole('switch', { name: 'Raw Markdown' });
  await sw.getByText('Raw', { exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.insertText(DOC);
  await sw.getByText('Formatted').click();
  await expect(page.locator('.cm-thread-marker')).toHaveCount(4);
  await page.getByRole('button', { name: 'Comments' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Comments' });
  await expect(page.locator('.cm-thread-active')).toHaveCount(0);
  await sheet.getByRole('button', { name: /First thread/ }).tap();
  await expect(page.locator('.cm-thread-active')).toHaveCount(1);
  await page.screenshot({ path: '/tmp/shots/mobile-active-light.png' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: '/tmp/shots/mobile-active-dark.png' });
  await sheet.getByRole('button', { name: 'Back' }).tap();
  await expect(page.locator('.cm-thread-active')).toHaveCount(0);
  await sheet.getByRole('button', { name: /Second thread/ }).tap();
  await expect(page.locator('.cm-thread-active')).toHaveCount(1);
});
