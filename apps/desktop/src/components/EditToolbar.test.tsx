/** EditToolbar: each text-format button carries its own visual effect. */
import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { EditToolbar } from './EditToolbar';

const EFFECTS: [string, string][] = [
  ['Bold', 'font-bold'],
  ['Italic', 'italic'],
  ['Underline', 'underline'],
  ['Strikethrough', 'line-through'],
];

test.each(EFFECTS)('%s button carries its own text effect (%s)', (name, effect) => {
  render(<EditToolbar onSave={vi.fn()} canUndo={false} canRedo={false} onUndo={vi.fn()} onRedo={vi.fn()} onFormat={vi.fn()} />);
  const button = screen.getByRole('button', { name });
  expect(button).toHaveClass(effect);
  for (const [other, otherEffect] of EFFECTS) {
    if (other !== name) expect(button).not.toHaveClass(otherEffect);
  }
});

test('Save is the first button of the toolbar and calls onSave', async () => {
  const onSave = vi.fn();
  render(<EditToolbar onSave={onSave} canUndo={false} canRedo={false} onUndo={vi.fn()} onRedo={vi.fn()} onFormat={vi.fn()} />);
  const buttons = within(screen.getByRole('toolbar', { name: 'Editing' })).getAllByRole('button');
  expect(buttons[0]).toHaveAccessibleName('Save');
  buttons[0].click();
  expect(onSave).toHaveBeenCalledTimes(1);
});
