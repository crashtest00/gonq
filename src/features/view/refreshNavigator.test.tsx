/** View > Refresh Navigator: disabled until a folder or repository is shown in the navigator. */
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { renderApp } from '../../testing/renderApp';

test('View > Refresh Navigator is disabled while the navigator is closed', async () => {
  const { user } = renderApp();
  await user.click(screen.getByRole('menuitem', { name: 'View' }));
  expect(await screen.findByRole('menuitem', { name: 'Refresh Navigator' })).toHaveAttribute('data-disabled');
});
