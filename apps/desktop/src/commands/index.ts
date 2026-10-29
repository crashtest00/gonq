/**
 * The one place feature modules are loaded: every src/features/<feature>/index.ts is imported (for its
 * defineCommand/defineMenu side effects) before the registry is handed to the menu bar and App.tsx.
 */
import.meta.glob('../features/*/index.ts', { eager: true });

export { registry } from './registry';
export type { CommandContext } from './context';
