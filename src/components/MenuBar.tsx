import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarShortcut, MenubarTrigger } from './ui/menubar';

const EMPTY_MENUS = ['View', 'Insert', 'Format', 'Help'];

export interface MenuActions {
  onNew: () => void;
  onOpen: () => void;
  onOpenFolder?: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function MenuBar({
  hasDocument,
  canUndo,
  canRedo,
  onNew,
  onOpen,
  onOpenFolder,
  onSave,
  onSaveAs,
  onUndo,
  onRedo,
}: MenuActions & { hasDocument: boolean; canUndo: boolean; canRedo: boolean }) {
  return (
    <>
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={onNew}>
              New<MenubarShortcut>Ctrl+N</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={onOpen}>
              Open…<MenubarShortcut>Ctrl+O</MenubarShortcut>
            </MenubarItem>
            {onOpenFolder && <MenubarItem onSelect={onOpenFolder}>Open Folder…</MenubarItem>}
            <MenubarSeparator />
            <MenubarItem disabled={!hasDocument} onSelect={onSave}>
              Save<MenubarShortcut>Ctrl+S</MenubarShortcut>
            </MenubarItem>
            <MenubarItem disabled={!hasDocument} onSelect={onSaveAs}>
              Save As…<MenubarShortcut>Ctrl+Shift+S</MenubarShortcut>
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
          </MenubarContent>
        </MenubarMenu>
        {EMPTY_MENUS.map((label) => (
          <MenubarMenu key={label}>
            <MenubarTrigger disabled>{label}</MenubarTrigger>
          </MenubarMenu>
        ))}
      </Menubar>
      <div className="h-px shrink-0 bg-border" />
    </>
  );
}
