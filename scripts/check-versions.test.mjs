/**
 * Covers version consistency: every workspace package.json, Cargo.toml, tauri.conf.json, the workspace entries in
 * Cargo.lock and package-lock.json must carry one semver, and the Android versionCode in the mobile tauri.conf.json
 * must equal MAJOR*1000000 + MINOR*1000 + PATCH of it (the derivation release-mobile.yml uses). Run by `npm test`.
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

const versionCode = (version) => {
  const [major, minor, patch] = version.split('.').map(Number);
  assert.ok(minor < 1000 && patch < 1000, 'MINOR and PATCH must stay below 1000');
  return major * 1000000 + minor * 1000 + patch;
};

test('versionCode formula is MAJOR*1000000 + MINOR*1000 + PATCH', () => {
  assert.equal(versionCode('0.1.5'), 1005);
  assert.equal(versionCode('0.2.0'), 2000);
  assert.equal(versionCode('1.12.3'), 1012003);
  assert.throws(() => versionCode('0.1000.0'));
  assert.throws(() => versionCode('0.1.1000'));
});

test('Android versionCode equals MAJOR*1000000 + MINOR*1000 + PATCH', () => {
  const code = json('apps/mobile/src-tauri/tauri.conf.json').bundle?.android?.versionCode;
  assert.equal(code, versionCode(fields['package.json']));
});
