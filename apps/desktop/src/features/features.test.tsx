/** The feature modules: a new feature file shows up in the rendered menu (the isTauri check lives with the features, in packages/editor). */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MenuBar } from '../components/MenuBar';
import type { CommandContext } from '@gonq/editor/commands';
import { fixtureRun } from '@gonq/editor/commands/fixtureFeature';

test('a fixture feature registering one command appears in the rendered File menu and runs', async () => {
  const ctx = { hasDocument: true, canUndo: false, canRedo: false, raw: false, theme: 'auto', tableTarget: null } as unknown as CommandContext;
  render(<MenuBar ctx={ctx} />);
  await userEvent.setup().click(screen.getByRole('menuitem', { name: 'File' }));
  const item = await screen.findByRole('menuitem', { name: /^Fixture Hello/ });
  expect(item).toHaveTextContent('Ctrl+Shift+H');
  // Last, after the Close Tab group.
  const names = screen.getAllByRole('menuitem').map((i) => i.textContent);
  expect(names[names.length - 1]).toMatch(/^Fixture Hello/);
  fireEvent.click(item);
  expect(fixtureRun.calls).toBe(1);
});
