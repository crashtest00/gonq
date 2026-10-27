/**
 * The GitHub commands in the File menu (Open Repo, Open PR, Sign in to GitHub, Sign out of GitHub), registered with the
 * command registry as a side effect of being imported (see commands/index.ts).
 */
import { defineCommand } from '../../commands/registry';

defineCommand({ id: 'github.openRepo', menu: 'file', group: 0, order: 50, label: 'Open Repo…', run: (ctx) => ctx.openRepo() });
// Greyed only by state: nothing to work on until a repository or a GitHub tab is open.
defineCommand({ id: 'github.openPr', menu: 'file', group: 0, order: 55, label: 'Open PR…', enabled: (ctx) => ctx.canOpenPr, run: (ctx) => ctx.openPr() });
defineCommand({ id: 'github.signIn', menu: 'file', group: 0, order: 60, label: 'Sign in to GitHub…', run: (ctx) => ctx.githubSignIn() });
defineCommand({ id: 'github.signOut', menu: 'file', group: 0, order: 70, label: 'Sign out of GitHub', run: (ctx) => ctx.githubSignOut() });
