import { expect, test, type Page } from '@playwright/test';

// A comment marker in a list item must not move when tapped: the sticky :hover an Android tap leaves makes it inline-block, which must not inherit the item's negative hanging indent.

const id = (n: number) => `c2026091014302${n}a3f9c1`;
const thread = (n: number) => `<!--\n@thread ${id(n)}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nNote ${n}\n-->`;
const DOC = [
  `1. Numbered [💬](#md-thread-${id(1)}) item`,
  `2. Nested parent\n    1. Nested child [💬](#md-thread-${id(2)}) here`,
  `- Bullet [💬](#md-thread-${id(3)}) item`,
  `- [ ] Task [💬](#md-thread-${id(4)}) item`,
  `Plain [💬](#md-thread-${id(5)}) paragraph`,
  `1. A long numbered item that wraps onto several lines on a phone screen so the marker sits on a later line [💬](#md-thread-${id(6)}) end`,
].join('\n\n') + '\n\n' + [1, 2, 3, 4, 5, 6].map(thread).join('\n\n') + '\n';

async function load(page: Page) {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'New' }).click();
  const sw = page.getByRole('switch', { name: 'Raw Markdown' });
  await sw.getByText('Raw', { exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.insertText(DOC);
  await sw.getByText('Formatted').click();
  await expect(page.locator('.cm-thread-marker')).toHaveCount(6);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`hovering a marker does not move it or give it an indent (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await load(page);
    const markers = page.locator('.cm-thread-marker');
    // The glyph itself (not its box): where the text is drawn.
    const glyph = (i: number) =>
      page.evaluate((n) => {
        const el = document.querySelectorAll('.cm-thread-marker')[n];
        const r = document.createRange();
        r.selectNodeContents(el);
        const b = r.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }, i);
    const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    // Samples the glyph centre on every frame while the pointer moves onto the marker.
    const trace = (i: number, x: number, y: number) =>
      page.evaluate(async ([n, px]) => {
        const el = document.querySelectorAll('.cm-thread-marker')[n as number];
        const r = document.createRange();
        r.selectNodeContents(el);
        const out: { x: number; hover: boolean }[] = [];
        for (let f = 0; f < 30; f++) {
          await new Promise((res) => requestAnimationFrame(res));
          const b = r.getBoundingClientRect();
          out.push({ x: Math.round((b.x + b.width / 2) * 10) / 10, hover: el.matches(':hover') });
          if (f === 2) (window as unknown as { go: () => void }).go?.();
        }
        return out;
      }, [i, x] as const);
    for (let i = 0; i < 6; i++) {
      const m = markers.nth(i);
      await m.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      const box = (await m.boundingBox())!;
      const pending = trace(i, 0, 0);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 1 });
      const frames = await pending;
      const xs = frames.map((f) => f.x);
      console.log(`marker ${i}: indent ${await m.evaluate((el) => getComputedStyle(el).textIndent)} x range ${Math.min(...xs)}..${Math.max(...xs)} hover frames ${frames.filter((f) => f.hover).length}`);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1);
    }
  });
}
