/** DialogHost: opening a dialog, resolving its result, Esc resolving the cancel result, queueing, and the host going away. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogHost, openDialog, registerDialog, type DialogClose } from './DialogHost';

type Answer = 'yes' | 'no' | 'cancel';

const ask = registerDialog(
  'test-ask',
  ({ question, close }: { question: string } & DialogClose<Answer>) => (
    <div
      role="dialog"
      aria-label={question}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close('cancel');
      }}
    >
      <p>{question}</p>
      <button onClick={() => close('yes')}>Yes</button>
      <button onClick={() => close('no')}>No</button>
    </div>
  ),
  'cancel' as Answer,
);

/** A second kind of dialog, with another result type. */
const counter = registerDialog(
  'test-counter',
  ({ close }: DialogClose<number>) => (
    <div role="dialog" aria-label="counter">
      <button onClick={() => close(1)}>Done</button>
    </div>
  ),
  0,
);

test('openDialog shows the dialog with its props, and resolves with the result it closes with', async () => {
  const user = userEvent.setup();
  render(<DialogHost />);
  expect(screen.queryByRole('dialog')).toBeNull();
  const result = openDialog(ask, { question: 'Keep going?' });
  expect(await screen.findByRole('dialog', { name: 'Keep going?' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'No' }));
  await expect(result).resolves.toBe('no');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('Esc resolves with the dialog\'s cancel result', async () => {
  const user = userEvent.setup();
  render(<DialogHost />);
  const result = openDialog(ask, { question: 'Sure?' });
  (await screen.findByRole('dialog')).focus();
  await user.keyboard('{Escape}');
  await expect(result).resolves.toBe('cancel');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a dialog opened while another is open waits, and is shown after the first resolves', async () => {
  const user = userEvent.setup();
  render(<DialogHost />);
  const order: string[] = [];
  const first = openDialog(ask, { question: 'First?' }).then((r) => order.push(`first:${r}`));
  const second = openDialog(ask, { question: 'Second?' }).then((r) => order.push(`second:${r}`));
  const third = openDialog(counter, {}).then((r) => order.push(`third:${r}`));
  expect(await screen.findByRole('dialog', { name: 'First?' })).toBeInTheDocument();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Yes' }));
  await first;
  expect(await screen.findByRole('dialog', { name: 'Second?' })).toBeInTheDocument();
  expect(order).toEqual(['first:yes']);
  await user.click(screen.getByRole('button', { name: 'No' }));
  await second;
  await user.click(await screen.findByRole('button', { name: 'Done' }));
  await third;
  expect(order).toEqual(['first:yes', 'second:no', 'third:1']);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a dialog that closes twice resolves once and does not skip the queue', async () => {
  const user = userEvent.setup();
  render(<DialogHost />);
  const first = openDialog(ask, { question: 'One?' });
  const second = openDialog(ask, { question: 'Two?' });
  const yes = await screen.findByRole('button', { name: 'Yes' });
  await user.dblClick(yes);
  await expect(first).resolves.toBe('yes');
  expect(await screen.findByRole('dialog', { name: 'Two?' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'No' }));
  await expect(second).resolves.toBe('no');
});

test('an unregistered id is rejected with a clear error', async () => {
  render(<DialogHost />);
  await expect(openDialog('nope', {})).rejects.toThrow('No dialog is registered as "nope".');
});

test('when the host unmounts, open and waiting dialogs resolve with their cancel results', async () => {
  const { unmount } = render(<DialogHost />);
  const open = openDialog(ask, { question: 'Open?' });
  const waiting = openDialog(counter, {});
  await screen.findByRole('dialog');
  unmount();
  await expect(open).resolves.toBe('cancel');
  await expect(waiting).resolves.toBe(0);
});
