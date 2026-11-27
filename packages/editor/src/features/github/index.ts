/**
 * The GitHub menu (Sign In, Sign Out, Open Repo…, Commit…, Open PR…), registered with the command registry as a side effect of
 * being imported (see commands/index.ts). Sign In and Sign Out are greyed by the last known sign-in state; Open Repo… and
 * Open PR… sign in on their own when needed.
 */
import { defineCommand, defineMenu } from '../../commands/registry';

defineMenu({ id: 'github', label: 'GitHub', order: 15 });

defineCommand({ id: 'github.signIn', menu: 'github', group: 0, order: 10, label: 'Sign In', enabled: (ctx) => !ctx.githubSignedIn, run: (ctx) => ctx.githubSignIn() });
defineCommand({ id: 'github.signOut', menu: 'github', group: 0, order: 20, label: 'Sign Out', enabled: (ctx) => ctx.githubSignedIn, run: (ctx) => ctx.githubSignOut() });

defineCommand({ id: 'github.openRepo', menu: 'github', group: 1, order: 10, label: 'Open Repo…', run: (ctx) => ctx.openRepo() });
// On a GitHub tab Save (Ctrl+S) is the commit flow; Commit… is the same action by name and is enabled only there, and greyed while a pull request is open for the branch (the tab is read-only).
defineCommand({ id: 'github.commit', menu: 'github', group: 1, order: 20, label: 'Commit…', enabled: (ctx) => ctx.isGithubTab && !ctx.readOnly, run: (ctx) => ctx.commit() });
// Greyed only by state: nothing to work on until a repository or a GitHub tab is open.
defineCommand({ id: 'github.openPr', menu: 'github', group: 1, order: 30, label: 'Open PR…', enabled: (ctx) => ctx.canOpenPr, run: (ctx) => ctx.openPr() });
