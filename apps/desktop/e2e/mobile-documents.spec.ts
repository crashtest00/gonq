import { expect, test } from '@playwright/test';

// The mobile Documents home on the Pixel 7 profile: seeded recents (localStorage gonq.recentDocuments) and the
// entry points, with every interactive element measured against the 44x44 CSS px minimum.

const NOW = Date.now();
const recents = [
  { path: '/d/notes.md', openedAt: NOW - 60_000 * 5 },
  { path: 'github://northwind/platform-docs@main/docs/arch.md', openedAt: NOW - 3_600_000 * 3 },
  { path: '/d/old.md', openedAt: NOW - 86_400_000 * 2 },
];

test('Documents home rows, entry points and tap targets', async ({ page }) => {
  await page.addInitScript((rows) => localStorage.setItem('gonq.recentDocuments', JSON.stringify(rows)), recents);
  await page.goto('/mobile/');
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await expect(page.getByText('northwind/platform-docs @ main')).toBeVisible();
  await expect(page.getByText('5 min ago')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove notes.md from recent documents' })).toBeVisible();
  for (const name of ['Open Repo…', 'Open Folder…', 'New']) await expect(page.getByRole('button', { name })).toBeVisible();

  const boxes = await page.locator('button, a[href], input, [role=button]').evaluateAll((els) =>
    els
      .map((el) => ({ el: el.outerHTML.slice(0, 80), r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
      .map(({ el, r }) => ({ el, w: r.width, h: r.height })),
  );
  expect(boxes.length).toBeGreaterThanOrEqual(9);
  for (const b of boxes) {
    expect(b.w, b.el).toBeGreaterThanOrEqual(44);
    expect(b.h, b.el).toBeGreaterThanOrEqual(44);
  }
});

test('removing a recent drops its row and the stored entry', async ({ page }) => {
  await page.addInitScript((rows) => localStorage.getItem('seeded') || (localStorage.setItem('seeded', '1'), localStorage.setItem('gonq.recentDocuments', JSON.stringify(rows))), recents);
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'Remove old.md from recent documents' }).click();
  await expect(page.getByText('old.md')).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gonq.recentDocuments')!));
  expect(stored).toHaveLength(2);
});

test('Open Folder… shows the not-available error', async ({ page }) => {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'Open Folder…' }).click();
  await expect(page.getByRole('alert')).toContainText('not available yet');
});
