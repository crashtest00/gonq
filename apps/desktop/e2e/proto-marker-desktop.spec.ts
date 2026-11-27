// THROWAWAY prototype spec (spike 0b3e3429): active comment marker, desktop, light + dark screenshots.
import { expect, test } from '@playwright/test';
import { DOC } from './proto-doc';

test('desktop: selected thread marker is active', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /^New/ }).click();
  const sw = page.getByRole('switch', { name: /Raw Markdown/ });
  await sw.click();
  await page.locator('.cm-content').click();
  await page.keyboard.insertText(DOC);
  await sw.click();
  await expect(page.locator('.cm-thread-marker')).toHaveCount(4);
  await page.getByRole('button', { name: /Comments/ }).first().click();
  const side = page.getByRole('complementary', { name: 'Comments' });
  await page.screenshot({ path: '/tmp/shots/desktop-none-light.png' });
  await side.getByRole('button', { name: /First thread/ }).click();
  // Same id twice in the text: only the ordinal-0 marker has a block, so exactly one is active.
  await expect(page.locator('.cm-thread-active')).toHaveCount(1);
  await expect(page.locator('.cm-thread-active')).toHaveAttribute('data-thread-id', /c20260910143022a3f9c1/);
  await page.screenshot({ path: '/tmp/shots/desktop-active-light.png' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: '/tmp/shots/desktop-active-dark.png' });
  await side.getByRole('button', { name: 'Close thread' }).click();
  await expect(page.locator('.cm-thread-active')).toHaveCount(0);
  await side.getByRole('button', { name: /Second thread/ }).click();
  await expect(page.locator('.cm-thread-active')).toHaveCount(1);
  // Raw has no widget; coming back to Formatted keeps the active marker.
  await sw.click();
  await expect(page.locator('.cm-thread-marker')).toHaveCount(0);
  await sw.click();
  await expect(page.locator('.cm-thread-active')).toHaveCount(1);
  // Closing the sidebar clears it.
  await page.getByRole('button', { name: /Comments/ }).first().click();
  await expect(page.locator('.cm-thread-active')).toHaveCount(0);
});
