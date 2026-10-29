/** Resizable side panes in the web build: drag to the limit, persistence across reload, double-click reset, keyboard. */
import { expect, test } from '@playwright/test';

test('the outline pane is resized by dragging, keeps its width after reload, and resets on double-click', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /^New/ }).click();
  await page.getByRole('button', { name: 'Document outline' }).click();
  const handle = page.getByRole('separator', { name: 'Resize outline' });
  const pane = page.getByRole('complementary', { name: 'Outline' });
  await expect(pane).toHaveCSS('width', '240px');
  const box = (await handle.boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y, { steps: 5 });
  await page.mouse.move(x + 3000, y, { steps: 2 }); // far past the window edge: stops at the maximum
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '480');
  await page.reload();
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /^New/ }).click();
  await page.getByRole('button', { name: 'Document outline' }).click();
  await expect(page.getByRole('separator', { name: 'Resize outline' })).toHaveAttribute('aria-valuenow', '480');
  await page.getByRole('separator', { name: 'Resize outline' }).dblclick();
  await expect(page.getByRole('separator', { name: 'Resize outline' })).toHaveAttribute('aria-valuenow', '240');
  await page.getByRole('separator', { name: 'Resize outline' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('separator', { name: 'Resize outline' })).toHaveAttribute('aria-valuenow', '256');
});
