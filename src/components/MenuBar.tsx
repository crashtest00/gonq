import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarShortcut, MenubarTrigger } from './ui/menubar';

const EMPTY_MENUS = ['Edit', 'View', 'Insert', 'Format', 'Help'];

export function MenuBar({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={onOpen}>
              Open…<MenubarShortcut>Ctrl+O</MenubarShortcut>
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
