/** Mobile web build (Pixel 7): the marker of the thread open in the Comments sheet is active (class, aria-current, a visible ring) and does not move, in light and dark; it clears on Back and when the sheet closes. */
import { expect, test, type Page } from '@playwright/test';

const A = 'c20260910143000a3f9c1';
const B = 'c20260910143001a3f9c1';
const blk = (id: string, body: string) => `<!--\n@thread ${id}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\n${body}\n-->`;
const DOC = `1. Numbered [💬](#md-thread-${A}) item\n\n- Bullet [💬](#md-thread-${B}) item\n\n${blk(A, 'First note')}\n\n${blk(B, 'Second note')}\n`;

async function toggleRaw(page: Page) {
  await page.getByRole('button', { name: 'Menu' }).tap();
  await page.getByRole('menuitem', { name: 'View' }).tap();
  await page.getByRole('menuitemcheckbox', { name: 'Raw Markdown' }).tap();
}

async function load(page: Page) {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'New' }).tap();
  await toggleRaw(page);
  await page.locator('.cm-content').tap();
  await page.keyboard.insertText(DOC);
  await toggleRaw(page);
  await expect(page.locator('.cm-thread-marker')).toHaveCount(2);
}

// The glyph centre relative to its line, so the docked sheet does not count as movement.
const where = (page: Page, i: number) =>
  page.evaluate((n) => {
    const el = document.querySelectorAll('.cm-thread-marker')[n];
    const b = el.getBoundingClientRect();
    const l = el.closest('.cm-line')!.getBoundingClientRect();
    return { x: Math.round((b.x - l.x) * 10) / 10, y: Math.round((b.y - l.y) * 10) / 10 };
  }, i);

for (const scheme of ['light', 'dark'] as const) {
  test(`the open thread's marker is active and does not move (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await load(page);
    const markers = page.locator('.cm-thread-marker');
    const before = await where(page, 0);
    await page.getByRole('button', { name: 'Comments' }).tap();
    const sheet = page.getByRole('dialog', { name: 'Comments' });
    await expect(sheet).toBeVisible();
    await expect(page.locator('.cm-thread-active')).toHaveCount(0);
    await sheet.getByRole('button', { name: /First note/ }).tap();
    await expect(markers.nth(0)).toHaveClass(/cm-thread-active/);
    await expect(markers.nth(0)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.cm-thread-active')).toHaveCount(1);
    expect(await markers.nth(0).evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
    expect(await where(page, 0)).toEqual(before);
    await sheet.getByRole('button', { name: 'Back' }).tap();
    await expect(page.locator('.cm-thread-active')).toHaveCount(0);
    await sheet.getByRole('button', { name: /Second note/ }).tap();
    await expect(markers.nth(1)).toHaveClass(/cm-thread-active/);
    await page.getByRole('button', { name: 'Comments' }).tap();
    await expect(page.locator('.cm-thread-active')).toHaveCount(0);
  });
}
