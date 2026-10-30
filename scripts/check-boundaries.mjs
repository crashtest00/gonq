#!/usr/bin/env node
// Fails when a relative import (or import.meta.glob pattern) crosses an npm-workspace boundary, in either
// direction: packages/editor must not reach into apps/desktop, and apps/desktop must use `@gonq/editor/...`
// rather than ../../packages/editor/... A workspace is each apps/* and packages/* directory.
//
//   node scripts/check-boundaries.mjs     exits 1 listing every offending file:line
//
// Also rejects bare imports of another workspace's source (`@gonq/editor/src/...`) and of the desktop app from
// the package (`@gonq/desktop`). Node 18+, no dependencies.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_FILE = /\.(tsx?|css|mjs|js)$/;
const SKIP = new Set(['node_modules', 'dist', 'target', 'src-tauri', 'icons']);

function workspaces() {
  const out = [];
  for (const group of ['apps', 'packages'])
    if (existsSync(join(ROOT, group)))
      for (const e of readdirSync(join(ROOT, group), { withFileTypes: true })) if (e.isDirectory()) out.push(join(ROOT, group, e.name));
  return out;
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (SOURCE_FILE.test(e.name)) out.push(p);
  }
  return out;
}

const SPECIFIER = /(['"`])(\.{1,2}\/[^'"`\n]*|\.{1,2})\1/g;
const problems = [];
const spaces = workspaces();
for (const space of spaces) {
  for (const file of walk(space)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const where = `${relative(ROOT, file)}:${i + 1}`;
      for (const m of line.matchAll(SPECIFIER)) {
        const target = resolve(dirname(file), m[2].split('?')[0]);
        if (target !== space && !target.startsWith(space + sep))
          problems.push(`${where}: relative import ${m[0]} leaves the workspace ${relative(ROOT, space)}; use the package name (@gonq/...)`);
      }
      if (/@gonq\/editor\/src\//.test(line)) problems.push(`${where}: import @gonq/editor/<subpath> from the exports map, not @gonq/editor/src/...`);
      if (file.startsWith(join(ROOT, 'packages') + sep) && /@gonq\/desktop/.test(line)) problems.push(`${where}: a package must not import the desktop app`);
    });
  }
}

if (problems.length) {
  console.error(`Workspace boundary violations:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`boundaries ok (${spaces.length} workspaces)`);
