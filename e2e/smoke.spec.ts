import { expect, test, type Page } from '@playwright/test';

test('web build loads with the menu bar and no page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('menuitem', { name: 'File' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('File menu opens in a real browser', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await expect(page.getByRole('menuitem', { name: /Connect to Server/ })).toBeVisible();
});

async function newDocument(page: Page) {
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /^New/ }).click();
  await expect(page.getByRole('tab', { name: /Untitled\.md/ })).toBeVisible();
}

const content = (page: Page) => page.locator('.cm-content');

test('File > New is an empty editor with the placeholder; clicking the canvas and typing shows a heading and bold as typed', async ({ page }) => {
  await newDocument(page);
  await expect(content(page)).toContainText('Click here to start writing.');
  await page.locator('.cm-editor').click();
  await page.keyboard.type('# Title');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Some **bold** text');
  await expect(page.locator('.cm-heading-1')).toHaveText('Title');
  await expect(page.locator('.cm-strong')).toHaveText('bold');
  // The caret is on the line, but outside the bold: its stars are hidden.
  await expect(content(page)).not.toContainText('**');
  // Move into the bold: the stars show.
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft');
  await expect(content(page)).toContainText('**bold**');
  // Another line: hidden again.
  await page.keyboard.press('ArrowUp');
  await expect(content(page)).not.toContainText('**');
});

test('clicking below the last line puts the caret at the end of the document', async ({ page }) => {
  await newDocument(page);
  await page.locator('.cm-editor').click();
  await page.keyboard.type('first\n\nlast');
  await page.keyboard.press('Control+Home');
  const box = (await page.locator('.cm-editor').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10);
  await page.keyboard.type('!');
  await expect(content(page)).toContainText('last!');
  expect(await page.locator('textarea').count()).toBe(0);
});

test('Raw shows plain monospace source in the same editor; an edit made there is kept', async ({ page }) => {
  await newDocument(page);
  await page.locator('.cm-editor').click();
  await page.keyboard.type('# Title\n\nSome **bold** text');
  await page.getByRole('switch', { name: /Raw Markdown/ }).click();
  await expect(content(page)).toContainText('# Title');
  await expect(content(page)).toContainText('**bold**');
  await expect(page.locator('.cm-heading-1')).toHaveCount(0);
  await expect(page.locator('.cm-editor')).toHaveClass(/cm-raw/);
  await page.locator('.cm-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('!');
  await page.getByRole('switch', { name: /Raw Markdown/ }).click();
  await expect(content(page)).toContainText('Some bold text!');
});

test('toolbar Bold and Undo change the editor text; each tab keeps its own text and caret', async ({ page }) => {
  await newDocument(page);
  await page.locator('.cm-editor').click();
  await page.keyboard.type('hello world');
  await page.keyboard.press('Shift+Control+ArrowLeft');
  await page.getByRole('button', { name: 'Bold' }).click();
  // The selection is inside the bold, so its stars are shown.
  await expect(page.locator('.cm-strong')).toHaveText('**world**');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.cm-strong')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('.cm-strong')).toHaveText('**world**');

  await page.getByRole('button', { name: 'New tab' }).click();
  await page.locator('.cm-editor').click();
  await page.keyboard.type('second tab');
  await page.getByRole('tab', { name: /Untitled\.md/ }).first().click();
  await expect(content(page)).toContainText('hello');
  await expect(content(page)).not.toContainText('second tab');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.cm-strong')).toHaveCount(0);
});

test('clicking a task checkbox toggles [ ] / [x] in the text; the outline follows typed headings', async ({ page }) => {
  await newDocument(page);
  await page.locator('.cm-editor').click();
  await page.keyboard.type('- [ ] one');
  await page.keyboard.press('Control+Home');
  await expect(page.locator('.cm-task-box')).toHaveCount(1);
  await page.locator('.cm-task-box').click();
  await expect(page.locator('.cm-task-box-checked')).toHaveCount(1);
  await page.getByRole('switch', { name: /Raw Markdown/ }).click();
  await expect(content(page)).toContainText('- [x] one');
  await page.getByRole('switch', { name: /Raw Markdown/ }).click();

  await page.getByRole('button', { name: 'Document outline' }).click();
  await page.locator('.cm-editor').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('# Typed heading\n\n');
  await expect(page.getByRole('complementary', { name: 'Outline' })).toContainText('Typed heading');
});

test('the table toolbar row shows only while the caret is in a table, and edits the source', async ({ page }) => {
  await newDocument(page);
  await page.locator('.cm-editor').click();
  await page.keyboard.type('before\n\n| h | i |\n| - | - |\n| a | b |\n\nafter');
  await page.keyboard.press('Control+Home');
  const table = page.locator('.cm-table');
  const bar = page.getByRole('toolbar', { name: 'Table' });
  await expect(table).toBeVisible();
  await expect(bar).toHaveCount(0);
  await table.hover();
  await expect(bar).toHaveCount(0);
  await page.locator('.cm-table th').first().click();
  await expect(bar).toBeVisible();
  await expect(page.locator('[data-op="delRow"]')).toBeDisabled();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('[data-op="rowAbove"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-table th').first()).toBeFocused();
  await page.locator('[data-op="colRight"]').click();
  await expect(page.locator('.cm-table th')).toHaveCount(3);
  await expect(bar).toBeVisible();
  // Leaving the table for the text hides the row again.
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
});

