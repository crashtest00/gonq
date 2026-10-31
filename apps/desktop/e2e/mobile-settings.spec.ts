import { expect, test, type Page } from '@playwright/test';

// The mobile Settings, About and Agent skill screens on the mobile web build (Pixel 7 profile): every interactive
// element is at least 44x44 CSS px, and the ⋯ menu reaches them and the theme choice.

async function expectTapTargets(page: Page, scope = 'main') {
  const boxes = await page
    .locator(`${scope} button, ${scope} a, ${scope} input, ${scope} [role="region"][tabindex]`)
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

async function openFromMenu(page: Page, item: string) {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: item }).click();
}

test('the ⋯ menu buttons and theme choices have 44x44 hit areas, and Dark applies at once', async ({ page }) => {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'More' }).click();
  await expectTapTargets(page, '[role="dialog"]');
  await page.getByRole('radio', { name: /Dark/ }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('Settings: author name, GitHub row and buttons are at least 44x44', async ({ page }) => {
  await openFromMenu(page, 'Settings…');
  await expect(page.getByLabel('Author name')).toBeVisible();
  await expect(page.getByText('GitHub sign-in needs the Gonq app.')).toBeVisible();
  await expectTapTargets(page);
  await page.getByLabel('Author name').fill('a|b');
  await expect(page.getByRole('alert')).toContainText('cannot contain');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expectTapTargets(page);
});

test('About: link and Close are at least 44x44; no tagline', async ({ page }) => {
  await openFromMenu(page, 'About Gonq');
  await expect(page.getByRole('img', { name: 'Gonq logo' })).toBeVisible();
  await expect(page.getByText(/^Version 0\.1\.\d+$/)).toBeVisible();
  await expectTapTargets(page);
});

test('Agent skill: Copy, Save as… and Close are at least 44x44 and nothing clips off screen', async ({ page }) => {
  await openFromMenu(page, 'Agent skill…');
  await expect(page.getByRole('region', { name: 'SKILL.md' })).toBeVisible();
  await expectTapTargets(page);
  const strip = page.getByRole('group', { name: 'Agent skill actions' });
  const fits = await strip.evaluate((el) => el.scrollWidth <= el.clientWidth || getComputedStyle(el).overflowX === 'auto');
  expect(fits).toBe(true);
});
