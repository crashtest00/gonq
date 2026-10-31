/** Covers the mobile choice sheets: the unsaved-changes sheet (exact strings, Save focused, the three answers, scrim = Cancel), the commit-conflict sheet (both wordings, Cancel focused, Overwrite destructive), queued questions and the 44px classes. */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { DialogsProvider, useDialogs } from './dialogs';

type Answers = { unsaved: string[]; conflict: string[] };

function Harness({ answers }: { answers: Answers }) {
  const d = useDialogs();
  return (
    <>
      <button onClick={() => void d.confirmUnsaved('notes.md').then((c) => answers.unsaved.push(c))}>ask unsaved</button>
      <button onClick={() => void d.confirmConflict({ name: 'notes.md', deleted: false }).then((c) => answers.conflict.push(c))}>ask conflict</button>
      <button onClick={() => void d.confirmConflict({ name: 'notes.md', deleted: true }).then((c) => answers.conflict.push(c))}>ask deleted</button>
    </>
  );
}
function setup() {
  const answers: Answers = { unsaved: [], conflict: [] };
  render(
    <DialogsProvider>
      <Harness answers={answers} />
    </DialogsProvider>,
  );
  return { answers, user: userEvent.setup() };
}

it('the unsaved sheet has the desktop strings and Save is focused and primary', async () => {
  const { user } = setup();
  await user.click(screen.getByText('ask unsaved'));
  const dialog = await screen.findByRole('dialog', { name: 'Save changes to notes.md?' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(within(dialog).getByRole('heading')).toHaveTextContent(/^Save changes to notes\.md\?$/);
  expect(within(dialog).getByText('Your changes will be lost if you don’t save them.')).toBeInTheDocument();
  expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual(['Save', 'Don’t save', 'Cancel']);
  const save = within(dialog).getByRole('button', { name: 'Save' });
  expect(save).toHaveFocus();
  expect(save).toHaveClass('m-tap-primary');
  expect(within(dialog).getByRole('button', { name: 'Don’t save' })).toHaveClass('m-destructive');
  for (const b of within(dialog).getAllByRole('button')) expect(b).toHaveClass('m-tap');
});

it.each([
  ['Save', 'save'],
  ['Don’t save', 'discard'],
  ['Cancel', 'cancel'],
])('the unsaved sheet answers %s', async (label, answer) => {
  const { user, answers } = setup();
  await user.click(screen.getByText('ask unsaved'));
  await user.click(await screen.findByRole('button', { name: label }));
  expect(answers.unsaved).toEqual([answer]);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('tapping the scrim answers Cancel', async () => {
  const { user, answers } = setup();
  await user.click(screen.getByText('ask unsaved'));
  await user.click(await screen.findByTestId('choice-scrim'));
  expect(answers.unsaved).toEqual(['cancel']);
});

it('the conflict sheet says the server’s copy changed; Cancel is focused, Overwrite is destructive', async () => {
  const { user, answers } = setup();
  await user.click(screen.getByText('ask conflict'));
  const dialog = await screen.findByRole('dialog', { name: 'notes.md changed on the server since you opened it.' });
  expect(within(dialog).getByText('Overwrite replaces the server’s version with yours. Cancel keeps your changes unsaved.')).toBeInTheDocument();
  expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel', 'Overwrite']);
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  expect(within(dialog).getByRole('button', { name: 'Overwrite' })).toHaveClass('m-destructive');
  await user.click(within(dialog).getByRole('button', { name: 'Overwrite' }));
  expect(answers.conflict).toEqual(['overwrite']);
});

it('the conflict sheet has the deleted wording and Cancel keeps the changes unsaved', async () => {
  const { user, answers } = setup();
  await user.click(screen.getByText('ask deleted'));
  const dialog = await screen.findByRole('dialog', { name: 'notes.md was deleted on the server since you opened it.' });
  expect(within(dialog).getByText('Overwrite writes your version back as a new file. Cancel keeps your changes unsaved.')).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(answers.conflict).toEqual(['cancel']);
});

it('a second question waits for the first', async () => {
  const { user, answers } = setup();
  await user.click(screen.getByText('ask unsaved'));
  await user.click(screen.getByText('ask conflict'));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  await user.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(answers.unsaved).toEqual(['cancel']);
  expect(await screen.findByRole('dialog', { name: /changed on the server/ })).toBeInTheDocument();
});
