/** Desktop web build: the marker of the thread open in the Comments sidebar is active (class, aria-current, a visible ring) and does not move, in light and dark; it clears on Close thread and when the sidebar closes. */
import { expect, test, type Page } from '@playwright/test';

const A = 'c20260910143000a3f9c1';
const B = 'c20260910143001a3f9c1';
const blk = (id: string, body: string) => `<!--\n@thread ${id}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\n${body}\n-->`;
const DOC = `1. Numbered [💬](#md-thread-${A}) item\n\n- Bullet [💬](#md-thread-${B}) item\n\n${blk(A, 'First note')}\n\n${blk(B, 'Second note')}\n`;

async function load(page: Page) {
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /^New/ }).click();
  await page.getByRole('switch', { name: /Raw Markdown/ }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.insertText(DOC);
  await page.getByRole('switch', { name: /Raw Markdown/ }).click();
  await expect(page.locator('.cm-thread-marker')).toHaveCount(2);
}

// The glyph centre relative to its line, so the sidebar opening does not count as movement.
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
    const before = [await where(page, 0), await where(page, 1)];
    await page.getByRole('button', { name: 'Comments' }).click();
    await expect(page.locator('.cm-thread-active')).toHaveCount(0);
    await page.getByRole('complementary', { name: 'Comments' }).getByRole('list').getByRole('button').nth(0).click();
    await expect(page.locator('.cm-thread-active')).toHaveCount(1);
    await expect(markers.nth(0)).toHaveClass(/cm-thread-active/);
    await expect(markers.nth(0)).toHaveAttribute('aria-current', 'true');
    await expect(markers.nth(1)).not.toHaveClass(/cm-thread-active/);
    expect(await markers.nth(0).evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
    expect(await where(page, 0)).toEqual(before[0]);
    await page.getByRole('button', { name: 'Close thread' }).click();
    await expect(page.locator('.cm-thread-active')).toHaveCount(0);
    await page.getByRole('complementary', { name: 'Comments' }).getByRole('list').getByRole('button').nth(1).click();
    await expect(markers.nth(1)).toHaveClass(/cm-thread-active/);
    expect(await where(page, 1)).toEqual(before[1]);
    await page.getByRole('button', { name: 'Comments' }).click();
    await expect(page.locator('.cm-thread-active')).toHaveCount(0);
  });
}
