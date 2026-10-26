/** The feature modules: a new feature file shows up in the rendered menu and no feature module imports isTauri. */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MenuBar } from '../components/MenuBar';
import type { CommandContext } from '../commands';
import { fixtureRun } from '../commands/fixtureFeature';

test('a fixture feature registering one command appears in the rendered File menu and runs', async () => {
  const ctx = { hasDocument: true, canUndo: false, canRedo: false } as unknown as CommandContext;
  render(<MenuBar ctx={ctx} hasDocument onInsertImage={() => {}} onInsertToc={() => {}} />);
  await userEvent.setup().click(screen.getByRole('menuitem', { name: 'File' }));
  const item = await screen.findByRole('menuitem', { name: /^Fixture Hello/ });
  expect(item).toHaveTextContent('Ctrl+Shift+H');
  // Last, after the Close Tab group.
  const names = screen.getAllByRole('menuitem').map((i) => i.textContent);
  expect(names[names.length - 1]).toMatch(/^Fixture Hello/);
  fireEvent.click(item);
  expect(fixtureRun.calls).toBe(1);
});

const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

test('no feature module imports isTauri: nothing is hidden or disabled by platform', () => {
  const files = Object.entries(sources).filter(([name]) => !name.endsWith('.test.ts'));
  expect(files.length).toBeGreaterThanOrEqual(3);
  for (const [name, source] of files) expect(source, name).not.toMatch(/isTauri/);
});
