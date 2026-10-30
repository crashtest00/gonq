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
// Drive DocumentsUI after the app opened ACTION_OPEN_DOCUMENT_TREE: browse to `path` segments, then "Use this folder" + "Allow".
// The picker may open on Recent/Downloads, so when a segment is not visible the roots drawer is opened and the internal-storage root tried.
async function pickTree(segments, label) {
  await sleep(2500); shot(`${label}-picker-start`); fs.writeFileSync(`${EV}/${label}-picker-start.xml`, dump());
  for (const s of segments) {
    let ok = false;
    for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
      if (!(await tapText(s, 6000))) { await tapMatch(/show roots/i, 1500); await sleep(600); continue; }
      await sleep(1800);
      const bb = findBounds(dump(), s);          // navigated when the folder name is now in the title bar (top of the screen)
      ok = !!bb && bb.y < 130;
      log(`${label}: enter ${s} attempt ${attempt}`, ok, bb ? `y=${bb.y}` : 'name not on screen'); shot(`${label}-enter-${s}-${attempt}`);
    }
    if (!ok) { log(`${label}: navigate to ${s}`, false, 'not entered'); shot(`${label}-nav-fail`); fs.writeFileSync(`${EV}/${label}-nav-fail.xml`, dump()); return false; }
  }
  shot(`${label}-picker-in-folder`);
  const use = (await tapText('Use this folder', 6000)) || (await tapText('USE THIS FOLDER', 3000));
  await sleep(1200); shot(`${label}-picker-grant-dialog`);
  const allow = (await tapText('Allow', 6000)) || (await tapText('ALLOW', 3000));
  await sleep(1500);
  log(`${label}: picker use+allow`, use && allow, `use=${use} allow=${allow}`);
  return use && allow;
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
