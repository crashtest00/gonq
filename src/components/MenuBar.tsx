/**
 * The menu bar (File, Edit, View, Insert, Format, Help) on shadcn menubar; Format mirrors EditToolbar's FORMATS
 * and has a Table sub-menu mirroring TableToolbar's TOOLS. Actions come from App.tsx via MenuActions.
 */
import { useRef } from 'react';
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
  onNew: () => void;
  onCloseTab?: () => void;
  onOpen: () => void;
  onOpenFolder: () => void;
  onConnect: () => void;
  onOpenRepo: () => void;
  onGithubSignIn: () => void;
  onGithubSignOut: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onInsertImage: () => void;
  onInsertToc: () => void;
  /** Raw/Formatted for the active tab; the View > Raw Markdown item is disabled without a tab. */
  raw?: boolean;
  onToggleRaw?: () => void;
  /** The theme choice in effect and its setter; View > Theme shows one selected item. */
  theme?: ThemeChoice;
  onTheme?: (theme: ThemeChoice) => void;
  onPreferences?: () => void;
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

export function MenuBar({
  hasDocument,
  canUndo,
  canRedo,
  onNew,
  onCloseTab,
  onOpen,
  onOpenFolder,
  onConnect,
  onOpenRepo,
  onGithubSignIn,
  onGithubSignOut,
  onSave,
  onSaveAs,
  onUndo,
  onRedo,
  onInsertImage,
  onInsertToc,
  raw = false,
  onToggleRaw,
  theme = 'auto',
  onTheme,
  onPreferences,
  onAgentSkill,
  onAbout,
  onFocusEditor,
  onFormat,
  onTableAction,
  onFocusTableCell,
  tableTarget = null,
}: MenuActions & { hasDocument: boolean; canUndo: boolean; canRedo: boolean; tableTarget?: TableTarget | null }) {
  const focusEditor = useRef(false);
  return (
    <>
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent
            onCloseAutoFocus={(e) => {
              if (!focusEditor.current) return;
              focusEditor.current = false;
              e.preventDefault();
              onFocusEditor?.();
            }}
          >
            <MenubarItem
              onSelect={() => {
                focusEditor.current = true;
                onNew();
              }}
            >
              New<MenubarShortcut>Ctrl+N</MenubarShortcut>
            </MenubarItem>
            <MenubarItem
              onSelect={() => {
                focusEditor.current = true;
                onOpen();
              }}
            >
              Open…<MenubarShortcut>Ctrl+O</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={onOpenFolder}>Open Folder…</MenubarItem>
            <MenubarItem onSelect={onConnect}>
              Connect to Server…<MenubarShortcut>Ctrl+Shift+K</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={onOpenRepo}>Open Repo…</MenubarItem>
            <MenubarItem onSelect={onGithubSignIn}>Sign in to GitHub…</MenubarItem>
            <MenubarItem onSelect={onGithubSignOut}>Sign out of GitHub</MenubarItem>
            <MenubarSeparator />
            <MenubarItem disabled={!hasDocument} onSelect={onSave}>
              Save<MenubarShortcut>Ctrl+S</MenubarShortcut>
            </MenubarItem>
            <MenubarItem disabled={!hasDocument} onSelect={onSaveAs}>
              Save As…<MenubarShortcut>Ctrl+Shift+S</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem disabled={!hasDocument || !onCloseTab} onSelect={onCloseTab}>
              Close Tab
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem disabled={!canUndo} onSelect={onUndo}>
              Undo<MenubarShortcut>Ctrl+Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem disabled={!canRedo} onSelect={onRedo}>
              Redo<MenubarShortcut>Ctrl+Y</MenubarShortcut>
            </MenubarItem>
            {onPreferences && (
              <>
                <MenubarSeparator />
                <MenubarItem onSelect={onPreferences}>
                  Preferences…<MenubarShortcut>Ctrl+,</MenubarShortcut>
                </MenubarItem>
              </>
            )}
          </MenubarContent>
        </MenubarMenu>
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
