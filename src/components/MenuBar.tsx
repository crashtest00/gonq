/**
 * The menu bar on shadcn menubar. File and Edit (and any menu a feature registers) are rendered from the command
 * registry with the CommandContext App.tsx passes; View, Insert, Format and Help are still props-based (MenuActions).
 * Format mirrors EditToolbar's FORMATS and has a Table sub-menu mirroring TableToolbar's TOOLS.
 */
import { useRef } from 'react';
import { registry, type CommandContext } from '../commands';
import type { MenuEntry } from '../commands/registry';
import { Table } from 'lucide-react';
import type { TableOp, TableTarget } from '../editor/tables';
import type { ThemeChoice } from '../platform/settings';
import { askUrl } from '../editor/formatCommands';
import { FORMATS } from './EditToolbar';
import type { Format } from './formatting';
import { TOOLS } from './TableToolbar';
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

/** The Format menu mirrors the toolbar: the table button becomes the Table sub-menu's first item. */
const TEXT_FORMATS = FORMATS.filter((f) => f.format !== 'table');
const TABLE_FORMAT = FORMATS.find((f) => f.format === 'table')!;

export interface MenuActions {
  onInsertImage: () => void;
  onInsertToc: () => void;
  /** Raw/Formatted for the active tab; the View > Raw Markdown item is disabled without a tab. */
  raw?: boolean;
  onToggleRaw?: () => void;
  /** The theme choice in effect and its setter; View > Theme shows one selected item. */
  theme?: ThemeChoice;
  onTheme?: (theme: ThemeChoice) => void;
  onAgentSkill?: () => void;
  onAbout?: () => void;
  /** Puts focus in the editor; used instead of returning it to the File menu after New. */
  onFocusEditor?: () => void;
  /** Applies a format to the editor's selection, like the formatting toolbar. */
  onFormat?: (format: Format, url?: string) => void;
  /** Runs a table action on the table cell the caret is in, like the table toolbar. */
  onTableAction?: (op: TableOp) => void;
  /** Puts the focus back in the table cell the table actions act on. */
  onFocusTableCell?: () => void;
}

