import { expect, test, type Page } from '@playwright/test';

/** Flips Raw Markdown through the ☰ menu (View) (the top-bar switch is gone). */
async function toggleRaw(page: Page) {
  await page.getByRole('button', { name: 'Menu' }).tap();
  await page.getByRole('menuitem', { name: 'View' }).tap();
  await page.getByRole('menuitemcheckbox', { name: 'Raw Markdown' }).tap();
}

// A comment marker in a list item must not move when it is tapped. A real touch tap (Pixel 7, hasTouch) leaves a sticky :hover, which makes the marker inline-block; it must not inherit the item's negative hanging indent. Covers numbered, nested (two and three deep), bullet, task, plain and wrapped items, the marker at the start, middle and end of an item, in light and dark.

const m = (_n: number) => `[💬](#md-thread-cX)`; // the id is filled in per item by load()
const ITEMS = [
  ['numbered, middle', `1. Numbered ${m(1)} item`],
  ['numbered, start', `1. ${m(2)} Starts with a marker`],
  ['numbered, end', `1. Ends with a marker ${m(3)}`],
  ['nested, middle', `1. Parent\n    1. Child ${m(4)} here`],
  ['nested, start', `1. Parent\n    1. ${m(5)} child starts`],
  ['nested, end', `1. Parent\n    1. Child ends ${m(6)}`],
  ['three deep', `1. One\n    1. Two\n        1. Three ${m(7)} deep`],
  ['bullet, middle', `- Bullet ${m(8)} item`],
  ['task, middle', `- [ ] Task ${m(9)} item`],
  ['plain paragraph', `Plain ${m(10)} paragraph`],
  ['wrapped numbered', `1. A long numbered item that wraps onto several lines on a phone screen so the marker sits on a later line ${m(11)} end`],
] as const;

async function load(page: Page, items: readonly (readonly [string, string])[]) {
  const ids = items.map((_, i) => `c20260910143${String(i).padStart(3, '0')}a3f9c1`);
  const body = items.map(([, t], i) => t.replace(/md-thread-c\w+/, `md-thread-${ids[i]}`)).join('\n\n');
  const threads = ids.map((x, i) => `<!--\n@thread ${x}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nNote ${i}\n-->`).join('\n\n');
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'New' }).tap();
  await toggleRaw(page);
  await page.locator('.cm-content').tap();
  await page.keyboard.insertText(`${body}\n\n${threads}\n`);
  await toggleRaw(page);
  await expect(page.locator('.cm-thread-marker')).toHaveCount(items.length);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`tapping a marker does not move it or give it an indent (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await load(page, ITEMS);
    const markers = page.locator('.cm-thread-marker');
    // Samples the glyph centre (where the text is drawn, not the box) and the computed indent on every frame.
    const sample = (n: number) =>
      page.evaluate(async (i) => {
        const el = document.querySelectorAll('.cm-thread-marker')[i];
        const r = document.createRange();
        r.selectNodeContents(el);
        const line = el.closest('.cm-line')!;
        const out: { x: number; y: number; indent: string; hover: boolean }[] = [];
        for (let f = 0; f < 30; f++) {
          await new Promise((res) => requestAnimationFrame(res));
          const b = r.getBoundingClientRect();
          const l = line.getBoundingClientRect();
          // Relative to the line, so scrolling the editor when the Comments sheet opens does not count as movement.
          out.push({ x: Math.round((b.x + b.width / 2 - l.x) * 10) / 10, y: Math.round((b.y + b.height / 2 - l.y) * 10) / 10, indent: getComputedStyle(el).textIndent, hover: el.matches(':hover') });
        }
        return out;
      }, n);
    for (let i = 0; i < ITEMS.length; i++) {
      const label = ITEMS[i][0];
      const mk = markers.nth(i);
      await mk.scrollIntoViewIfNeeded();
      const before = (await sample(i))[0];
      const pending = sample(i);
      await mk.tap();
      // Chrome on Android sends a compatibility mousemove with the tap, which leaves the marker :hover until the next tap elsewhere; CDP touch does not, so send it.
      const box = (await mk.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const frames = await pending;
      const xs = frames.map((f) => f.x);
      const ys = frames.map((f) => f.y);
      console.log(`${label}: indent ${before.indent} -> ${[...new Set(frames.map((f) => f.indent))].join(',')}, x ${before.x} -> ${Math.min(...xs)}..${Math.max(...xs)}, hover frames ${frames.filter((f) => f.hover).length}`);
      expect(frames.some((f) => f.hover), `${label}: reached :hover`).toBe(true);
      expect(frames.every((f) => f.indent === '0px'), `${label}: text-indent`).toBe(true);
      expect(Math.max(...xs) - Math.min(...xs), `${label}: x moved`).toBeLessThan(1);
      expect(Math.max(...ys) - Math.min(...ys), `${label}: y moved`).toBeLessThan(1);
      expect(Math.abs(xs[xs.length - 1] - before.x), `${label}: x vs before the tap`).toBeLessThan(1);
      // Close the Comments sheet the tap opened, if there is one, so the next marker is reachable.
      await page.keyboard.press('Escape');
    }
  });
}
