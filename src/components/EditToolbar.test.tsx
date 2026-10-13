import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { EditToolbar } from './EditToolbar';

const EFFECTS: [string, string][] = [
  ['Bold', 'font-bold'],
  ['Italic', 'italic'],
  ['Underline', 'underline'],
  ['Strikethrough', 'line-through'],
];

test.each(EFFECTS)('%s button carries its own text effect (%s)', (name, effect) => {
  render(<EditToolbar canUndo={false} canRedo={false} onUndo={vi.fn()} onRedo={vi.fn()} onFormat={vi.fn()} />);
  const button = screen.getByRole('button', { name });
  expect(button).toHaveClass(effect);
  for (const [other, otherEffect] of EFFECTS) {
    if (other !== name) expect(button).not.toHaveClass(otherEffect);
  }
});
