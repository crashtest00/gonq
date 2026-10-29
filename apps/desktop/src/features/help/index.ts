/**
 * The Help menu (Agent skill…, About Gonq), registered with the command registry as a side effect of being
 * imported (see commands/index.ts). The About dialog hands the focus back to the Help trigger (data-menu="help").
 */
import { defineCommand, defineMenu } from '../../commands/registry';

defineMenu({ id: 'help', label: 'Help', order: 60 });

defineCommand({ id: 'help.agentSkill', menu: 'help', group: 0, order: 10, label: 'Agent skill…', run: (ctx) => ctx.openAgentSkill() });
defineCommand({ id: 'help.about', menu: 'help', group: 0, order: 20, label: 'About Gonq', run: (ctx) => ctx.openAbout() });
