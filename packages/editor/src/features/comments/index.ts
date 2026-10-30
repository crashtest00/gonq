/**
 * The comments feature's commands, registered with the command registry as a side effect of being imported
 * (see commands/index.ts): Add Comment (Alt+M, and in the editor's right-click menu).
 */
import { defineCommand } from '../../commands/registry';

defineCommand({
  id: 'comments.add',
  group: 0,
  order: 10,
  label: 'Add Comment',
  shortcut: 'Alt+M',
  contextMenu: { group: 0, order: 10 },
  enabled: (ctx) => ctx.canAddComment,
  run: (ctx) => ctx.addComment(),
});
