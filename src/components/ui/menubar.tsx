import * as React from 'react';
import * as MenubarPrimitive from '@radix-ui/react-menubar';
import { cn } from '../../lib/utils';

const MenubarMenu = MenubarPrimitive.Menu;

const Menubar = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Root
    ref={ref}
    className={cn('flex h-[34px] shrink-0 items-stretch gap-0.5 px-2', className)}
    {...props}
  />
));
Menubar.displayName = MenubarPrimitive.Root.displayName;

const MenubarTrigger = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Trigger
    ref={ref}
    className={cn(
      'cursor-default select-none px-[10px] text-[13px] text-foreground outline-none',
      'hover:bg-surface focus-visible:bg-surface data-[state=open]:bg-surface',
      'data-[disabled]:pointer-events-none data-[disabled]:text-muted-foreground',
      className,
    )}
    {...props}
  />
));
MenubarTrigger.displayName = MenubarPrimitive.Trigger.displayName;

const MenubarContent = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Content>
>(({ className, align = 'start', sideOffset = 0, ...props }, ref) => (
  <MenubarPrimitive.Portal>
    <MenubarPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-[180px] rounded-control border border-border bg-surface p-1 text-[13px] text-foreground shadow-[var(--shadow-md)]',
        className,
      )}
      {...props}
    />
  </MenubarPrimitive.Portal>
));
MenubarContent.displayName = MenubarPrimitive.Content.displayName;

const MenubarItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Item>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center rounded-[4px] px-2 py-1.5 outline-none',
      'focus:bg-background data-[disabled]:pointer-events-none data-[disabled]:text-muted-foreground',
      className,
    )}
    {...props}
  />
));
MenubarItem.displayName = MenubarPrimitive.Item.displayName;

const MenubarCheckboxItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <MenubarPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center rounded-[4px] py-1.5 pl-7 pr-2 outline-none',
      'focus:bg-background data-[disabled]:pointer-events-none data-[disabled]:text-muted-foreground',
      className,
    )}
    {...props}
  >
    <MenubarPrimitive.ItemIndicator className="absolute left-2 inline-flex items-center">✓</MenubarPrimitive.ItemIndicator>
    {children}
  </MenubarPrimitive.CheckboxItem>
));
MenubarCheckboxItem.displayName = MenubarPrimitive.CheckboxItem.displayName;

const MenubarRadioGroup = MenubarPrimitive.RadioGroup;

const MenubarRadioItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <MenubarPrimitive.RadioItem
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center rounded-[4px] py-1.5 pl-7 pr-2 outline-none',
      'focus:bg-background data-[disabled]:pointer-events-none data-[disabled]:text-muted-foreground',
      className,
    )}
    {...props}
  >
    <MenubarPrimitive.ItemIndicator className="absolute left-2 inline-flex items-center">●</MenubarPrimitive.ItemIndicator>
    {children}
  </MenubarPrimitive.RadioItem>
));
MenubarRadioItem.displayName = MenubarPrimitive.RadioItem.displayName;

const MenubarSub = MenubarPrimitive.Sub;

const MenubarSubTrigger = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <MenubarPrimitive.SubTrigger
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center rounded-[4px] px-2 py-1.5 outline-none',
      'focus:bg-background data-[state=open]:bg-background data-[disabled]:pointer-events-none data-[disabled]:text-muted-foreground',
      className,
    )}
    {...props}
  >
    {children}
    <span aria-hidden className="ml-auto pl-6 text-muted-foreground">›</span>
  </MenubarPrimitive.SubTrigger>
));
MenubarSubTrigger.displayName = MenubarPrimitive.SubTrigger.displayName;

const MenubarSubContent = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Portal>
    <MenubarPrimitive.SubContent
      ref={ref}
      className={cn(
        'z-50 min-w-[180px] rounded-control border border-border bg-surface p-1 text-[13px] text-foreground shadow-[var(--shadow-md)]',
        className,
      )}
      {...props}
    />
  </MenubarPrimitive.Portal>
));
MenubarSubContent.displayName = MenubarPrimitive.SubContent.displayName;

const MenubarSeparator = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
));
MenubarSeparator.displayName = MenubarPrimitive.Separator.displayName;

const MenubarShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn('ml-auto pl-6 text-[12px] text-muted-foreground', className)} {...props} />
);
MenubarShortcut.displayName = 'MenubarShortcut';

export { Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarCheckboxItem, MenubarRadioGroup, MenubarRadioItem, MenubarSeparator, MenubarShortcut, MenubarSub, MenubarSubTrigger, MenubarSubContent };
