// Helpers for M-14 SAF spike scenarios: adb wrappers, uiautomator-driven taps (system picker UI is not a WebView),
// screenshots, filtered logcat, WebView page access via Playwright's Android API, and external file modification.
const { execSync } = require('child_process');
const fs = require('fs');
const PKG = process.env.APP_ID || 'com.gonq.app';
const EV = process.env.EVIDENCE_DIR || 'evidence';
fs.mkdirSync(EV, { recursive: true });
const sh = (c) => execSync(c, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function log(k, ok, d) { results.push({ k, ok, d }); console.log(`[saf] ${k}: ${ok ? 'PASS' : 'FAIL'} ${d || ''}`); }
function shot(name) { fs.writeFileSync(`${EV}/${name}.png`, execSync('adb exec-out screencap -p', { maxBuffer: 1 << 28 })); }
// Whole-device UI hierarchy (works for the system picker, which Playwright cannot see).
function dump() { sh('adb shell uiautomator dump /sdcard/ui.xml >/dev/null'); return sh('adb shell cat /sdcard/ui.xml'); }
function findBounds(xml, text) {
  const re = /<node [^>]*?(?:text|content-desc)="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
  let m; while ((m = re.exec(xml))) if (m[1].toLowerCase() === text.toLowerCase()) return { x: (+m[2] + +m[4]) / 2, y: (+m[3] + +m[5]) / 2 };
  return null;
}
async function tapText(text, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const b = findBounds(dump(), text);
    if (b) { sh(`adb shell input tap ${b.x} ${b.y}`); return true; }
    if (Date.now() > end) { fs.writeFileSync(`${EV}/ui-dump-no-${text.replace(/\W+/g, '_')}.xml`, dump()); return false; }
    await sleep(800);
  }
}
async function tapMatch(re, timeout = 6000) {
  const end = Date.now() + timeout;
  for (;;) {
    const xml = dump(); const rx = /<node [^>]*?(?:text|content-desc)="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g; let m;
    while ((m = rx.exec(xml))) if (m[1] && re.test(m[1])) { sh(`adb shell input tap ${(+m[2] + +m[4]) / 2} ${(+m[3] + +m[5]) / 2}`); return m[1]; }
    if (Date.now() > end) return null;
    await sleep(700);
  }
}
// Touch taps do not register on the emulator's DocumentsUI (found by probe: tap, touchscreen, mouse all ignored; DPAD works), so the
// picker is driven by keyboard: move focus with DPAD until the focused node's bounds contain the target text, then press Enter.
function focusedBounds(xml) {
  const m = /<node [^>]*?focused="true"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml);
  return m ? { l: +m[1], t: +m[2], r: +m[3], b: +m[4] } : null;
}
async function kbSelect(text, label) {
  const keys = [...Array(14).fill('DPAD_DOWN'), 'DPAD_RIGHT', ...Array(14).fill('DPAD_UP'), 'DPAD_LEFT', ...Array(14).fill('DPAD_DOWN')];
  for (let i = 0; i <= keys.length; i++) {
    const xml = dump(); const tb = findBounds(xml, text); const fb = focusedBounds(xml);
    if (tb && fb && tb.x >= fb.l && tb.x <= fb.r && tb.y >= fb.t && tb.y <= fb.b && (fb.b - fb.t) <= 110) { shot(`${label}-focus-${text.replace(/\W+/g, '_')}`); sh('adb shell input keyevent KEYCODE_ENTER'); return true; }
    if (i === keys.length) break;
    sh(`adb shell input keyevent KEYCODE_${keys[i]}`); await sleep(250);
  }
  fs.writeFileSync(`${EV}/${label}-kb-no-${text.replace(/\W+/g, '_')}.xml`, dump()); return false;
}
// Drive DocumentsUI after the app opened ACTION_OPEN_DOCUMENT_TREE. Raw `input tap` and DPAD cannot enter folders on the emulator's
// DocumentsUI (probed: touch ignored, focus never leaves "Create new folder"), so clicks go through Playwright's Android driver, which
// clicks via the accessibility service (device.tap with a selector).
async function axTap(device, texts, timeout = 8000) {
  for (const text of texts) {
    try { await device.tap({ pkg: 'com.google.android.documentsui', text }, { timeout }); return text; } catch (e) { /* try next spelling */ }
  }
  return null;
}
function focusedBounds(xml) {
  const m = /<node [^>]*?focused="true"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml);
  return m ? { l: +m[1], t: +m[2], r: +m[3], b: +m[4] } : null;
}
// Keyboard: move focus with DPAD until the focused node contains the target text, then Enter (the only input that works on this DocumentsUI).
async function kbSelect(text, label) {
  const keys = [...Array(30).fill('TAB'), ...Array(12).fill('DPAD_DOWN'), ...Array(12).fill('DPAD_UP'), ...Array(6).fill('DPAD_RIGHT'), ...Array(12).fill('DPAD_DOWN')];
  for (let i = 0; i <= keys.length; i++) {
    const xml = dump(); const tb = findBounds(xml, text); const fb = focusedBounds(xml);
    if (tb && fb && tb.x >= fb.l && tb.x <= fb.r && tb.y >= fb.t && tb.y <= fb.b && (fb.b - fb.t) <= 110) { shot(`${label}-focus-${text.replace(/\W+/g, '_')}`); sh('adb shell input keyevent KEYCODE_ENTER'); return true; }
    if (i === keys.length) break;
    sh(`adb shell input keyevent KEYCODE_${keys[i]}`); await sleep(250);
  }
  fs.writeFileSync(`${EV}/${label}-kb-no-${text.replace(/\W+/g, '_')}.xml`, dump()); return false;
}
// The spike APK opens the picker already inside the seeded folder (EXTRA_INITIAL_URI), so only "Use this folder" and "Allow" are pressed.
async function pickTree(segments, label, device) {
  await sleep(3000); shot(`${label}-picker-start`); fs.writeFileSync(`${EV}/${label}-picker-start.xml`, dump());
  const use = (await kbSelect('USE THIS FOLDER', label)) || (await kbSelect('Use this folder', label));
  await sleep(1500); shot(`${label}-picker-grant-dialog`); fs.writeFileSync(`${EV}/${label}-grant-dialog.xml`, dump());
  const allow = (await kbSelect('ALLOW', label)) || (await kbSelect('Allow', label));
  await sleep(1500);
  log(`${label}: picker use+allow (keyboard)`, !!(use && allow), `use=${use} allow=${allow}`);
  return !!(use && allow);
}
function logcat(name, extra = '') {
  const pid = sh(`adb shell pidof ${PKG} || true`);
  const all = sh('adb logcat -d -v threadtime');
  const re = new RegExp(`${PKG}|Gonq|gonq|chromium|SAF|DocumentsUI|ExternalStorage|SecurityException|persistable|UriPermission|Permission Denial${extra ? '|' + extra : ''}`);
  const lines = all.split('\n').filter((l) => re.test(l) || (pid && l.includes(` ${pid} `)));
  fs.writeFileSync(`${EV}/${name}.logcat.txt`, lines.slice(-400).join('\n'));
  return lines.length;
}
function persistedGrants() { const o = sh(`adb shell dumpsys uri_grants 2>/dev/null | grep -i -B1 -A3 ${PKG} || true`); return o; }
function launch() { sh(`adb shell am force-stop ${PKG}`); sh(`adb shell monkey -p ${PKG} -c android.intent.category.LAUNCHER 1 >/dev/null`); return sleep(4000); }
function forceStop() { sh(`adb shell am force-stop ${PKG}`); }
// Modify a seeded file from outside the app (conflict-check scenario).
function externalWrite(devicePath, text) { sh(`adb shell "printf '%s' '${text.replace(/'/g, "'\\''")}' > ${devicePath}"`); }
async function webPage(device) { const wv = await device.webView({ pkg: PKG }, { timeout: 60000 }); return wv.page(); }
function finish(info) { fs.writeFileSync(`${EV}/results.json`, JSON.stringify({ info, results }, null, 1)); }
module.exports = { sh, sleep, log, shot, dump, tapText, pickTree, tapMatch, logcat, persistedGrants, launch, forceStop, externalWrite, webPage, finish, results, PKG, EV };
