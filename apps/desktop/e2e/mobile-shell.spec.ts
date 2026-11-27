import { expect, test, type Page } from '@playwright/test';

// The mobile web build under its /mobile/ base, on a Pixel device profile, in light and dark.

async function documentsHome(page: Page) {
  await page.goto('/mobile/');
  await expect(page.getByRole('img', { name: 'Gonq', exact: true })).toBeVisible();
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`mobile shell (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test('serves from /mobile/, paints the splash with the logo, then the Gonq home', async ({ page }) => {
      await page.goto('/mobile/');
      await expect(page.getByRole('img', { name: 'Gonq logo' })).toBeVisible();
      await expect(page.getByRole('banner').getByRole('img', { name: 'Gonq', exact: true })).toBeVisible();
      await expect(page.getByText('No recent documents.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Documents' })).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe('/mobile/');
      await expect(page.locator('html')).toHaveClass(scheme === 'dark' ? /dark/ : /^(?!.*dark)/);
    });

    test('the top bar logo is the real asset, centred, and paints in this theme', async ({ page }) => {
      await documentsHome(page);
      const logo = page.getByRole('banner').getByRole('img', { name: 'Gonq', exact: true });
      await expect(logo).toHaveAttribute('src', /gonq-logo-OUTLINE/);
      expect(await logo.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      const box = (await logo.boundingBox())!;
      const bar = (await page.getByRole('banner').boundingBox())!;
      expect(Math.abs(box.x + box.width / 2 - (bar.x + bar.width / 2))).toBeLessThanOrEqual(2);
      for (const b of await page.getByRole('banner').getByRole('button').all()) {
        const bb = (await b.boundingBox())!;
        expect(bb.x + bb.width <= box.x || bb.x >= box.x + box.width).toBe(true);
      }
      expect(box.height).toBeGreaterThan(24);
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
