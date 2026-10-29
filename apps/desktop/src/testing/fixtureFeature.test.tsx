/** A feature added without touching any existing file: one new Help item plus one new dialog, loaded by import.meta.glob and driven through renderApp(). */
import { screen, waitFor } from '@testing-library/react';
import { menu, renderApp } from './renderApp';

// The same loading mechanism as commands/index.ts, pointed at the fixture folder.
import.meta.glob('./fixtureDialogFeature/index.tsx', { eager: true });

test('a fixture feature adds a Help item that opens its own registered dialog, and closing it returns to the app', async () => {
  const { user } = renderApp();
  await menu(user, 'Help', /^Fixture Dialog/);
  const dialog = await screen.findByRole('dialog', { name: 'Fixture hello' });
  expect(dialog).toHaveTextContent('Hello from a fixture feature');
  await user.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Fixture hello' })).toBeNull());
  // The existing Help items are still there, unchanged.
  await user.click(screen.getByRole('menuitem', { name: 'Help' }));
  expect(await screen.findByRole('menuitem', { name: /^About Gonq/ })).toBeInTheDocument();
});
