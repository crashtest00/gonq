/**
 * The Format menu: the formatting toolbar's actions (EditToolbar's FORMATS) and a Table sub-menu with insert table
 * and the table toolbar's actions (TableToolbar's TOOLS), registered with the command registry as a side effect of
 * being imported (see commands/index.ts). The key of an inline format belongs to the editor, so it is only a hint.
 * Closing the menu returns the focus to the table cell the actions act on, or to the editor.
 */
import { askUrl } from '../../editor/formatCommands';
import { defineCommand, defineMenu } from '../../commands/registry';
import { FORMATS } from '../../components/EditToolbar';
import { TOOLS } from '../../components/TableToolbar';

defineMenu({
  id: 'format',
  label: 'Format',
  order: 50,
  enabled: (ctx) => ctx.hasDocument,
  closeFocus: (ctx) => (ctx.tableTarget !== null ? ctx.editor.current?.focusTableCell() : ctx.editor.current?.focus()),
});

FORMATS.filter((f) => f.format !== 'table').forEach(({ format, label, shortcut, icon, effect }, i) =>
  defineCommand({
    id: `format.${format}`,
    menu: 'format',
    group: 0,
    order: 10 * (i + 1),
    label,
    icon,
    labelClass: effect,
    hint: shortcut,
    ...(format === 'bold' || format === 'italic' ? { contextMenu: { group: 30, order: format === 'bold' ? 10 : 20 } } : {}),
    run: (ctx) => {
      if (format !== 'link') return ctx.editor.current?.format(format);
      const url = askUrl();
      if (url !== null) ctx.editor.current?.format(format, url);
    },
  }),
);

const TABLE = FORMATS.find((f) => f.format === 'table')!;
defineCommand({ id: 'format.table', menu: 'format', group: 1, order: 10, label: 'Table', icon: TABLE.icon, kind: 'submenu' });
defineCommand({
  id: 'format.table.insert',
  menu: 'format',
  parent: 'format.table',
  group: 0,
  order: 10,
  label: TABLE.label,
  icon: TABLE.icon,
  run: (ctx) => ctx.editor.current?.format('table'),
});

// Separators sit where the table toolbar has its dividers, and before the row actions.
let group = 0;
TOOLS.forEach(({ op, label, divider }, i) => {
  if (divider || op === 'rowAbove') group++;
  defineCommand({
    id: `format.table.${op}`,
    menu: 'format',
    parent: 'format.table',
    group,
    order: 10 * (i + 1),
    label,
    enabled: (ctx) => ctx.tableTarget !== null && !ctx.tableTarget.disabled.includes(op),
    run: (ctx) => ctx.editor.current?.tableAction(op),
  });
});
