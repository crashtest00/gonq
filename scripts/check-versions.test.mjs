/**
 * Covers version consistency: every workspace package.json, Cargo.toml, tauri.conf.json, the workspace entries in
 * Cargo.lock and package-lock.json must carry one semver, and the Android versionCode in the mobile tauri.conf.json
 * must equal MAJOR*10000 + MINOR*100 + PATCH of it (the derivation release-mobile.yml uses). Run by `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const json = (p) => JSON.parse(read(p));
const tomlVersion = (p) => /^version\s*=\s*"([^"]+)"/m.exec(read(p).split(/^\[dependencies\]/m)[0])?.[1];

const lockVersion = (name) => {
  const block = read('Cargo.lock').split('[[package]]').find((b) => b.includes(`\nname = "${name}"\n`));
  return /\nversion = "([^"]+)"/.exec(block ?? '')?.[1];
};

const npmLock = json('package-lock.json');
const fields = {
  'package.json': json('package.json').version,
  'apps/desktop/package.json': json('apps/desktop/package.json').version,
  'apps/mobile/package.json': json('apps/mobile/package.json').version,
  'packages/editor/package.json': json('packages/editor/package.json').version,
  'crates/gonq-core/Cargo.toml': tomlVersion('crates/gonq-core/Cargo.toml'),
  'apps/desktop/src-tauri/Cargo.toml': tomlVersion('apps/desktop/src-tauri/Cargo.toml'),
  'apps/mobile/src-tauri/Cargo.toml': tomlVersion('apps/mobile/src-tauri/Cargo.toml'),
  'apps/desktop/src-tauri/tauri.conf.json': json('apps/desktop/src-tauri/tauri.conf.json').version,
  'apps/mobile/src-tauri/tauri.conf.json': json('apps/mobile/src-tauri/tauri.conf.json').version,
  'Cargo.lock gonq': lockVersion('gonq'),
  'Cargo.lock gonq-core': lockVersion('gonq-core'),
  'Cargo.lock gonq-mobile': lockVersion('gonq-mobile'),
  'package-lock.json root': npmLock.packages[''].version,
  'package-lock.json apps/desktop': npmLock.packages['apps/desktop'].version,
  'package-lock.json apps/mobile': npmLock.packages['apps/mobile'].version,
  'package-lock.json packages/editor': npmLock.packages['packages/editor'].version,
};

test('every version field is one semver', () => {
  const expected = fields['package.json'];
  assert.match(expected, /^\d+\.\d+\.\d+$/);
  for (const [where, v] of Object.entries(fields)) assert.equal(v, expected, `${where} is ${v}, expected ${expected}`);
});

test('Android versionCode equals MAJOR*10000 + MINOR*100 + PATCH', () => {
  const [major, minor, patch] = fields['package.json'].split('.').map(Number);
  assert.ok(minor < 100 && patch < 100, 'MINOR and PATCH must stay below 100');
  const code = json('apps/mobile/src-tauri/tauri.conf.json').bundle?.android?.versionCode;
  assert.equal(code, major * 10000 + minor * 100 + patch);
});