/** The entries of a registry menu; a run of radio items shares one radio group. */
function RegistryEntries({ entries, ctx, onPick }: { entries: MenuEntry[]; ctx: CommandContext; onPick: (focusEditor: boolean) => void }) {
  const out: JSX.Element[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.type === 'separator') {
      out.push(<MenubarSeparator key={`sep${i}`} />);
    } else if (entry.type === 'submenu') {
      out.push(
        <MenubarSub key={entry.command.id}>
          <MenubarSubTrigger disabled={!entry.enabled}>{entry.command.label}</MenubarSubTrigger>
          <MenubarSubContent>
            <RegistryEntries entries={entry.items} ctx={ctx} onPick={onPick} />
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
              {r.command.label}
            </MenubarRadioItem>
          ))}
        </MenubarRadioGroup>,
      );
    } else {
      const { command, enabled, checked, shortcut } = entry;
      const label = (
        <>
          {command.label}
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

export function MenuBar({
  ctx,
  hasDocument,
  onInsertImage,
  onInsertToc,
  raw = false,
  onToggleRaw,
  theme = 'auto',
  onTheme,
  onAgentSkill,
  onAbout,
  onFocusEditor,
  onFormat,
  onTableAction,
  onFocusTableCell,
  tableTarget = null,
}: MenuActions & { ctx: CommandContext; hasDocument: boolean; tableTarget?: TableTarget | null }) {
  const focusEditor = useRef(false);
  return (
    <>
      <Menubar>
        {registry.resolveMenus(ctx).map(({ menu, enabled, entries }) => (
          <MenubarMenu key={menu.id}>
            <MenubarTrigger disabled={!enabled}>{menu.label}</MenubarTrigger>
            <MenubarContent
              onCloseAutoFocus={(e) => {
                if (!focusEditor.current) return;
                focusEditor.current = false;
                e.preventDefault();
                onFocusEditor?.();
              }}
            >
              <RegistryEntries entries={entries} ctx={ctx} onPick={(focus) => (focusEditor.current = focus)} />
            </MenubarContent>
          </MenubarMenu>
        ))}
        <MenubarMenu>
          <MenubarTrigger>View</MenubarTrigger>
          <MenubarContent>
            <MenubarCheckboxItem
              checked={raw}
              disabled={!hasDocument || !onToggleRaw}
              onCheckedChange={() => onToggleRaw?.()}
            >
              Raw Markdown
            </MenubarCheckboxItem>
            <MenubarSub>
              <MenubarSubTrigger>Theme</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarRadioGroup value={theme} onValueChange={(v) => onTheme?.(v as ThemeChoice)}>
                  <MenubarRadioItem value="light">Light</MenubarRadioItem>
                  <MenubarRadioItem value="dark">Dark</MenubarRadioItem>
                  <MenubarRadioItem value="auto">Auto</MenubarRadioItem>
                </MenubarRadioGroup>
              </MenubarSubContent>
            </MenubarSub>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Insert</MenubarTrigger>
          <MenubarContent
            onCloseAutoFocus={(e) => {
              if (!focusEditor.current) return;
              focusEditor.current = false;
              e.preventDefault();
              onFocusEditor?.();
            }}
          >
            <MenubarItem
              disabled={!hasDocument}
              onSelect={() => {
                focusEditor.current = true;
                onInsertImage();
              }}
            >
              Image…
            </MenubarItem>
            <MenubarItem
              disabled={!hasDocument}
              onSelect={() => {
                focusEditor.current = true;
                onInsertToc();
              }}
            >
              Table of Contents
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger data-format-menu disabled={!hasDocument || !onFormat}>Format</MenubarTrigger>
          <MenubarContent
            data-format-menu
            // The editor (or the table cell the action used) keeps the focus, not the menu button.
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              if (tableTarget !== null) onFocusTableCell?.();
              else onFocusEditor?.();
            }}
          >
            {TEXT_FORMATS.map(({ format, label, shortcut, icon: Icon, effect }) => (
              <MenubarItem
                key={format}
                onSelect={() => {
                  if (format !== 'link') return onFormat?.(format);
                  const url = askUrl();
                  if (url !== null) onFormat?.(format, url);
                }}
              >
                <Icon size={14} aria-hidden className="mr-2" />
                <span className={effect}>{label}</span>
                {shortcut && <MenubarShortcut>{shortcut}</MenubarShortcut>}
              </MenubarItem>
            ))}
            <MenubarSeparator />
            <MenubarSub>
              <MenubarSubTrigger>
                <Table size={14} aria-hidden className="mr-2" />
                Table
              </MenubarSubTrigger>
              <MenubarSubContent data-format-menu>
                <MenubarItem onSelect={() => onFormat?.('table')}>
                  <TABLE_FORMAT.icon size={14} aria-hidden className="mr-2" />
                  {TABLE_FORMAT.label}
                </MenubarItem>
                {TOOLS.map(({ op, label, divider }) => (
                  <span key={op} className="contents">
                    {(divider || op === 'rowAbove') && <MenubarSeparator />}
                    <MenubarItem
                      disabled={tableTarget === null || tableTarget.disabled.includes(op) || !onTableAction}
                      onSelect={() => onTableAction?.(op)}
                    >
                      {label}
                    </MenubarItem>
                  </span>
                ))}
              </MenubarSubContent>
            </MenubarSub>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger data-help-menu disabled={!onAgentSkill && !onAbout}>Help</MenubarTrigger>
          {(onAgentSkill || onAbout) && (
            <MenubarContent>
              {onAgentSkill && <MenubarItem onSelect={onAgentSkill}>Agent skill…</MenubarItem>}
              {onAbout && <MenubarItem onSelect={onAbout}>About Gonq</MenubarItem>}
            </MenubarContent>
          )}
        </MenubarMenu>
      </Menubar>
      <div className="h-px shrink-0 bg-border" />
    </>
  );
}
