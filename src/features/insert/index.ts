/**
 * The Insert menu (Image…, Table of Contents), registered with the command registry as a side effect of being
 * imported (see commands/index.ts). Both need an open tab and leave the focus in the editor.
 */
import { defineCommand, defineMenu } from '../../commands/registry';

defineMenu({ id: 'insert', label: 'Insert', order: 40 });

defineCommand({ id: 'insert.image', menu: 'insert', group: 0, order: 10, label: 'Image…', focusEditor: true, enabled: (ctx) => ctx.hasDocument, run: (ctx) => ctx.insertImage() });
defineCommand({ id: 'insert.toc', menu: 'insert', group: 0, order: 20, label: 'Table of Contents', focusEditor: true, enabled: (ctx) => ctx.hasDocument, run: (ctx) => ctx.insertToc() });
