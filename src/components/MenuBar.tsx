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
  onPreferences?: () => void;
  onAgentSkill?: () => void;
  onAbout?: () => void;
  /** The View > Show markers in active block option; the item is absent without a toggle. */
  showMarkers?: boolean;
  onShowMarkers?: (show: boolean) => void;
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
  onPreferences,
  onAgentSkill,
  onAbout,
  showMarkers = true,
  onShowMarkers,
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
          <MenubarTrigger disabled={!onShowMarkers}>View</MenubarTrigger>
          {onShowMarkers && (
            <MenubarContent>
              <MenubarCheckboxItem checked={showMarkers} onCheckedChange={onShowMarkers}>
                Show markers in active block
              </MenubarCheckboxItem>
            </MenubarContent>
          )}
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