test('the table toolbar row follows undo/redo into the table and goes in Raw mode', async ({ page }) => {
  await newDocument(page);
  await page.locator('.cm-editor').click();
  await page.keyboard.type('before\n\n| h | i |\n| - | - |\n| a | b |\n\nafter');
  await page.keyboard.press('Control+Home');
  const bar = page.getByRole('toolbar', { name: 'Table' });
  await page.locator('.cm-table th').first().click();
  await page.locator('[data-op="colRight"]').click();
  await expect(page.locator('.cm-table th')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  // Undo changes the table: the row comes back, for the cell the change was in.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.cm-table th')).toHaveCount(2);
  await expect(bar).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('.cm-table th')).toHaveCount(3);
  await expect(bar).toBeVisible();
  // Raw mode has no table, so no row.
  await page.getByRole('switch', { name: /Raw Markdown/ }).click();
  await expect(page.locator('.cm-table')).toHaveCount(0);
  await expect(bar).toHaveCount(0);
  await page.getByRole('switch', { name: /Raw Markdown/ }).click();
  await expect(page.locator('.cm-table')).toBeVisible();
});

// The line the caret is on, read from the DOM selection.
const caretLine = (page: Page) =>
  page.evaluate(() => {
    const n = window.getSelection()?.anchorNode;
    const el = n instanceof Element ? n : n?.parentElement;
    return el?.closest('.cm-line')?.textContent ?? null;
  });

// Typing a table key by key re-renders the widget mid-word; paste the document in one step instead.
async function pasteText(page: Page, text: string) {
  await page.locator('.cm-editor').click();
  await page.evaluate((t) => {
    const data = new DataTransfer();
    data.setData('text/plain', t);
    document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

const TABLE = '| h | i |\n| - | - |\n| a | b |';
const section = (n: number) => `## Section ${n}\nbody ${n}a\nbody ${n}b`;

test('Up arrow below a table visits every line, one per press, and enters the last row', async ({ page }) => {
  await newDocument(page);
  await pasteText(page, `${TABLE}\n\n${[1, 2, 3, 4].map(section).join('\n')}`);
  await page.keyboard.press('Control+End');
  expect(await caretLine(page)).toContain('body 4b');
  for (const expected of ['body 4a', 'Section 4', 'body 3b', 'body 3a', 'Section 3', 'body 2b', 'body 2a', 'Section 2', 'body 1b', 'body 1a', 'Section 1', '']) {
    await page.keyboard.press('ArrowUp');
    const line = await caretLine(page);
    if (expected === '') expect(line).toBe('');
    else expect(line).toContain(expected);
  }
  // Up from the first line below the table enters its last row.
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.cm-table tr:last-child td').first()).toBeFocused();
});

test('Up and Down through a wrapped paragraph below a table move one visual line per press', async ({ page }) => {
  await newDocument(page);
  const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
  await pasteText(page, `${TABLE}\n\n${long}\n\nlast line`);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  const top = () => page.evaluate(() => window.getSelection()!.getRangeAt(0).getBoundingClientRect().top);
  const tops: number[] = [await top()];
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowUp'); tops.push(await top()); }
  // each press moves up exactly one visual line, and the caret stays in the paragraph
  const step = tops[0] - tops[1];
  expect(step).toBeGreaterThan(0);
  expect(await caretLine(page)).toContain('word');
  for (let i = 1; i < tops.length - 1; i++) expect(Math.abs(tops[i] - tops[i + 1])).toBeCloseTo(Math.abs(step), 0);
  await expect(page.locator('.cm-table td:focus')).toHaveCount(0);
});

for (const gap of ['\n\n', '\n']) {
  test(`Down through a wrapped paragraph above a table (${gap.length - 1} blank line) moves one visual line per press, then enters it`, async ({ page }) => {
    await newDocument(page);
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    await pasteText(page, `first\n\n${long}${gap}${TABLE}`);
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    expect(await caretLine(page)).toContain('word');
    const cell = page.locator('.cm-table th:focus, .cm-table td:focus');
    for (let i = 0; i < 60 && (await cell.count()) === 0; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);
    }
    // focus stays in the table cell, it does not bounce back to the editor
    await expect(cell).toHaveCount(1);
    await page.waitForTimeout(300);
    await expect(cell).toHaveCount(1);
  });
}

for (const tables of [1, 2]) {
  test(`clicking the middle of a paragraph line below ${tables} table(s) puts the caret on it`, async ({ page }) => {
    await newDocument(page);
    const parts = tables === 2 ? [TABLE, 'between', TABLE] : [TABLE];
    await pasteText(page, `${parts.join('\n\n')}\n\n${[1, 2, 3].map(section).join('\n\n')}`);
    await page.keyboard.press('Control+Home');
    for (const text of ['body 1a', 'body 2b', 'body 3a', 'Section 3']) {
      const line = page.locator('.cm-line', { hasText: text });
      await line.scrollIntoViewIfNeeded();
      const box = (await line.boundingBox())!;
      await page.mouse.click(box.x + 20, box.y + box.height / 2);
      expect(await caretLine(page)).toContain(text);
    }
  });
}
