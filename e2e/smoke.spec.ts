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
