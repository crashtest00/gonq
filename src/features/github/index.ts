/**
 * The GitHub commands in the File menu (Open Repo, Sign in to GitHub, Sign out of GitHub), registered with the
 * command registry as a side effect of being imported (see commands/index.ts).
 */
import { defineCommand } from '../../commands/registry';

defineCommand({ id: 'github.openRepo', menu: 'file', group: 0, order: 50, label: 'Open Repo…', run: (ctx) => ctx.openRepo() });
defineCommand({ id: 'github.signIn', menu: 'file', group: 0, order: 60, label: 'Sign in to GitHub…', run: (ctx) => ctx.githubSignIn() });
defineCommand({ id: 'github.signOut', menu: 'file', group: 0, order: 70, label: 'Sign out of GitHub', run: (ctx) => ctx.githubSignOut() });
