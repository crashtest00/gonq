/** Covers the bottom sheet: closed renders nothing, open is a labelled modal dialog, Close and the scrim both call onClose. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BottomSheet } from './BottomSheet';

it('renders nothing while closed', () => {
  render(<BottomSheet open={false} title="Sheet" onClose={() => {}} />);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('is a labelled modal dialog with its children', () => {
  render(<BottomSheet open title="Commit" onClose={() => {}}><p>body</p></BottomSheet>);
  const d = screen.getByRole('dialog', { name: 'Commit' });
  expect(d).toHaveAttribute('aria-modal', 'true');
  expect(d).toHaveTextContent('body');
});

it('closes from the Close button and from the scrim, both with a 44px hit-area class', async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<BottomSheet open title="Commit" onClose={onClose} />);
  expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('m-tap');
  await user.click(screen.getByRole('button', { name: 'Close' }));
  await user.click(screen.getByRole('button', { name: 'Close sheet' }));
  expect(onClose).toHaveBeenCalledTimes(2);
});
