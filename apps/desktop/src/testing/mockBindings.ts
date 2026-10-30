/**
 * Test double for the generated platform/bindings module: `bindingsMock(invoke)` is the factory result for
 * `vi.mock('.../platform/bindings', ...)`. Every `commands.fooBar(a, b)` call is forwarded to `invoke('foo_bar', { a, b })`,
 * so a test keeps one handler table keyed by the Rust command name and asserts on named arguments. The command
 * names and parameter names are read from the real bindings, so a rename or reordered parameter shows up here.
 */
import { vi } from 'vitest';

type Invoke = (cmd: string, args?: Record<string, unknown>) => unknown;

export async function bindingsMock(invoke: Invoke) {
  const actual = await vi.importActual<typeof import('../platform/bindings')>('../platform/bindings');
  const commands: Record<string, (...args: unknown[]) => unknown> = {};
  for (const [name, real] of Object.entries(actual.commands) as [string, (...a: never[]) => unknown][]) {
    const m = /\("plugin:gonq\|(\w+)"(?:,\s*\{([^}]*)\})?\)/.exec(real.toString());
    if (!m) throw new Error(`mockBindings: cannot read the command name of ${name}`);
    const [, command, names] = m;
    const params = names ? names.split(',').map((p) => p.trim()).filter(Boolean) : [];
    commands[name] = (...args) => {
      if (params.length === 0) return invoke(command);
      const named: Record<string, unknown> = {};
      params.forEach((p, i) => (named[p] = args[i]));
      return invoke(command, named);
    };
  }
  return { ...actual, commands };
}
