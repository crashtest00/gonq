import { expect, test, type Page } from '@playwright/test';

// The mobile GitHub sign-in screen on the mobile web build (Pixel 7 profile): every button is at least 44x44 CSS px.

async function expectTapTargets(page: Page) {
  const boxes = await page
    .locator('main button')
    .evaluateAll((els) =>
      els
        .map((el) => ({ el: el.outerHTML.slice(0, 80), r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0)
        .map(({ el, r }) => ({ el, w: r.width, h: r.height })),
    );
  expect(boxes.length).toBeGreaterThan(0);
  for (const b of boxes) {
    expect(b.w, b.el).toBeGreaterThanOrEqual(44);
    expect(b.h, b.el).toBeGreaterThanOrEqual(44);
  }
}

test('sign-in buttons have a 44x44 hit area in the idle and failed states', async ({ page }) => {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'Sign in to GitHub' }).click();
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expectTapTargets(page);

  // On the web the platform refuses: the banner shows the Gonq app wording and the screen offers Try again.
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('alert').first()).toContainText('needs the Gonq app');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expectTapTargets(page);
});
