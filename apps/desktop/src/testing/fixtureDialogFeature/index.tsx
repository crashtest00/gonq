/**
 * Test fixture: a feature folder shaped like src/features/<feature>/ that adds one item to the existing Help menu
 * and registers the dialog that item opens. It is loaded by fixtureFeature.test.tsx through import.meta.glob (the
 * mechanism commands/index.ts uses), so it never ships in the app.
 */
import { defineCommand } from '../../commands/registry';
import { openDialog, registerDialog, type DialogClose } from '../../dialogs/DialogHost';

export const fixtureDialog = registerDialog(
  'fixture-hello',
  ({ close }: DialogClose<void>) => (
    <div
      role="dialog"
      aria-label="Fixture hello"
      tabIndex={-1}
      ref={(el) => el?.focus()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <p>Hello from a fixture feature</p>
      <button onClick={() => close()}>Close</button>
    </div>
  ),
  undefined,
);

defineCommand({ id: 'fixture.dialog', menu: 'help', group: 9, order: 1, label: 'Fixture Dialog', run: () => void openDialog(fixtureDialog, {}) });
