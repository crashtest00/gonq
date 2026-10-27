/**
 * The command registry: feature modules call defineCommand/defineMenu (src/features/<x>/index.ts) and the menu
 * bar and the keydown handler are generated from what they registered. Exports defineCommand, defineMenu,
 * resolveMenus (the ordered menu tree for a CommandContext), resolveContextMenu (the editor's right-click items), matchShortcut/installShortcuts (the one keydown
 * handler) and createRegistry for isolated registries in tests.
 */
import type { LucideIcon } from 'lucide-react';
import type { CommandContext } from './context';

export type CommandKind = 'item' | 'checkbox' | 'radio' | 'submenu';

export interface CommandSpec<C = CommandContext> {
  id: string;
  /** The menu bar menu this command is listed in; omit for a command only in the editor's right-click menu. */
  menu?: string;
  /** Items of different groups are separated; groups sort ascending. */
  group: number;
  /** Position inside the group; ties are broken by id. */
  order: number;
  label: string;
  /** Also lists the command in the editor's right-click menu, with its own group and order there (and optionally its own label). */
  contextMenu?: { group: number; order: number; label?: string };
  /** Drawn before the label (a lucide icon); it is decoration, so the item's name stays the label. */
  icon?: LucideIcon;
  /** Classes for the label text only (the Bold item shows its label bold). */
  labelClass?: string;
  /** Binds the key ("Ctrl+N", "Ctrl+Shift+S", "Ctrl+,"; Cmd counts as Ctrl) and is the text shown in the menu. */
  shortcut?: string;
  /** Further keys that run the command; not shown. */
  aliases?: string[];
  /** Shown instead of a shortcut for keys CodeMirror owns; binds nothing. */
  hint?: string;
  /** false: the shortcut is bound but not shown in the menu. */
  showShortcut?: boolean;
  /** The shortcut does nothing inside input, textarea and the editor, where the field handles the key itself. */
  skipInTextFields?: boolean;
  /** After the item is picked, the focus goes to the editor instead of back to the menu button. */
  focusEditor?: boolean;
  kind?: CommandKind;
  /** The id of the submenu command this item is listed in. */
  parent?: string;
  enabled?(ctx: C): boolean;
  checked?(ctx: C): boolean;
  run?(ctx: C): unknown;
}

export interface MenuSpec<C = CommandContext> {
  id: string;
  label: string;
  order: number;
  enabled?(ctx: C): boolean;
  /** When the menu closes the focus goes here (and not back to the menu button), whichever item was picked. */
  closeFocus?(ctx: C): void;
}

export type MenuEntry<C = CommandContext> =
  | { type: 'separator' }
  | { type: 'item'; command: CommandSpec<C>; enabled: boolean; checked: boolean; shortcut?: string }
  | { type: 'submenu'; command: CommandSpec<C>; enabled: boolean; items: MenuEntry<C>[] };

export interface ContextMenuEntry<C = CommandContext> {
  command: CommandSpec<C>;
  label: string;
  enabled: boolean;
  /** A divider is drawn above the item (its group differs from the previous item's). */
  divider: boolean;
}

export interface ResolvedMenu<C = CommandContext> {
  menu: MenuSpec<C>;
  enabled: boolean;
  entries: MenuEntry<C>[];
}

/** Codemirror's own keys (formatCommands.ts, extensions.ts, search); a command may only show them as a hint. */
const CODEMIRROR_KEYS = ['Ctrl+B', 'Ctrl+I', 'Ctrl+U', 'Ctrl+K', 'Ctrl+Shift+X', 'Ctrl+F'];

interface Key {
  shift: boolean;
  key: string;
}

function parseShortcut(id: string, text: string): Key {
  const m = /^Ctrl\+(Shift\+)?(.+)$/i.exec(text);
  if (m === null) throw new Error(`Command "${id}": shortcut "${text}" must look like "Ctrl+N" or "Ctrl+Shift+N".`);
  return { shift: m[1] !== undefined, key: m[2].toLowerCase() };
}
const keyName = (k: Key) => `${k.shift ? 'shift+' : ''}${k.key}`;

