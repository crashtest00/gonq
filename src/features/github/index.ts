/**
 * The GitHub commands in the File menu (Open Repo, Open PR; sign-in and sign-out live in the Settings dialog), registered with the
 * command registry as a side effect of being imported (see commands/index.ts).
 */
import { defineCommand } from '../../commands/registry';

defineCommand({ id: 'github.openRepo', menu: 'file', group: 0, order: 50, label: 'Open Repo…', run: (ctx) => ctx.openRepo() });
// Greyed only by state: nothing to work on until a repository or a GitHub tab is open.
defineCommand({ id: 'github.openPr', menu: 'file', group: 0, order: 55, label: 'Open PR…', enabled: (ctx) => ctx.canOpenPr, run: (ctx) => ctx.openPr() });
