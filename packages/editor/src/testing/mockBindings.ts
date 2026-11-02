/**
 * Test double for the generated platform/bindings module: `bindingsMock(invoke)` is the factory result for
 * `vi.mock('.../platform/bindings', ...)`. Every `commands.fooBar(a, b)` call is forwarded to `invoke('foo_bar', { a, b })`,
 * so a test keeps one handler table keyed by the Rust command name and asserts on named arguments. The command
 * names and parameter names are read from the real bindings, so a rename or reordered parameter shows up here.
 *
 * `fakeSafPlugin()` is the in-memory stand-in for the Android `gonq-saf` plugin (platform/local.ts): hand its `invoke` to a
 * mock of `@tauri-apps/api/core`. It follows the Kotlin plugin's contract: names resolved under a granted tree, base64 reads,
 * whole-second `modified`, `conflict` / `exists` / `outside` / `not-found` / `permission` rejections, and an empty listing
 * (not an error) for a tree whose folder vanished.
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

type Json = Record<string, unknown>;
interface FakeNode {
  bytes: Uint8Array | null; // null = folder
  modified: number | null;
}

/** An in-memory Storage Access Framework. Every call is recorded in `calls` as [command, args]. */
export function fakeSafPlugin() {
  const trees = new Map<string, Map<string, FakeNode>>(); // tree -> rel -> node ('' is the root)
  const granted = new Set<string>();
  const singleDocs = new Set<string>(); // grants on one document (local_create_document)
  const calls: [string, Json][] = [];
  let clock = 1_700_000_000_000;
  const enc = new TextEncoder();
  const reject = (kind: string, message: string) => Promise.reject({ kind, message });
  const parts = (rel: string) => rel.split('/').filter((s) => s !== '');
  const parentOf = (rel: string) => parts(rel).slice(0, -1).join('/');

  const api = {
    calls,
    granted,
    /** Whole-second timestamps, like ExternalStorage (E16). */
    tick(ms = 1000) {
      clock += ms;
    },
    /** A picked and granted tree; `files` maps rel -> text (a trailing "/" makes a folder). */
    addTree(tree: string, files: Record<string, string | Uint8Array> = {}) {
      const m = new Map<string, FakeNode>([['', { bytes: null, modified: null }]]);
      trees.set(tree, m);
      granted.add(tree);
      for (const [rel, body] of Object.entries(files)) api.put(tree, rel, rel.endsWith('/') ? null : body);
      return m;
    },
    put(tree: string, rel: string, body: string | Uint8Array | null, modified: number | null = Math.floor(clock / 1000) * 1000) {
      const m = trees.get(tree)!;
      const ps = parts(rel);
      for (let i = 1; i < ps.length; i++) if (!m.has(ps.slice(0, i).join('/'))) m.set(ps.slice(0, i).join('/'), { bytes: null, modified: null });
      m.set(ps.join('/'), { bytes: body === null ? null : typeof body === 'string' ? enc.encode(body) : body, modified });
    },
    text(tree: string, rel: string): string | null {
      const n = trees.get(tree)?.get(parts(rel).join('/'));
      return n?.bytes ? new TextDecoder().decode(n.bytes) : null;
    },
    /** The folder is moved away: the grant stays and listings come back empty (E15). */
    vanish(tree: string) {
      trees.set(tree, new Map());
    },
    revoke(tree: string) {
      granted.delete(tree);
    },
    async invoke(command: string, args: Json = {}): Promise<unknown> {
      const name = command.replace(/^plugin:gonq-saf\|/, '');
      calls.push([name, args]);
      if (name === 'local_pick_folder') {
        const next = api.nextPick;
        api.nextPick = null;
        if (next === null) return { picked: false };
        // Picking a folder the test already filled (addTree) keeps its files and grants it again.
        if (trees.has(next.tree)) granted.add(next.tree);
        else api.addTree(next.tree);
        return { picked: true, tree: next.tree, name: next.name };
      }
      if (name === 'local_create_document') {
        const next = api.nextDocument;
        api.nextDocument = null;
        if (next === null) return { picked: false };
        // A single-document grant: the "tree" is the document URI, its root is the file itself (rel '' or its name).
        const m = new Map<string, FakeNode>([['', { bytes: new Uint8Array(), modified: Math.floor(clock / 1000) * 1000 }]]);
        trees.set(next.uri, m);
        granted.add(next.uri);
        singleDocs.add(next.uri);
        return { picked: true, tree: next.uri, name: next.name };
      }
      if (name === 'local_granted') return { trees: [...granted] };
      const tree = String(args.tree);
      let rel = parts(String(args.rel ?? '')).join('/');
      if (singleDocs.has(tree) && parts(rel).length === 1) rel = '';
      if (parts(String(args.rel ?? '')).some((p) => p === '..' || p === '.')) return reject('outside', 'That is outside the opened folder.');
      if (!granted.has(tree) || !trees.has(tree)) return reject('permission', 'Access to this folder was removed. Open it again to continue.');
      const m = trees.get(tree)!;
      const rootGone = !m.has('');
      const node = m.get(rel);
      const stat = (n: FakeNode) => ({ size: n.bytes?.length ?? 0, modified: n.modified, isDir: n.bytes === null });
      switch (name) {
        case 'local_list': {
          if (!node && !rootGone) return reject('not-found', `${rel} was not found.`);
          const kids = [...m.entries()].filter(([r]) => r !== '' && parentOf(r) === rel && (rel === '' || node));
          if (kids.length === 0 && rootGone) return reject('not-found', 'The opened folder is no longer available.');
          return { entries: kids.map(([r, n]) => ({ name: r.split('/').pop(), isDir: n.bytes === null })) };
        }
        case 'local_stat':
          return node ? stat(node) : reject('not-found', rootGone ? 'The opened folder is no longer available.' : `${rel} was not found.`);
        case 'local_exists':
          if (rootGone) return reject('not-found', 'The opened folder is no longer available.');
          return { exists: node !== undefined };
        case 'local_read': {
          if (!node || node.bytes === null) return reject('not-found', `${rel} was not found.`);
          return { ...stat(node), bytes: btoa(String.fromCharCode(...node.bytes)) };
        }
        case 'local_write': {
          if (!node || node.bytes === null) return reject('not-found', `${rel} was not found.`);
          const exp = args.expected as { size: number; modified: number | null } | undefined;
          if (exp && (exp.size !== node.bytes.length || (exp.modified !== null && node.modified !== null && exp.modified !== node.modified))) {
            return reject('conflict', `${rel} changed since you opened it.`);
          }
          api.put(tree, rel, String(args.text));
          return stat(m.get(rel)!);
        }
        case 'local_create': {
          if (node) return reject('exists', `${rel} already exists.`);
          if (!m.get(parentOf(rel))) return reject('not-found', `${parentOf(rel)} was not found.`);
          api.put(tree, rel, String(args.text));
          return stat(m.get(rel)!);
        }
        case 'local_create_bytes': {
          if (node) return reject('exists', `${rel} already exists.`);
          if (!m.get(parentOf(rel))) return reject('not-found', `${parentOf(rel)} was not found.`);
          const bin = atob(String(args.bytes));
          api.put(tree, rel, Uint8Array.from(bin, (c) => c.charCodeAt(0)));
          return stat(m.get(rel)!);
        }
      }
      return reject('io', `unknown command ${name}`);
    },
    /** What the next local_create_document resolves; null (the default) is a cancel. */
    nextDocument: null as { uri: string; name: string } | null,
    /** What the next local_pick_folder resolves; null (the default) is a cancel. */
    nextPick: null as { tree: string; name: string } | null,
  };
  return api;
}