/** Runs a predicate for the menu (`absent` when there is none); one that throws counts as false and is logged, never breaking the bar. */
function guarded<C>(id: string, what: string, fn: ((ctx: C) => boolean) | undefined, ctx: C, absent: boolean): boolean {
  if (fn === undefined) return absent;
  try {
    return fn(ctx);
  } catch (e) {
    console.error(`Command "${id}": ${what}() threw; treating it as false.`, e);
    return false;
  }
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function createRegistry<C = CommandContext>() {
  const commands = new Map<string, CommandSpec<C>>();
  const menus = new Map<string, MenuSpec<C>>();
  const keys = new Map<string, string>();

  function defineMenu(spec: MenuSpec<C>): MenuSpec<C> {
    if (menus.has(spec.id)) throw new Error(`Menu "${spec.id}" is already defined.`);
    menus.set(spec.id, spec);
    return spec;
  }

  function defineCommand(spec: CommandSpec<C>): CommandSpec<C> {
    if (commands.has(spec.id)) throw new Error(`Command "${spec.id}" is already defined.`);
    if ((spec.kind ?? 'item') !== 'submenu' && spec.run === undefined) throw new Error(`Command "${spec.id}" has no run().`);
    const bound = [...(spec.shortcut === undefined ? [] : [spec.shortcut]), ...(spec.aliases ?? [])].map((s) => ({ text: s, key: parseShortcut(spec.id, s) }));
    const claimed: string[] = [];
    for (const { text, key } of bound) {
      const name = keyName(key);
      const owner = CODEMIRROR_KEYS.find((k) => keyName(parseShortcut(spec.id, k)) === name);
      if (owner !== undefined) throw new Error(`Command "${spec.id}": ${text} is owned by the editor; use hint instead of a shortcut.`);
      const other = keys.get(name) ?? (claimed.includes(name) ? spec.id : undefined);
      if (other !== undefined) throw new Error(`Commands "${other}" and "${spec.id}" both register the shortcut ${text}.`);
      claimed.push(name);
    }
    for (const name of claimed) keys.set(name, spec.id);
    commands.set(spec.id, spec);
    return spec;
  }

  function entriesOf(menuId: string, parent: string | undefined, ctx: C): MenuEntry<C>[] {
    const list = [...commands.values()]
      .filter((c) => c.menu === menuId && c.parent === parent)
      .sort((a, b) => a.group - b.group || a.order - b.order || byId(a, b));
    const out: MenuEntry<C>[] = [];
    let prev: CommandSpec<C> | undefined;
    for (const command of list) {
      if (prev !== undefined && prev.group !== command.group) out.push({ type: 'separator' });
      prev = command;
      const enabled = guarded(command.id, 'enabled', command.enabled, ctx, true);
      if (command.kind === 'submenu') {
        out.push({ type: 'submenu', command, enabled, items: entriesOf(menuId, command.id, ctx) });
        continue;
      }
      const shown = command.showShortcut === false ? undefined : (command.shortcut ?? command.hint);
      out.push({
        type: 'item',
        command,
        enabled,
        checked: guarded(command.id, 'checked', command.checked, ctx, false),
        ...(shown === undefined ? {} : { shortcut: shown }),
      });
    }
    return out;
  }

  /** The editor's right-click menu: every command with a `contextMenu` placement, grouped and ordered by it. */
  function resolveContextMenu(ctx: C): ContextMenuEntry<C>[] {
    const list = [...commands.values()]
      .filter((c) => c.contextMenu !== undefined)
      .sort((a, b) => a.contextMenu!.group - b.contextMenu!.group || a.contextMenu!.order - b.contextMenu!.order || byId(a, b));
    return list.map((command, i) => ({
      command,
      label: command.contextMenu!.label ?? command.label,
      enabled: guarded(command.id, 'enabled', command.enabled, ctx, true),
      divider: i > 0 && list[i - 1].contextMenu!.group !== command.contextMenu!.group,
    }));
  }

  /** Every menu in order with its entries. */
  function resolveMenus(ctx: C): ResolvedMenu<C>[] {
    return [...menus.values()]
      .sort((a, b) => a.order - b.order || byId(a, b))
      .map((menu) => ({ menu, enabled: guarded(`menu ${menu.id}`, 'enabled', menu.enabled, ctx, true), entries: entriesOf(menu.id, undefined, ctx) }));
  }

  /** The command a keydown runs, or undefined: Ctrl or Cmd, no Alt, the exact Shift state. */
  function matchShortcut(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key' | 'target'>): CommandSpec<C> | undefined {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return undefined;
    const id = keys.get(keyName({ shift: e.shiftKey, key: e.key.toLowerCase() }));
    const command = id === undefined ? undefined : commands.get(id);
    if (command?.skipInTextFields) {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, .cm-editor')) return undefined;
    }
    return command;
  }

  /** Adds the one keydown listener for every registered shortcut; `context` is read at each key press. Returns its remover. */
  function installShortcuts(context: () => C, target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
    const onKey = (e: KeyboardEvent) => {
      const command = matchShortcut(e);
      if (command === undefined) return;
      e.preventDefault();
      void command.run?.(context());
    };
    target.addEventListener('keydown', onKey as EventListener);
    return () => target.removeEventListener('keydown', onKey as EventListener);
  }

  return { defineCommand, defineMenu, resolveMenus, resolveContextMenu, matchShortcut, installShortcuts, commands: () => [...commands.values()] };
}

export const registry = createRegistry();
export const { defineCommand, defineMenu } = registry;
