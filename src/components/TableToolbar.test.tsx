import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { TableToolbar } from './TableToolbar';

const setup = (disabled: string[] = [], align: 'left' | 'center' | 'right' | null = null) => {
  const props = { onAction: vi.fn(), onReturn: vi.fn(), onLeave: vi.fn() };
  render(<TableToolbar target={{ disabled: disabled as never, align }} {...props} />);
  return props;
};

test('buttons run their action', () => {
  const p = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Insert column right' }));
  expect(p.onAction).toHaveBeenCalledWith('colRight');
});

test('disabled and pressed state come from the target', () => {
  setup(['delRow'], 'center');
  expect(screen.getByRole('button', { name: 'Delete row' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Align column center' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Align column left' })).toHaveAttribute('aria-pressed', 'false');
});

test('arrow keys move through the usable buttons; Escape returns to the cell', () => {
  const p = setup(['rowBelow']);
  const first = screen.getByRole('button', { name: 'Insert row above' });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(screen.getByRole('button', { name: 'Insert column left' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(screen.getByRole('button', { name: 'Delete table' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(p.onReturn).toHaveBeenCalled();
});

test('only one button is a tab stop', () => {
  setup();
  expect(screen.getAllByRole('button').filter((b) => b.tabIndex === 0)).toHaveLength(1);
});
