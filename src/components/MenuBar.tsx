import { useRef } from 'react';
import { Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarShortcut, MenubarTrigger } from './ui/menubar';

const EMPTY_MENUS = ['Insert', 'Format'];

export interface MenuActions {
  onNew: () => void;
  onCloseTab?: () => void;
  onOpen: () => void;
  onOpenFolder: () => void;
  onConnect: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Raw/Formatted for the active tab; the View > Raw Markdown item is disabled without a tab. */
  raw?: boolean;
  onToggleRaw?: () => void;
  onPreferences?: () => void;
  onAgentSkill?: () => void;
  onAbout?: () => void;
  /** Puts focus in the editor; used instead of returning it to the File menu after New. */
  onFocusEditor?: () => void;
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
  onSave,
  onSaveAs,
  onUndo,
  onRedo,
  raw = false,
  onToggleRaw,
  onPreferences,
  onAgentSkill,
  onAbout,
  onFocusEditor,
}: MenuActions & { hasDocument: boolean; canUndo: boolean; canRedo: boolean }) {
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
          </MenubarContent>
        </MenubarMenu>
        {EMPTY_MENUS.map((label) => (
          <MenubarMenu key={label}>
            <MenubarTrigger disabled>{label}</MenubarTrigger>
          </MenubarMenu>
        ))}
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
