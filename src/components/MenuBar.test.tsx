/** MenuBar: Format mirrors the toolbar, link prompt, the Table sub-menu and its disabled state. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MenuBar } from './MenuBar';
import type { CommandContext } from '../commands';
import { EditToolbar } from './EditToolbar';
import { TableToolbar } from './TableToolbar';

const noop = () => {};

/** A CommandContext whose actions are all spies; `over` may carry hasDocument and onOpenRepo. */
const ctx = (over: { hasDocument?: boolean; onOpenRepo?: () => void }) =>
  ({ hasDocument: over.hasDocument ?? true, canUndo: false, canRedo: false, openRepo: over.onOpenRepo ?? noop }) as unknown as CommandContext;

function setup({ onOpenRepo, ...over }: Partial<Parameters<typeof MenuBar>[0]> & { onOpenRepo?: () => void } = {}) {
  const props = { onFormat: vi.fn(), onTableAction: vi.fn(), onFocusTableCell: vi.fn(), onFocusEditor: vi.fn() };
  render(
    <MenuBar
      hasDocument
      ctx={ctx({ hasDocument: over.hasDocument, onOpenRepo })}
      onInsertImage={noop}
      onInsertToc={noop}
      {...props}
      {...over}
    />,
  );
  return props;
}

const openFormat = async (user = userEvent.setup()) => {
  await user.click(screen.getByRole('menuitem', { name: 'Format' }));
  return user;
};

const names = (items: HTMLElement[]) => items.map((i) => i.textContent?.replace(/Ctrl\+\S+$/, ''));

test('Format lists every formatting action of the toolbar, with the same names', async () => {
  setup();
  await openFormat();
  const menu = screen.getByRole('menu');
  const items = names(within(menu).getAllByRole('menuitem'));
  render(<EditToolbar canUndo={false} canRedo={false} onUndo={noop} onRedo={noop} onFormat={noop} />);
  const toolbar = within(screen.getByRole('toolbar', { name: 'Editing' }))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'))
    .filter((n) => n !== 'Undo' && n !== 'Redo' && n !== 'Insert table');
  expect(items.slice(0, toolbar.length)).toEqual(toolbar);
  expect(items[items.length - 1]).toMatch(/^Table/);
});

test.each([
  ['Bold', 'bold'],
  ['Italic', 'italic'],
  ['Underline', 'underline'],
  ['Strikethrough', 'strike'],
  ['Bullet list', 'bullet'],
  ['Numbered list', 'numbered'],
  ['Checkbox list', 'task'],
])('%s runs the toolbar format %s', async (name, format) => {
  const p = setup();
  const user = await openFormat();
  await user.click(screen.getByRole('menuitem', { name: new RegExp(`^${name}(\\s|$)`) }));
  expect(p.onFormat).toHaveBeenCalledWith(format);
});

test('Insert link asks for the address like the toolbar button', async () => {
  const p = setup();
  vi.spyOn(window, 'prompt').mockReturnValue(' https://x.test ');
  const user = await openFormat();
  await user.click(screen.getByRole('menuitem', { name: /^Insert link/ }));
  expect(p.onFormat).toHaveBeenCalledWith('link', 'https://x.test');
});

test('Insert link changes nothing when the prompt is cancelled', async () => {
  const p = setup();
  vi.spyOn(window, 'prompt').mockReturnValue(null);
  const user = await openFormat();
  await user.click(screen.getByRole('menuitem', { name: /^Insert link/ }));
  expect(p.onFormat).not.toHaveBeenCalled();
});

async function openTable(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('menuitem', { name: 'Table' }));
  return screen.findByRole('menuitem', { name: 'Insert table' });
}

test('the Table sub-menu holds insert table and every table toolbar action', async () => {
  setup({ tableTarget: { disabled: [], align: null } });
  const user = await openFormat();
  await openTable(user);
  const sub = screen.getAllByRole('menu').slice(-1)[0];
  const shown = names(within(sub).getAllByRole('menuitem'));
  render(<TableToolbar target={{ disabled: [], align: null }} onAction={noop} onReturn={noop} onLeave={noop} />);
  const toolbar = within(screen.getByRole('toolbar', { name: 'Table' }))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'));
  expect(shown).toEqual(['Insert table', ...toolbar]);
});

test('Table items run the same actions as the table toolbar', async () => {
  const p = setup({ tableTarget: { disabled: [], align: null } });
  const user = await openFormat();
  fireEvent.click(await openTable(user));
  expect(p.onFormat).toHaveBeenCalledWith('table');
  await openFormat(user);
  await openTable(user);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Insert column right' }));
  expect(p.onTableAction).toHaveBeenCalledWith('colRight');
});

test('row and column actions are disabled, not hidden, without a table target (Raw mode)', async () => {
  const p = setup({ tableTarget: null });
  const user = await openFormat();
  await openTable(user);
  for (const name of ['Insert row above', 'Insert column left', 'Align column center', 'Delete row', 'Delete column', 'Delete table']) {
    expect(screen.getByRole('menuitem', { name })).toHaveAttribute('data-disabled');
  }
  expect(screen.getByRole('menuitem', { name: 'Insert table' })).not.toHaveAttribute('data-disabled');
  await user.click(screen.getByRole('menuitem', { name: 'Delete table' }));
  expect(p.onTableAction).not.toHaveBeenCalled();
});

test('actions the target cannot use are disabled', async () => {
  setup({ tableTarget: { disabled: ['delRow'], align: null } });
  const user = await openFormat();
  await openTable(user);
  expect(screen.getByRole('menuitem', { name: 'Delete row' })).toHaveAttribute('data-disabled');
  expect(screen.getByRole('menuitem', { name: 'Delete column' })).not.toHaveAttribute('data-disabled');
});

test('Format is disabled with no document open', () => {
  setup({ hasDocument: false });
  expect(screen.getByRole('menuitem', { name: 'Format' })).toBeDisabled();
});

test('File > Open Repo… is always enabled and calls onOpenRepo', async () => {
  const onOpenRepo = vi.fn();
  setup({ onOpenRepo, hasDocument: false });
  const user = userEvent.setup();
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  const item = screen.getByRole('menuitem', { name: 'Open Repo…' });
  expect(item).not.toHaveAttribute('data-disabled');
  await user.click(item);
  expect(onOpenRepo).toHaveBeenCalledTimes(1);
});
