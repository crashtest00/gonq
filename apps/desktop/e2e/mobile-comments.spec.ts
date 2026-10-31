import { expect, test, type Page } from '@playwright/test';

// The mobile Comments sheet on the Pixel 7 profile against /mobile/: top-bar button, 44x44 tap targets, and the docked sheet never covering the open thread's anchor (also with the on-screen keyboard's smaller visual viewport).

const ID = 'c20260910143022a3f9c1';
const filler = Array.from({ length: 40 }, (_, i) => `Filler paragraph ${i} with enough words to take a line or two on a phone.`).join('\n\n');
const DOC = `${filler}\n\nThe anchored words [💬](#md-thread-${ID}) sit far down.\n\n<!--\n@thread ${ID}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nWhere does this come from?\n-->\n`;

async function documentWithThread(page: Page) {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  const sw = page.getByRole('switch', { name: 'Raw Markdown' });
  await sw.getByText('Raw', { exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.insertText(DOC);
  await sw.getByText('Formatted').click();
  await expect(page.locator('.cm-thread-marker')).toHaveCount(1);
}

const boxes = (loc: ReturnType<Page['locator']>) =>
  loc.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }));

async function expectAnchorClear(page: Page) {
  const marker = (await page.locator('.cm-thread-marker').boundingBox())!;
  const sheet = (await page.getByRole('dialog', { name: 'Comments' }).boundingBox())!;
  const editor = (await page.locator('.cm-scroller').boundingBox())!;
  expect(marker.y).toBeGreaterThanOrEqual(editor.y - 1);
  expect(marker.y + marker.height).toBeLessThanOrEqual(sheet.y + 1);
  expect(sheet.y).toBeGreaterThanOrEqual(editor.y + editor.height - 1);
}

test('Comments button lists the thread; tap targets are at least 44x44', async ({ page }) => {
  await documentWithThread(page);
  await page.getByRole('button', { name: 'Comments' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Comments' });
  await expect(sheet.getByRole('listitem')).toHaveCount(1);
  await expect(sheet.getByText('No comments yet.')).toHaveCount(0);
  for (const b of [...(await boxes(sheet.getByRole('button'))), ...(await boxes(page.getByRole('button', { name: 'Comments' })))]) {
    expect(b.w).toBeGreaterThanOrEqual(44);
    expect(b.h).toBeGreaterThanOrEqual(44);
  }
  await sheet.getByRole('button', { name: /Where does this come from/ }).tap();
  for (const b of await boxes(sheet.getByRole('button'))) {
    expect(b.w).toBeGreaterThanOrEqual(44);
    expect(b.h).toBeGreaterThanOrEqual(44);
  }
  expect((await boxes(sheet.getByRole('textbox', { name: 'Reply' })))[0].h).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('the sheet does not cover the anchor, including with a keyboard-sized viewport', async ({ page }) => {
  await documentWithThread(page);
  await page.getByRole('button', { name: 'Comments' }).tap();
  await page.getByRole('button', { name: /Where does this come from/ }).tap();
  await expect(page.getByRole('textbox', { name: 'Reply' })).toBeVisible();
  await expectAnchorClear(page);
  // Emulates the on-screen keyboard: the shell height follows the visual viewport (--m-vvh).
  const full = page.viewportSize()!;
  await page.setViewportSize({ width: full.width, height: Math.round(full.height * 0.55) });
  await page.getByRole('textbox', { name: 'Reply' }).tap();
  await expect.poll(async () => {
    const marker = (await page.locator('.cm-thread-marker').boundingBox())!;
    const sheet = (await page.getByRole('dialog', { name: 'Comments' }).boundingBox())!;
    return marker.y + marker.height <= sheet.y + 1 && marker.y >= 0;
  }).toBe(true);
  await expectAnchorClear(page);
});

test('tapping the marker opens its thread, and Resolve then Reopen round-trips the badge', async ({ page }) => {
  await documentWithThread(page);
  await page.locator('.cm-thread-marker').tap();
  const sheet = page.getByRole('dialog', { name: 'Comments' });
  await expect(sheet.getByRole('button', { name: 'Close thread' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Resolve' }).tap();
  await expect(sheet.getByText('Resolved')).toBeVisible();
  await sheet.getByRole('button', { name: 'Reopen' }).tap();
  await expect(sheet.getByText('Open', { exact: true })).toBeVisible();
  await expectAnchorClear(page);
});
