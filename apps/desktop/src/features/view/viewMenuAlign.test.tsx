/** View menu: the Raw Markdown and Theme labels share one left inset (every menu item reserves the indicator column), checked or not, with or without a tab. */
import { screen, waitFor } from '@testing-library/react';
import { openDocument, renderApp, testDoc } from '../../testing/renderApp';

const inset = (el: HTMLElement) => el.className.split(/\s+/).find((c) => /^pl-/.test(c));

async function openView(user: ReturnType<typeof renderApp>['user']) {
  await user.click(screen.getByRole('menuitem', { name: 'View' }));
  return {
    raw: await screen.findByRole('menuitemcheckbox', { name: /Raw Markdown/ }),
    theme: screen.getByRole('menuitem', { name: /^Theme/ }),
  };
}

test('Raw Markdown and Theme have the same left inset with no tab open (disabled)', async () => {
  const { user } = renderApp();
  const { raw, theme } = await openView(user);
  expect(raw).toHaveAttribute('data-disabled');
  expect(inset(raw)).toBeDefined();
  expect(inset(raw)).toBe(inset(theme));
});

test('the inset holds with Raw Markdown unchecked and checked', async () => {
  const { user } = renderApp({ docs: testDoc('hi') });
  await openDocument(user);
  let { raw, theme } = await openView(user);
  expect(raw).toHaveAttribute('aria-checked', 'false');
  expect(inset(raw)).toBe(inset(theme));
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('menuitem', { name: 'View' }));
  await user.click(await screen.findByRole('menuitemcheckbox', { name: /Raw Markdown/ }));
  ({ raw, theme } = await openView(user));
  expect(raw).toHaveAttribute('aria-checked', 'true');
  expect(inset(raw)).toBe(inset(theme));
});

test('Theme radio items share the inset (selection is covered by Theme.test)', async () => {
  const { user } = renderApp();
  const { theme } = await openView(user);
  await user.click(theme);
  const dark = await screen.findByRole('menuitemradio', { name: 'Dark' });
  expect(inset(dark)).toBe(inset(theme));
});
