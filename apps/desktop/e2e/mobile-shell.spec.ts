import { expect, test, type Page } from '@playwright/test';

// The mobile web build under its /mobile/ base, on a Pixel device profile, in light and dark.

async function documentsHome(page: Page) {
  await page.goto('/mobile/');
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`mobile shell (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test('serves from /mobile/, paints the splash with the logo, then the Documents home', async ({ page }) => {
      await page.goto('/mobile/');
      await expect(page.getByRole('img', { name: 'Gonq logo' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
      await expect(page.getByText('No recent documents.')).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/mobile/');
      await expect(page.locator('html')).toHaveClass(scheme === 'dark' ? /dark/ : /^(?!.*dark)/);
    });

    test('uses the phone viewport meta and does not scroll sideways', async ({ page }) => {
      await documentsHome(page);
      await expect(page.locator('meta[name=viewport]')).toHaveAttribute('content', /viewport-fit=cover/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('every visible interactive element has a hit area of at least 44x44 CSS px', async ({ page }) => {
      await documentsHome(page);
      const boxes = await page
        .locator('button, a[href], input, select, textarea, [role=button], [tabindex]:not([tabindex="-1"])')
        .evaluateAll((els) =>
          els
            .map((el) => ({ el: el.outerHTML.slice(0, 80), r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && r.height > 0)
            .map(({ el, r }) => ({ el, w: r.width, h: r.height })),
        );
      for (const b of boxes) {
        expect(b.w, b.el).toBeGreaterThanOrEqual(44);
        expect(b.h, b.el).toBeGreaterThanOrEqual(44);
      }
    });
  });
}
