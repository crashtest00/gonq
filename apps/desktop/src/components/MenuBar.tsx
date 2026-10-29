/**
 * The menu bar on shadcn menubar, generated entirely from the command registry: every menu, item, sub-menu,
 * checkbox and radio group a feature module registered (src/features/<x>/index.ts) is rendered from the
 * CommandContext App.tsx passes. Adding a menu item never edits this file.
 */
import { useRef } from 'react';
import { registry, type CommandContext } from '../commands';
import type { CommandSpec, MenuEntry } from '../commands/registry';
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from './ui/menubar';

/** A command's label with its icon; labelClass styles the text only. */
function Label({ command: { icon: Icon, label, labelClass } }: { command: CommandSpec }) {
  return (
    <>
      {Icon && <Icon size={14} aria-hidden className="mr-2" />}
      {labelClass ? <span className={labelClass}>{label}</span> : label}
    </>
  );
}

/** The entries of a registry menu; a run of radio items shares one radio group. */
function RegistryEntries({ menuId, entries, ctx, onPick }: { menuId: string; entries: MenuEntry[]; ctx: CommandContext; onPick: (focusEditor: boolean) => void }) {
  const out: JSX.Element[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.type === 'separator') {
      out.push(<MenubarSeparator key={`sep${i}`} />);
    } else if (entry.type === 'submenu') {
      out.push(
        <MenubarSub key={entry.command.id}>
          <MenubarSubTrigger disabled={!entry.enabled}>
            <Label command={entry.command} />
          </MenubarSubTrigger>
          <MenubarSubContent data-menu={menuId}>
            <RegistryEntries menuId={menuId} entries={entry.items} ctx={ctx} onPick={onPick} />
          </MenubarSubContent>
        </MenubarSub>,
      );
    } else if (entry.command.kind === 'radio') {
      const run: Extract<MenuEntry, { type: 'item' }>[] = [];
      for (; i < entries.length; i++) {
        const next = entries[i];
        if (next.type !== 'item' || next.command.kind !== 'radio') break;
        run.push(next);
      }
      i--;
      out.push(
        <MenubarRadioGroup
          key={run[0].command.id}
          value={run.find((r) => r.checked)?.command.id ?? ''}
          onValueChange={(id) => {
            const picked = run.find((r) => r.command.id === id);
            if (picked !== undefined) void picked.command.run?.(ctx);
          }}
        >
          {run.map((r) => (
            <MenubarRadioItem key={r.command.id} value={r.command.id} disabled={!r.enabled}>
              <Label command={r.command} />
            </MenubarRadioItem>
          ))}
        </MenubarRadioGroup>,
      );
    } else {
      const { command, enabled, checked, shortcut } = entry;
      const label = (
        <>
          <Label command={command} />
          {shortcut !== undefined && <MenubarShortcut>{shortcut}</MenubarShortcut>}
        </>
      );
      if (command.kind === 'checkbox') {
        out.push(
          <MenubarCheckboxItem key={command.id} checked={checked} disabled={!enabled} onCheckedChange={() => void command.run?.(ctx)}>
            {label}
          </MenubarCheckboxItem>,
        );
      } else {
        out.push(
          <MenubarItem
            key={command.id}
            disabled={!enabled}
            onSelect={() => {
              onPick(command.focusEditor === true);
              void command.run?.(ctx);
            }}
          >
            {label}
          </MenubarItem>,
        );
      }
    }
  }
  return <>{out}</>;
}

export function MenuBar({ ctx }: { ctx: CommandContext }) {
  const focusEditor = useRef(false);
  return (
    <>
      <Menubar>
        {registry.resolveMenus(ctx).map(({ menu, enabled, entries }) => (
          <MenubarMenu key={menu.id}>
            <MenubarTrigger disabled={!enabled} data-menu={menu.id}>
              {menu.label}
            </MenubarTrigger>
            <MenubarContent
              data-menu={menu.id}
              onCloseAutoFocus={(e) => {
                if (menu.closeFocus !== undefined) {
                  e.preventDefault();
                  menu.closeFocus(ctx);
                } else if (focusEditor.current) {
                  focusEditor.current = false;
                  e.preventDefault();
                  ctx.editor.current?.focus();
                }
              }}
            >
              <RegistryEntries menuId={menu.id} entries={entries} ctx={ctx} onPick={(focus) => (focusEditor.current = focus)} />
            </MenubarContent>
          </MenubarMenu>
        ))}
      </Menubar>
      <div className="h-px shrink-0 bg-border" />
    </>
  );
}
