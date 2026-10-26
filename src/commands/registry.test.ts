/** The command registry: ordering, separators, enabled/checked, sub-menus, throwing predicates, shortcut matching and duplicate shortcuts. */
import { vi } from 'vitest';
import { createRegistry, type CommandSpec } from './registry';

type Ctx = { on: boolean };
const base = { menu: 'm', group: 0, order: 0, run: () => {} };
const fresh = () => {
  const r = createRegistry<Ctx>();
  r.defineMenu({ id: 'm', label: 'M', order: 1 });
  return r;
};
const spec = (id: string, over: Partial<CommandSpec<Ctx>> = {}): CommandSpec<Ctx> => ({ ...base, id, label: id, ...over });
const shape = (r: ReturnType<typeof fresh>, ctx: Ctx = { on: true }) =>
  r.resolveMenus(ctx)[0].entries.map((e) => (e.type === 'separator' ? '---' : e.command.id));

test('orders by group, then order, then id, whatever the registration order', () => {
  const r = fresh();
  r.defineCommand(spec('d', { group: 1, order: 1 }));
  r.defineCommand(spec('b', { order: 5 }));
  r.defineCommand(spec('c', { order: 5 }));
  r.defineCommand(spec('a', { order: 9 }));
  expect(shape(r)).toEqual(['b', 'c', 'a', '---', 'd']);
});

test('orders menus by order, then id', () => {
  const r = createRegistry<Ctx>();
  r.defineMenu({ id: 'z', label: 'Z', order: 1 });
  r.defineMenu({ id: 'b', label: 'B', order: 2 });
  r.defineMenu({ id: 'a', label: 'A', order: 2 });
  expect(r.resolveMenus({ on: true }).map((m) => m.menu.id)).toEqual(['z', 'a', 'b']);
});

test('puts a separator between groups only', () => {
  const r = fresh();
  r.defineCommand(spec('a', { group: 0 }));
  r.defineCommand(spec('b', { group: 0, order: 1 }));
  r.defineCommand(spec('c', { group: 3 }));
  r.defineCommand(spec('d', { group: 7 }));
  expect(shape(r)).toEqual(['a', 'b', '---', 'c', '---', 'd']);
});

test('enabled and checked come from the context; absent means enabled and unchecked', () => {
  const r = fresh();
  r.defineCommand(spec('plain'));
  r.defineCommand(spec('gated', { order: 1, kind: 'checkbox', enabled: (c) => c.on, checked: (c) => c.on }));
  const state = (ctx: Ctx) => r.resolveMenus(ctx)[0].entries.map((e) => e.type === 'item' && [e.enabled, e.checked]);
  expect(state({ on: true })).toEqual([[true, false], [true, true]]);
  expect(state({ on: false })).toEqual([[true, false], [false, false]]);
});

test('sub-menu items are listed under their parent, ordered and separated like any menu', () => {
  const r = fresh();
  r.defineCommand({ ...spec('sub', { kind: 'submenu' }), run: undefined });
  r.defineCommand(spec('x', { parent: 'sub', order: 2 }));
  r.defineCommand(spec('y', { parent: 'sub', order: 1 }));
  r.defineCommand(spec('z', { parent: 'sub', group: 1 }));
  r.defineCommand(spec('top', { order: 1 }));
  const entries = r.resolveMenus({ on: true })[0].entries;
  expect(entries.map((e) => (e.type === 'separator' ? '---' : e.command.id))).toEqual(['sub', 'top']);
  const sub = entries[0];
  expect(sub.type === 'submenu' && sub.items.map((e) => (e.type === 'separator' ? '---' : e.command.id))).toEqual(['y', 'x', '---', 'z']);
});

test('an enabled() or checked() that throws greys the item and logs, and the rest still resolves', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const r = fresh();
  r.defineCommand(spec('bad', { kind: 'checkbox', enabled: () => { throw new Error('boom'); }, checked: () => { throw new Error('boom'); } }));
  r.defineCommand(spec('good', { order: 1 }));
  const [first, second] = r.resolveMenus({ on: true })[0].entries;
  expect(first).toMatchObject({ enabled: false, checked: false });
  expect(second).toMatchObject({ enabled: true });
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});

test('a menu whose enabled() throws is disabled', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const r = createRegistry<Ctx>();
  r.defineMenu({ id: 'm', label: 'M', order: 1, enabled: () => { throw new Error('boom'); } });
  expect(r.resolveMenus({ on: true })[0].enabled).toBe(false);
  log.mockRestore();
});

test('the menu shows the shortcut, else the hint; showShortcut false hides it', () => {
  const r = fresh();
  r.defineCommand(spec('a', { shortcut: 'Ctrl+N' }));
  r.defineCommand(spec('b', { order: 1, hint: 'Ctrl+B' }));
  r.defineCommand(spec('c', { order: 2, shortcut: 'Ctrl+W', showShortcut: false }));
  expect(r.resolveMenus({ on: true })[0].entries.map((e) => e.type === 'item' && e.shortcut)).toEqual(['Ctrl+N', 'Ctrl+B', undefined]);
});

test('two commands with the same shortcut fail, naming both ids', () => {
  const r = fresh();
  r.defineCommand(spec('first', { shortcut: 'Ctrl+N' }));
  expect(() => r.defineCommand(spec('second', { shortcut: 'ctrl+n' }))).toThrow(/"first".*"second"/);
  expect(() => r.defineCommand(spec('third', { aliases: ['Ctrl+N'] }))).toThrow(/"first".*"third"/);
  // Shift makes it another key.
  expect(() => r.defineCommand(spec('fourth', { shortcut: 'Ctrl+Shift+N' }))).not.toThrow();
});

test('a duplicate id fails; CodeMirror-owned keys cannot be bound, only hinted', () => {
  const r = fresh();
  r.defineCommand(spec('a'));
  expect(() => r.defineCommand(spec('a'))).toThrow(/already defined/);
  for (const key of ['Ctrl+B', 'Ctrl+I', 'Ctrl+U', 'Ctrl+K', 'Ctrl+Shift+X', 'Ctrl+F']) {
    expect(() => r.defineCommand(spec(`k${key}`, { shortcut: key }))).toThrow(/owned by the editor/);
  }
  expect(() => r.defineCommand(spec('hinted', { hint: 'Ctrl+B' }))).not.toThrow();
});

test('matchShortcut: Ctrl or Cmd, no Alt, exact Shift, aliases, and text fields for skipInTextFields', () => {
  const r = fresh();
  r.defineCommand(spec('redo', { shortcut: 'Ctrl+Y', aliases: ['Ctrl+Shift+Z'], skipInTextFields: true }));
  const input = document.createElement('input');
  const key = (k: string, over: Partial<KeyboardEvent> = {}) =>
    r.matchShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: k, target: document.body, ...over })?.id;
  expect(key('y')).toBe('redo');
  expect(key('Z', { shiftKey: true })).toBe('redo');
  expect(key('y', { ctrlKey: false, metaKey: true })).toBe('redo');
  expect(key('y', { ctrlKey: false })).toBeUndefined();
  expect(key('y', { altKey: true })).toBeUndefined();
  expect(key('y', { shiftKey: true })).toBeUndefined();
  expect(key('y', { target: input })).toBeUndefined();
});
