/**
 * The View menu (Raw Markdown, Refresh Navigator, Theme sub-menu), registered with the command registry as a side effect of being
 * imported (see commands/index.ts). Raw Markdown needs an open tab; the theme choice is always available.
 */
import { defineCommand, defineMenu } from '../../commands/registry';
import type { ThemeChoice } from '../../platform/settings';

defineMenu({ id: 'view', label: 'View', order: 30 });

defineCommand({
  id: 'view.raw',
  menu: 'view',
  group: 0,
  order: 10,
  label: 'Raw Markdown',
  kind: 'checkbox',
  enabled: (ctx) => ctx.hasDocument,
  checked: (ctx) => ctx.raw,
  run: (ctx) => ctx.setRaw(!ctx.raw),
});
defineCommand({
  id: 'view.refreshNavigator',
  menu: 'view',
  group: 0,
  order: 15,
  label: 'Refresh Navigator',
  enabled: (ctx) => ctx.canRefreshNavigator,
  run: (ctx) => ctx.refreshNavigator(),
});
defineCommand({ id: 'view.theme', menu: 'view', group: 0, order: 20, label: 'Theme', kind: 'submenu' });

const THEMES: [ThemeChoice, string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['auto', 'Auto'],
];
THEMES.forEach(([theme, label], i) =>
  defineCommand({
    id: `view.theme.${theme}`,
    menu: 'view',
    parent: 'view.theme',
    group: 0,
    order: 10 * (i + 1),
    label,
    kind: 'radio',
    checked: (ctx) => ctx.theme === theme,
    run: (ctx) => ctx.setTheme(theme),
  }),
);
