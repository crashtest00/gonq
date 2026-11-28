// M-34 Android acceptance pass on the Gonq mobile release candidate, READ-ONLY against GitHub (no create branch, commit,
// conflict, Open PR submit, or denied path). NOT run by the author of this file.
// Playwright _android drives the debuggable WebView of the debug APK on a GitHub Actions emulator (API 30, x86_64,
// google_apis). Every check is an independent step (try/catch, screenshot, PASS/FAIL/SKIP in evidence/results.json); a
// failing step never aborts the run. Steps relying on guesses are tagged "unconfirmed" in their detail (see NOTES.md).
//
// env: APK_PATH (RC apk), SKELETON_APK (optional, M-13 apk for the versionCode comparison), APP_ID (com.gonq.app),
//      REPO (crashtest00/gonq), BRANCH_A, BRANCH_B (two existing branches to switch between), PR_BRANCH (branch with an
//      open PR), GITHUB_REPOSITORY/GITHUB_SHA/GITHUB_RUN_ID (commit comments), GO_WAIT_MIN (60), BACKGROUND_SEC (60),
//      ONLY=comma list of step ids.
const { _android } = require('./node_modules/playwright-core');
const { execSync } = require('child_process');
const fs = require('fs');

const PKG = process.env.APP_ID || 'com.gonq.app';
const REPO = process.env.REPO || 'crashtest00/gonq';
const [OWNER, NAME] = REPO.split('/');
const BR = { a: process.env.BRANCH_A, b: process.env.BRANCH_B, pr: process.env.PR_BRANCH };   // BRANCH_A/BRANCH_B: two existing branches; PR_BRANCH: a branch with an open PR
const EV = 'evidence'; fs.mkdirSync(EV, { recursive: true });
const STAMP = Date.now().toString(36);
const results = [];
const only = (process.env.ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
const runs = (id) => !only.length || only.some((o) => id === o || id.startsWith(o + '-'));   // ONLY accepts '06' or '06-local-folder'
const needSignIn = runs('02-signin-approved') || runs('03-relaunch-signedin') || runs('04-open-repo-switch-branch') || runs('05-readonly-banner') || runs('13-openpr-back-nav') || runs('18-signout');   // no sign-in gate when ONLY excludes 02/03
const SIGNIN_FREE = !needSignIn;

const sh = (c, o = {}) => execSync(c, { encoding: 'utf8', ...o }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const save = () => fs.writeFileSync(`${EV}/results.json`, JSON.stringify({ info: global.info, results }, null, 1));
class Skip extends Error {}
const skip = (why) => { throw new Skip(why); };

let device; let seq = 0;
async function shot(name) { try { fs.writeFileSync(`${EV}/${String(++seq).padStart(2, '0')}-${name}.png`, await device.screenshot()); } catch (e) {} }
async function comment(body) {
  try { sh(`gh api repos/${process.env.GITHUB_REPOSITORY}/commits/${process.env.GITHUB_SHA}/comments -f body=${JSON.stringify(body)}`); } catch (e) { console.log('comment failed', e.message); }
}
async function waitComment(word, minutes) {
  const end = Date.now() + minutes * 60000;
  while (Date.now() < end) {
    try { if (sh(`gh api repos/${process.env.GITHUB_REPOSITORY}/commits/${process.env.GITHUB_SHA}/comments -q '.[].body'`).split('\n').some((b) => b.trim() === word)) return true; } catch (e) {}
    await sleep(20000);
  }
  return false;
}
// step(id, title, fn): PASS when fn returns (string detail optional) or returns {ok:false}; SKIP via skip(); FAIL on throw.
async function step(id, title, fn) {
  if (!runs(id)) return;
  let status = 'PASS', detail = '';
  try {
    if (id !== '01-install') await guard(`before ${id}`);
    const r = await fn();
    if (r && typeof r === 'object' && r.ok === false) { status = 'FAIL'; detail = r.detail || ''; } else detail = typeof r === 'string' ? r : (r && r.detail) || '';
  } catch (e) {
    if (e instanceof Skip) { status = 'SKIP'; detail = e.message; } else { status = 'FAIL'; detail = String(e.message || e).split('\n')[0]; }
  }
  await shot(`${id}-${status}`);
  if (id !== '01-install' || status === 'PASS') await guard(`after ${id}`).catch(() => {});   // a failing step must never leave the device in a foreign app
  results.push({ id, title, status, detail });
  console.log(`[accept] ${id} ${status} ${title} ${detail}`); save();
}

// ---- app helpers --------------------------------------------------------------------------------------------------
const cur = async () => (await device.webView({ pkg: PKG }, { timeout: 60000 })).page();   // re-acquire: pages change on relaunch
async function launch({ stop = true } = {}) {
  if (stop) sh(`adb shell am force-stop ${PKG}`);
  sh(`adb shell monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  await sleep(4000);
  const p = await cur(); await p.waitForSelector('text=Documents', { timeout: 60000 }); return p;
}
const T = 15000;
// domTap: click through the DOM (el.click()), not Playwright's actionability click. On the 320 px screen the editor top bar is wider than the
// viewport (the ⋯ button sits at/after the right edge and the page shifts sideways when the keyboard is up), so locator.click() timed out
// on 'More' (steps 12, 16, 17). The app's controls are React onClick buttons, so a DOM click is what a tap does.
async function domTap(loc, timeout = T) { const l = loc.first(); await l.waitFor({ state: 'attached', timeout }); await l.evaluate((el) => el.click()); }
// closeSheets: the bottom sheets (Menu, Editor) have a Close button and a scrim; they do NOT listen for Escape (BottomSheet.tsx), so never use Escape to dismiss them.
async function closeSheets(p) {
  for (let i = 0; i < 3; i++) {
    const b = p.getByRole('dialog').getByRole('button', { name: 'Close', exact: true });
    if (!(await b.count())) return;
    await b.last().evaluate((el) => el.click()); await sleep(300);
  }
}
// longPress: the app's useLongPress listens for pointerdown (touch, primary) on .cm-content held ~450 ms without moving. Dispatched as synthetic touch pointer events on the
// element, so no screen-coordinate guessing (the adb swipe in the last run landed on the tab strip). unconfirmed: the native selection handles are not exercised.
async function longPress(p, selector) {
  await p.locator(selector).first().evaluate(async (el) => {
    const r = el.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 7, clientX: r.left + 10, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); await new Promise((res) => setTimeout(res, 700)); el.dispatchEvent(new PointerEvent('pointerup', o));
  });
  await sleep(500);
}
async function menu(p, menuName, item, opts = {}) {            // ⋯ (aria-label "More") > <menu> > <item>
  await domTap(p.getByRole('button', { name: 'More', exact: true }));
  const m = p.getByRole('menu', { name: menuName, exact: true });
  await domTap(m.getByRole(opts.role || 'menuitem', { name: item }));
}
async function menuItemState(p, menuName, item) {
  await domTap(p.getByRole('button', { name: 'More', exact: true }));
  const b = p.getByRole('menu', { name: menuName, exact: true }).getByRole('menuitem', { name: item });
  const r = { count: await b.count(), disabled: count0(await b.count()) ? await b.isDisabled() : null };
  await closeSheets(p); return r;
}
const count0 = (n) => n > 0;
// goHome: the app has no Android Back handler (story M-35), so the Back KEY would close it. Tap the in-app Back button (PhoneShell aria-label "Back") until the Documents screen shows. Never KEYCODE_BACK.
const goHome = async (p) => {
  for (let i = 0; i < 10; i++) {
    p = await cur();
    if (await p.getByText('Recent documents').count()) return;
    const b = p.getByRole('button', { name: 'Back' });
    if (await b.count()) await b.first().click({ timeout: T }).catch(() => {});
    if (await p.getByText('Recent documents').first().waitFor({ timeout: 15000 }).then(() => true, () => false)) return;
  }
};
async function back() { sh('adb shell input keyevent KEYCODE_BACK'); await sleep(1200); }
const editorText = (p) => p.evaluate(() => document.querySelector('.cm-content')?.innerText || '');
async function focusEditorEnd(p) { await p.locator('.cm-content').click(); await p.keyboard.press('Control+End'); }
async function typeIme(text) { sh(`adb shell input text ${JSON.stringify(text.replace(/ /g, '%s'))}`); await sleep(500); }   // real key events through the IME stack
async function signedInOpenRepo(p, branch) {                   // from Documents home to the repo screen (read-only), optionally on <branch>
  await p.getByRole('button', { name: 'Open Repo…' }).click();
  await p.getByLabel('Filter repositories').fill(NAME, { timeout: 60000 });
  await p.getByRole('button', { name: REPO, exact: false }).first().click({ timeout: 60000 });
  await p.getByRole('button', { name: /^Branch:/ }).waitFor({ timeout: 60000 });
  if (branch) await switchBranch(p, branch);
}
async function switchBranch(p, b) {
  await p.getByRole('button', { name: /^Branch:/ }).click();
  await p.getByLabel('Filter branches').fill(b);
  await p.getByRole('listbox', { name: 'Branches' }).getByRole('option', { name: b, exact: true }).click({ timeout: T });
  await p.getByRole('button', { name: `Branch: ${b}` }).waitFor({ timeout: T });
}
async function openFirstRepoFile(p) {                         // first file row in the tree (rows are buttons with title=<name>; folders carry aria-expanded)
  const row = p.locator('.m-tree-row:not([aria-expanded])').first();   // unconfirmed: files have no aria-expanded
  await row.waitFor({ timeout: 30000 }); await row.click();
  await p.locator('.cm-content').waitFor({ timeout: 30000 });
}
const DIR = '/sdcard/Documents/GonqAccept';
async function openLocal(p, name) {                            // from Documents home: recents row for the folder/file, then the file by name
  await goHome(p); p = await cur();
  await p.locator('li button').filter({ hasText: new RegExp(`${name.replace('.', '\\.')}|GonqAccept`) }).first().click({ timeout: T });
  if (!(await p.locator('.cm-content').waitFor({ timeout: 6000 }).then(() => true, () => false))) { await p.getByText(name).first().click({ timeout: T }); await p.locator('.cm-content').waitFor({ timeout: 30000 }); }
  return p;
}
// uiautomator: read the native hierarchy (system pickers, permission dialogs, browser). Dump to /sdcard, read back with exec-out cat (no pull), retry on empty/failed dump.
function uiXml(stage) {
  const f = `/sdcard/ui-${process.pid}.xml`; let xml = '', err = '';
  for (let k = 0; k < 3 && !/<hierarchy/.test(xml); k++) {
    try { sh(`adb shell rm -f ${f}`); const o = sh(`adb shell uiautomator dump ${f} 2>&1`); xml = execSync(`adb exec-out cat ${f}`, { encoding: 'utf8', maxBuffer: 1 << 26 }); err = o; }
    catch (e) { err = String(e.message || e).slice(0, 200); }
    if (!/<hierarchy/.test(xml)) { console.log(`[saf] dump attempt ${k + 1} failed (${err}); retry`); execSync('sleep 1'); }
  }
  fs.writeFileSync(`${EV}/ui.xml`, xml);
  if (stage) { fs.writeFileSync(`${EV}/saf-${stage}.xml`, xml); console.log(`[saf] dumped ${xml.length} bytes -> saf-${stage}.xml`); }
  return xml;
}
const unent = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function uiNodes(stage) {
  const xml = uiXml(stage); const out = [];
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const n = m[0]; const b = n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/); if (!b) continue;
    out.push({ text: unent((n.match(/ text="([^"]*)"/) || [])[1] || ''), rid: (n.match(/resource-id="([^"]*)"/) || [])[1] || '', desc: unent((n.match(/content-desc="([^"]*)"/) || [])[1] || ''),
      enabled: /enabled="true"/.test(n), x: (+b[1] + +b[3]) >> 1, y: (+b[2] + +b[4]) >> 1, h: +b[4] - +b[2], bounds: b[0], pkg: (n.match(/package="([^"]*)"/) || [])[1] || '' });
  }
  return out;
}
// tap the first ENABLED node whose text/content-desc matches re (resource id optional: rid substring); returns true if tapped
function uiTap(re, { rid = null, nodes = null } = {}) {
  for (const n of nodes || uiNodes()) {
    if (!n.enabled || (rid && !n.rid.includes(rid))) continue;
    if (re.test(n.text) || re.test(n.desc)) { sh(`adb shell input tap ${n.x} ${n.y}`); return true; }
  }
  return false;
}
const focusPkg = () => sh('adb shell dumpsys window | grep -m1 mCurrentFocus || true');
// SAF picker (DocumentsUI): starts at the storage root where "Use this folder" is disabled. Navigate Documents > GonqAccept, USE THIS FOLDER, Allow.
// Every action is logged to stdout as [saf] ...; the picker hierarchy is saved to evidence/saf-<stage>.xml at each stage.
async function safPick() {
  const T0 = Date.now(); const over = () => Date.now() - T0 > 60000;       // 60 s fail-fast
  const log = []; const L = (m) => { console.log(`[saf] ${m}`); log.push(m); };
  const fin = (ok) => ({ ok, log: log.join(' > ') });
  const fg = () => focusPkg().replace(/.*\{|\}/g, '');
  sh(`adb shell mkdir -p ${DIR}`); L(`mkdir -p ${DIR}; focus=${fg()}`);
  for (let i = 0; i < 4 && !over() && !/documentsui|permissioncontroller/.test(focusPkg()); i++) await sleep(2000);   // wait for the picker window (no uiautomator dump: it would fight device.tap)
  if (!/documentsui|permissioncontroller/.test(focusPkg())) { L(`picker not in focus (${fg()})`); return fin(false); }
  // tap by text with Playwright's UiAutomator-backed device.tap; on a throw fall back to DPAD navigation (DOWN until the item is focused, then ENTER). Every attempt is logged.
  const tapText = async (variants, { optional = false } = {}) => {
    const names = [].concat(variants);
    for (const name of names) {
      if (over()) { L('60 s budget exceeded'); return false; }
      try { await device.tap({ text: name }, { timeout: optional ? 3000 : 8000 }); L(`device.tap '${name}' ok`); return true; }
      catch (e) { L(`device.tap '${name}' threw: ${String(e.message || e).split('\n')[0].slice(0, 80)}`); }
    }
    if (optional) return false;
    const name = names[0];
    for (let k = 1; k <= 20 && !over(); k++) {
      sh('adb shell input keyevent KEYCODE_DPAD_DOWN'); L(`DPAD_DOWN #${k} looking for '${name}'`); await sleep(400);
      const focused = await Promise.any(names.map((n) => device.info({ text: n }).then((i) => (i.focused ? true : Promise.reject(new Error('not focused')))))).then(() => true, () => false);
      if (focused) { sh('adb shell input keyevent KEYCODE_ENTER'); L(`DPAD: '${name}' focused after ${k} presses, ENTER`); return true; }
    }
    L(`DPAD fallback failed for '${name}'`); return false;
  };
  if (!(await tapText('Documents'))) return fin(false);
  if (!(await device.wait({ text: 'GonqAccept' }, { timeout: 8000 }).then(() => true, () => false))) { L("picker did not navigate into 'Documents'"); return fin(false); }
  if (!(await tapText('GonqAccept'))) return fin(false);
  if (!(await device.wait({ text: 'USE THIS FOLDER' }, { timeout: 8000 }).then(() => true, () => device.wait({ text: 'Use this folder' }, { timeout: 2000 }).then(() => true, () => false)))) { L("picker did not navigate into 'GonqAccept'"); return fin(false); }
  if (over()) { L('USE THIS FOLDER unavailable (budget)'); return fin(false); }
  if (!(await tapText(['USE THIS FOLDER', 'Use this folder']))) return fin(false);
  await sleep(2000);
  if (await tapText(['ALLOW', 'Allow'], { optional: true })) await sleep(2000);
  L(`end focus=${fg()}`);
  return fin(true);
}
// guard: never leave/start a step in a foreign activity (documentsui, browser, launcher); bring the app to the foreground, relaunch if the WebView is missing
async function guard(why) {
  const notes = [];
  for (let i = 0; i < 4 && !focusPkg().includes(PKG); i++) {
    const f = focusPkg(); notes.push(`foreign: ${f.replace(/.*\{|\}/g, '').slice(0, 60)}`);
    if (/launcher/i.test(f)) break;                                  // on the launcher: Back does nothing useful, relaunch below
    sh('adb shell input keyevent KEYCODE_BACK'); await sleep(1200);
  }
  if (!focusPkg().includes(PKG)) {
    sh('adb shell input keyevent KEYCODE_WAKEUP || true'); notes.push('monkey');
    await launch({ stop: false }).catch((e) => notes.push('launch(monkey) did not reach Documents: ' + String(e.message || e).split('\n')[0]));
  }
  if (!(await device.webView({ pkg: PKG }, { timeout: 15000 }).then(() => true, () => false))) {
    notes.push('webview missing, relaunch');
    await launch().catch((e) => notes.push('webview still missing / Documents not rendered: ' + String(e.message || e).split('\n')[0]));   // force-stop + monkey + wait for the 'Documents' text
    try { require('fs').writeFileSync(`${EV}/logcat-${String(why).replace(/\W+/g, '_')}.txt`, sh(`adb logcat -d -v time | grep -i -E 'gonq|AndroidRuntime|FATAL|ActivityManager|WebView|chromium' | tail -250 || true`) + '\n--- pidof: ' + sh(`adb shell pidof ${PKG} || true`) + '\n--- focus: ' + focusPkg()); } catch (e) { notes.push('logcat failed ' + e.message); }
  }
  if (notes.length) console.log(`[guard ${why}] ${notes.join('; ')}`);
}

async function openFolderFlow() {                            // seed files, Open Folder… via SAF (one attempt, <= 60 s), open one.md; Skip if the picker is not drivable
    sh(`adb shell mkdir -p ${DIR}`);
    sh(`printf '# Local one\\n\\nhello\\n' | adb shell "cat > ${DIR}/one.md"`);
    let p = await launch(); await goHome(p); p = await cur(); await p.getByRole('button', { name: 'Open Folder…' }).click(); await sleep(3000); await shot('saf-picker');
    const nav = await safPick(); await shot('saf-done');
    await guard('after picker');
    if (!nav.ok) skip(`SAF picker not drivable (${nav.log.slice(-200)})`);
    await sleep(1500);
    p = await cur(); await p.getByRole('dialog', { name: 'Folder navigator' }).or(p.getByText('one.md')).first().waitFor({ timeout: 20000 });
    await p.getByText('one.md').first().click(); await p.locator('.cm-content').waitFor({ timeout: 30000 });
    return nav.log;
}
// in-app documents: '+' (aria-label "New") on the Documents screen opens an untitled document; type content with the real editor
async function newDoc(text) {
  let p = await cur(); await goHome(p); p = await cur();
  await p.getByRole('button', { name: 'New', exact: true }).click();
  await p.locator('.cm-content').waitFor({ timeout: 30000 });
  await p.locator('.cm-content').click();
  if (text) { const lines = text.split('\n'); for (let i = 0; i < lines.length; i++) { if (i) await p.keyboard.press('Enter'); if (lines[i]) await p.keyboard.type(lines[i], { delay: 15 }); } }
  await sleep(500);
  return p;
}
const DOC_TEXT = 'Hello paragraph\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nSee [example](https://example.com) here.\n\nCommentable text line';
// make sure an editor is open on an in-app document (no picker)
async function ensureDoc() {
  let p = await cur();
  if (await p.locator('.cm-content').count()) return p;
  return await newDoc(DOC_TEXT);
}
// ===================== orchestrator emulator batch 2026-11-27 (f20998d): sign-in free, one check per step =====================
const VERD = [];
const saveV = () => fs.writeFileSync(`${EV}/batch-results.json`, JSON.stringify({ info: global.info, VERD }, null, 1));
const onlyB = (process.env.BATCH_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
const wantB = (id) => !onlyB.length || onlyB.includes(id.split('-')[0]);
const note = (m) => console.log(`[batch] ${m}`);
async function chk(id, title, fn) {
  if (!wantB(id)) return;
  let verdict = 'UNVERIFIABLE (harness)', detail = '';
  try {
    await guard(`before ${id}`);
    const r = await fn();
    verdict = r.verdict; detail = r.detail;
  } catch (e) { detail = 'harness error: ' + String(e.message || e).split('\n')[0].slice(0, 300); }
  await shot(`chk${id}-${verdict.split(' ')[0]}`);
  await guard(`after ${id}`).catch(() => {});
  VERD.push({ id, title, verdict, detail }); note(`${id} ${verdict} ${title} :: ${detail}`); saveV();
}
const IME = () => sh("adb shell dumpsys input_method | grep -E 'mInputShown|mIsInputViewShown|isInputViewShown' || true").split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3).join(' | ');
const imeShown = () => /mInputShown=true/.test(IME());
const resumed = () => sh("adb shell dumpsys activity activities | grep -m1 -E 'mResumedActivity|ResumedActivity' || true");
const INSTALL = () => {
  const find = () => {
    for (const c of [document.querySelector('.cm-content'), document.querySelector('.cm-editor'), document.querySelector('.cm-scroller')]) {
      if (!c) continue;
      for (const k of Object.getOwnPropertyNames(c)) {
        let o; try { o = c[k]; } catch (e) { continue; }
        if (!o || typeof o !== 'object') continue;
        if (o.state && o.dispatch && o.coordsAtPos) return o;
        if (o.view && o.view.state && o.view.dispatch && o.view.coordsAtPos) return o.view;
        if (o.rootView && o.rootView.view && o.rootView.view.dispatch) return o.rootView.view;
      }
    }
    return null;
  };
  window.__keys = () => { const c = document.querySelector('.cm-content'); return c ? Object.getOwnPropertyNames(c).join(',') : 'no .cm-content'; };
  if (!window.__baseH) window.__baseH = innerHeight;
  window.__g = {
    ok: () => !!find(),
    sel: () => { const s = find().state.selection.main; return [s.anchor, s.head]; },
    idx: (w) => find().state.doc.toString().indexOf(w),
    len: () => find().state.doc.length,
    select: (a, b) => find().dispatch({ selection: { anchor: a, head: b === undefined ? a : b }, scrollIntoView: true }),
    setText: (t) => find().dispatch({ changes: { from: 0, to: find().state.doc.length, insert: t } }),
    wordRect: async (w) => {
      const v = find(); const pos = v.state.doc.toString().indexOf(w) + Math.floor(w.length / 2);
      const b = v.lineBlockAt(pos); v.scrollDOM.scrollTop = Math.max(0, b.top - 60); await new Promise((r) => setTimeout(r, 250));
      const c = v.coordsAtPos(pos); return c ? { l: c.left, r: c.right, t: c.top, b: c.bottom } : null;
    },
  };
};
async function stage(label) {
  try { const q = await cur(); const t = await q.evaluate(() => [document.querySelector('.cm-content') ? 'editor' : 'noeditor', 'markers=' + document.querySelectorAll('.cm-thread-marker').length, 'innerH=' + innerHeight, 'base=' + window.__baseH, document.body.innerText.slice(0, 70).replace(/\n/g, '|')].join(' ')); note(`stage ${label}: ${t} | ${focusPkg().replace(/.*\{|\}/g, '')} | ime[${IME()}]`); } catch (e) { note(`stage ${label}: err ${String(e.message).split('\n')[0]}`); }
  await shot(`stage-${label}`);
}
const P = async () => { const p = await cur(); await p.evaluate(INSTALL); return p; };
let MAP = null;
async function calibrate(p) {
  const sz = sh('adb shell wm size').match(/(\d+)x(\d+)/g).pop().split('x').map(Number);
  await p.evaluate(() => {
    window.__cal = null; const T = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'];
    window.__calh = (e) => { if (!window.__cal) window.__cal = { cx: e.clientX !== undefined ? e.clientX : e.touches[0].clientX, cy: e.clientY !== undefined ? e.clientY : e.touches[0].clientY, dpr: devicePixelRatio, iw: innerWidth, ih: innerHeight }; e.stopImmediatePropagation(); e.preventDefault(); };
    for (const t of T) document.addEventListener(t, window.__calh, true);
  });
  sh(`adb shell input tap ${sz[0] >> 1} ${sz[1] >> 1}`); await sleep(700);
  const c = await p.evaluate(() => { const T = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend']; for (const t of T) document.removeEventListener(t, window.__calh, true); return window.__cal; });
  if (!c) throw new Error('calibration tap not seen by the page');
  MAP = { dpr: c.dpr, x0: (sz[0] >> 1) - c.cx * c.dpr, y0: (sz[1] >> 1) - c.cy * c.dpr, W: sz[0], H: sz[1], iw: c.iw, ih: c.ih };
  note(`calibration ${JSON.stringify(MAP)}`); return MAP;
}
const tapCss = (cx, cy) => { const x = Math.round(MAP.x0 + cx * MAP.dpr), y = Math.round(MAP.y0 + cy * MAP.dpr); sh(`adb shell input tap ${x} ${y}`); return [x, y]; };
async function rect(p, sel, nth = 0) {
  return p.evaluate(([s, n]) => { const el = document.querySelectorAll(s)[n]; if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; }, [sel, nth]);
}
async function realTapEl(p, sel, nth = 0, scroll = true) {
  if (scroll) await p.evaluate(([s, n]) => document.querySelectorAll(s)[n]?.scrollIntoView({ block: 'center', inline: 'nearest' }), [sel, nth]);
  await sleep(250); const r = await rect(p, sel, nth); if (!r) throw new Error(`no element ${sel}[${nth}]`);
  return tapCss((r.l + r.r) / 2, (r.t + r.b) / 2);
}
const dlg = (p) => p.getByRole('dialog', { name: 'Comments' });
async function closeComments(p) {
  for (let i = 0; i < 4; i++) {
    if (!(await dlg(p).count())) return;
    const b = dlg(p).getByRole('button', { name: /^(Cancel|Back|Close)$/ });
    if (await b.count()) await domTap(b.first()); else await domTap(p.getByRole('button', { name: 'Comments', exact: true }));
    await sleep(500);
  }
}
async function hideIme() {
  if (!imeShown()) return;
  for (let i = 0; i < 2; i++) {
    sh('adb shell input keyevent 4'); await sleep(900);
    const q = await cur().catch(() => null); if (!q) return;
    const sh2 = await q.evaluate(() => (window.__baseH || innerHeight) - innerHeight).catch(() => 0);
    if (sh2 < 60) return;
  }
}
async function showImeViaEditor(p) {
  const r = await rect(p, '.cm-line:last-of-type'); 
  for (let i = 0; i < 3 && !imeShown(); i++) { const ls = await p.locator('.cm-line').count(); await realTapEl(p, '.cm-line', ls - 1); await sleep(1200); }
  return imeShown();
}
const WORDS = [['alpha', 'Numbered', 'one'], ['bravo', 'Bullet', 'two'], ['charlie', 'Task', 'three'], ['delta', 'Paragraph', 'four']];
const FIX_TEXT = '# Batch\n\n1. Numbered alpha item\n\n- Bullet bravo item\n\n- [ ] Task charlie item\n\nParagraph delta text here.\n\nTrailing line for caret and more words here\n';
async function addComment(p, word, body) {
  await p.evaluate(([w]) => { const g = window.__g; const i = g.idx(w); g.select(i, i + w.length); }, [word]);
  await sleep(500);
  await domTap(p.locator('.m-addcomment-btn'));
  const ta = p.getByRole('textbox', { name: 'Comment', exact: true }); await ta.waitFor({ timeout: T }); await ta.fill(body);
  await domTap(dlg(p).getByRole('button', { name: 'Submit' })); await sleep(900);
  await hideIme(); await closeComments(p);
}
const markerCount = (p) => p.locator('.cm-thread-marker').count();
async function newDoc2() {
  let p = await cur(); await goHome(p); p = await cur();
  await domTap(p.getByRole('button', { name: 'New', exact: true }));
  await p.locator('.cm-content').waitFor({ timeout: 30000 }); await sleep(800); return p;
}
async function ensureFixture() {
  let p = await cur();
  if (await p.locator('.cm-content').count()) { await p.evaluate(INSTALL); if ((await markerCount(p)) >= 4) return p; }
  p = await newDoc2(); await p.evaluate(INSTALL); await stage('newdoc');
  if (!(await p.evaluate(() => window.__g.ok()))) throw new Error('CodeMirror view not reachable; cm-content own props: ' + (await p.evaluate(() => window.__keys())));
  await p.evaluate((t) => window.__g.setText(t), FIX_TEXT); await sleep(600);
  for (const [w, , b] of WORDS) { await addComment(p, w, `note ${b}`); await stage('after-' + w); }
  await hideIme(); await closeComments(p);
  const n = await markerCount(p); if (n < 4) throw new Error(`fixture has ${n} markers, expected 4`);
  return p;
}
const markerIdx = async (p, key) => p.evaluate((k) => [...document.querySelectorAll('.cm-thread-marker')].findIndex((m) => (m.closest('.cm-line')?.innerText || '').includes(k)), key);
async function ime2() { return IME(); }
const threadOpen = async (p) => (await dlg(p).getByRole('button', { name: 'Edit thread' }).count()) > 0;
async function kbFrame() {
  try { const o = sh("adb shell dumpsys window windows | grep -A40 -m1 'Window #.*InputMethod' | grep -m3 -E 'mFrame|Frames:|containing' || true"); return o.replace(/\s+/g, ' ').slice(0, 220); } catch (e) { return ''; }
}

(async () => {
  [device] = await _android.devices();
  global.info = { model: sh('adb shell getprop ro.product.model'), android: sh('adb shell getprop ro.build.version.release'), sdk: sh('adb shell getprop ro.build.version.sdk'), repo: REPO, apk: process.env.APK_PATH };
  sh('adb shell settings put secure show_ime_with_hard_kb 1'); sh('adb shell cmd uimode night no');
  note(`device ${JSON.stringify(global.info)} wm=${sh('adb shell wm size')} ${sh('adb shell wm density')}`);

  await step('01-install', 'Fresh install of the APK', async () => {
    sh(`adb uninstall ${PKG} || true`); sh(`adb install "${process.env.APK_PATH}"`);
    const vc = (sh(`adb shell dumpsys package ${PKG}`).match(/versionCode=(\d+)/) || [])[1];
    await launch(); return `installed versionCode=${vc}`;
  });
  if (!results.length || results[0].status !== 'PASS') { note('install failed'); process.exit(1); }

  // ---------- fixture ----------
  let p = null; let fixErr = '';
  try { p = await ensureFixture(); await stage('fixture-ready'); p = await cur(); if (!(await p.locator('.cm-content').count())) throw new Error('fixture-ready but editor not showing'); await calibrate(p); } catch (e) { fixErr = String(e.message || e).split('\n')[0]; note('fixture failed: ' + fixErr); }
  const need = async () => { if (!MAP || fixErr) throw new Error('fixture/calibration unavailable: ' + fixErr); const q = await ensureFixture(); return q; };

  // ---------- 2 marker keyboard ----------
  await chk('2-marker-keyboard', 'Marker tap keeps keyboard hidden/hides it, caret unchanged (c2c56970 / 948663ab)', async () => {
    let q = await need(); await closeComments(q); await hideIme(); const out = []; let ok = true;
    const mi = await markerIdx(q, 'Paragraph');
    // (a) keyboard shown
    if (!(await showImeViaEditor(q))) return { verdict: 'UNVERIFIABLE (harness)', detail: `could not show keyboard: ${IME()}` };
    await q.evaluate(() => { const g = window.__g; g.select(g.idx('Trailing') + 3); }); await sleep(300);
    const sb = await q.evaluate(() => window.__g.sel()); const ib = IME(); await shot('marker-a-before-tap');
    await realTapEl(q, '.cm-thread-marker', mi); await sleep(1500);
    q = await P(); const sa = await q.evaluate(() => window.__g.sel()); const ia = IME(); const to = await threadOpen(q); await shot('marker-a-after-tap');
    const aok = to && /mInputShown=true/.test(ib) && !/mInputShown=true/.test(ia) && sb[0] === sa[0] && sb[1] === sa[1];
    out.push(`(a) kb shown: before[${ib}] after[${ia}] threadOpen=${to} sel ${JSON.stringify(sb)}->${JSON.stringify(sa)} => ${aok ? 'ok' : 'NOT ok'}`); ok = ok && aok;
    // (b) keyboard hidden
    await closeComments(q); await hideIme(); await sleep(400);
    const sb2 = await q.evaluate(() => window.__g.sel()); const ib2 = IME();
    await realTapEl(q, '.cm-thread-marker', mi); await sleep(1500);
    q = await P(); const sa2 = await q.evaluate(() => window.__g.sel()); const ia2 = IME(); const to2 = await threadOpen(q); await shot('marker-b-after-tap');
    const bok = to2 && !/mInputShown=true/.test(ib2) && !/mInputShown=true/.test(ia2) && sb2[0] === sa2[0] && sb2[1] === sa2[1];
    out.push(`(b) kb hidden: before[${ib2}] after[${ia2}] threadOpen=${to2} sel ${JSON.stringify(sb2)}->${JSON.stringify(sa2)} => ${bok ? 'ok' : 'NOT ok'}`); ok = ok && bok;
    await closeComments(q);
    return { verdict: ok ? 'PASS' : 'FAIL', detail: out.join(' ; ') };
  });

  // ---------- 3 marker shift ----------
  const SNAP = (i) => { const m = document.querySelectorAll('.cm-thread-marker')[i]; const ln = m.closest('.cm-line'); const L = (e) => e ? +e.getBoundingClientRect().left.toFixed(2) : null; const tw = document.createTreeWalker(ln, NodeFilter.SHOW_TEXT); let first = null, after = null, n; while ((n = tw.nextNode())) { if (!n.textContent.trim()) continue; const pos = m.compareDocumentPosition(n); if (pos & Node.DOCUMENT_POSITION_FOLLOWING) { if (!after) after = n; } else if (!first) first = n; } const tl = (t) => { if (!t) return null; const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 1); return +r.getBoundingClientRect().left.toFixed(2); }; const sc = document.querySelector('.cm-scroller'); return { marker: L(m), line: L(ln), content: L(document.querySelector('.cm-content')), firstText: tl(first), textAfterMarker: tl(after), scrollerScrollLeft: sc ? sc.scrollLeft : null, docScrollLeft: document.scrollingElement.scrollLeft, markerClass: m.className, lineClass: ln.className, vvOffsetLeft: visualViewport.offsetLeft }; };
  await chk('3-marker-shift', 'Marker does not shift on real tap (2ba1b2e6)', async () => {
    let q = await need(); const out = []; let ok = true;
    for (const key of ['Numbered', 'Bullet', 'Task', 'Paragraph']) {
      q = await P(); await closeComments(q); await hideIme(); await q.evaluate(() => window.__g.select(0)); await sleep(300);
      const mi = await markerIdx(q, key); if (mi < 0) { out.push(`${key}: marker not found`); ok = false; continue; }
      await q.evaluate((i) => document.querySelectorAll('.cm-thread-marker')[i].scrollIntoView({ block: 'center' }), mi); await sleep(400);
      const r0 = await rect(q, '.cm-thread-marker', mi); const sn0 = await q.evaluate(SNAP, mi);
      await q.evaluate((i) => { window.__s = []; const t0 = performance.now(); window.__iv = setInterval(() => { const m = document.querySelectorAll('.cm-thread-marker')[i]; window.__s.push(m ? m.getBoundingClientRect().left : null); }, 20); }, mi);
      await realTapEl(q, '.cm-thread-marker', mi, false); await sleep(300);
      const r1 = await rect(q, '.cm-thread-marker', mi); const sn1 = await q.evaluate(SNAP, mi).catch(() => null); await sleep(500);
      const s = await q.evaluate(() => { clearInterval(window.__iv); return window.__s.filter((v) => v !== null); });
      const d = r1 ? r1.l - r0.l : NaN; const spread = s.length ? Math.max(...s) - Math.min(...s) : NaN;
      const good = Math.abs(d) <= 1; ok = ok && good;
      out.push(`${key}: left0=${r0.l.toFixed(2)} left@300ms=${r1 ? r1.l.toFixed(2) : 'n/a'} delta=${d.toFixed(2)}px (samples min..max spread ${spread.toFixed(2)}px over ${s.length}) => ${good ? 'ok' : 'SHIFTED'} | refs before ${JSON.stringify(sn0)} after ${JSON.stringify(sn1)}`);
      await shot(`marker-shift-${key}`);
    }
    await closeComments(q);
    return { verdict: ok ? 'PASS' : 'FAIL', detail: out.join(' ; ') };
  });

  // ---------- 4 composer ----------
  const sheetM = async (q, label) => {
    const m = await q.evaluate(() => { const s = document.querySelector('.m-sheet-docked'); const r = s && s.getBoundingClientRect(); const vv = window.visualViewport; const ct = document.querySelector('.m-content'); const cr = ct && ct.getBoundingClientRect(); return { sheetTop: r && r.top, sheetBottom: r && r.bottom, innerH: innerHeight, vvH: vv.height, vvTop: vv.offsetTop, contentBottom: cr && cr.bottom, screenH: screen.height }; });
    const ime = IME(); const kf = await kbFrame(); const gap = m.sheetBottom === null ? NaN : (m.vvTop + m.vvH) - m.sheetBottom;
    note(`composer ${label}: ${JSON.stringify(m)} ime[${ime}] kbframe[${kf}]`);
    return { gap, m, ime, kf, text: `${label}: sheetBottom=${m.sheetBottom && m.sheetBottom.toFixed(1)} vvBottom=${(m.vvTop + m.vvH).toFixed(1)} gap=${gap.toFixed(1)}css px (content bottom ${m.contentBottom && m.contentBottom.toFixed(1)}) ime[${ime}] kbframe[${kf}]` };
  };
  await chk('4-composer', 'Composer: no empty band, Back = Cancel (731e76b8 / 28699c16)', async () => {
    let q = await need(); const out = []; let ok = true; const BAND = 6;
    await closeComments(q); await hideIme();
    // new draft, keyboard shown
    await q.evaluate(() => { const g = window.__g; const i = g.idx('delta'); g.select(i, i + 5); }); await sleep(500);
    await realTapEl(q, '.m-addcomment-btn', 0, false); await sleep(1500);
    let ta = q.getByRole('textbox', { name: 'Comment', exact: true });
    if (!(await ta.count())) return { verdict: 'UNVERIFIABLE (harness)', detail: 'draft did not open from real tap on Add Comment' };
    if (!imeShown()) { await realTapEl(q, 'textarea[aria-label="Comment"]'); await sleep(1200); }
    let m = await sheetM(q, 'new-draft kb SHOWN'); await shot('composer-draft-kb-shown'); out.push(m.text);
    const shownKb = /mInputShown=true/.test(m.ime); if (!shownKb) out.push('(keyboard did not show)'); if (m.gap > BAND) ok = false;
    // hide keyboard (first Back hides IME only)
    sh('adb shell input keyevent 4'); await sleep(1200); q = await P();
    const stillDraft = (await q.getByRole('textbox', { name: 'Comment', exact: true }).count()) > 0;
    m = await sheetM(q, 'new-draft kb HIDDEN'); await shot('composer-draft-kb-hidden'); out.push(m.text + ` draftStillOpen=${stillDraft}`); if (m.gap > BAND) ok = false;
    // Back with keyboard hidden = Cancel
    sh('adb shell input keyevent 4'); await sleep(1200); q = await P();
    const draftGone = (await q.getByRole('textbox', { name: 'Comment', exact: true }).count()) === 0; const listBack = (await dlg(q).count()) > 0 && (await dlg(q).getByRole('button', { name: 'Add comment' }).count()) > 0;
    out.push(`Back(kb hidden) on new draft: draftGone=${draftGone} backAtList=${listBack}`); if (!draftGone || !listBack) ok = false; await shot('composer-draft-after-back');
    // Back with keyboard still shown (informational)
    await realTapEl(q, 'button.m-tap-primary.m-block', 0).catch(() => {}); await sleep(1200);
    if (await q.getByRole('textbox', { name: 'Comment', exact: true }).count()) { if (!imeShown()) { await realTapEl(q, 'textarea[aria-label="Comment"]'); await sleep(1000); } const wasShown = imeShown(); sh('adb shell input keyevent 4'); await sleep(1000); const d1 = (await q.getByRole('textbox', { name: 'Comment', exact: true }).count()) === 0; sh('adb shell input keyevent 4'); await sleep(1000); const d2 = (await q.getByRole('textbox', { name: 'Comment', exact: true }).count()) === 0; out.push(`info: draft with kb shown(${wasShown}): after Back#1 draftGone=${d1}, after Back#2 draftGone=${d2}`); }
    await closeComments(q); await hideIme();
    // edit existing comment
    q = await P(); const mi = await markerIdx(q, 'Bullet'); await realTapEl(q, '.cm-thread-marker', mi); await sleep(1500);
    if (!(await threadOpen(q))) { out.push('edit: thread did not open'); return { verdict: ok ? 'UNVERIFIABLE (harness)' : 'FAIL', detail: out.join(' ; ') }; }
    await realTapEl(q, '[aria-label="Edit thread"]'); await sleep(1500);
    if (!(await q.getByRole('textbox', { name: 'Edit comment', exact: true }).count())) { out.push('edit box did not open'); return { verdict: 'UNVERIFIABLE (harness)', detail: out.join(' ; ') }; }
    if (!imeShown()) { await realTapEl(q, 'textarea[aria-label="Edit comment"]'); await sleep(1200); }
    m = await sheetM(q, 'edit kb SHOWN'); await shot('composer-edit-kb-shown'); out.push(m.text); if (m.gap > BAND) ok = false;
    sh('adb shell input keyevent 4'); await sleep(1200); q = await P();
    m = await sheetM(q, 'edit kb HIDDEN'); await shot('composer-edit-kb-hidden'); out.push(m.text); if (m.gap > BAND) ok = false;
    sh('adb shell input keyevent 4'); await sleep(1200); q = await P();
    const editGone = (await q.getByRole('textbox', { name: 'Edit comment', exact: true }).count()) === 0; const thr = await threadOpen(q);
    out.push(`Back on edit: editGone=${editGone} backAtThread=${thr}`); if (!editGone || !thr) ok = false; await shot('composer-edit-after-back');
    await closeComments(q);
    return { verdict: ok ? 'PASS' : 'FAIL', detail: `band threshold ${BAND} css px; ` + out.join(' ; ') };
  });

  // ---------- 5 show comments ----------
  await chk('5-show-comments', 'Hardware Back closes Comments sheet, button data-active false (d6cdd520)', async () => {
    let q = await need(); await closeComments(q); await hideIme(); const btn = q.getByRole('button', { name: 'Comments', exact: true });
    const a0 = await btn.getAttribute('data-active'); await realTapEl(q, 'button[aria-label="Comments"]'); await sleep(1000);
    const a1 = await btn.getAttribute('data-active'); const open = (await dlg(q).count()) > 0; await shot('comments-open');
    sh('adb shell input keyevent 4'); await sleep(1200); q = await P();
    const closed = (await dlg(q).count()) === 0; const a2 = await q.getByRole('button', { name: 'Comments', exact: true }).getAttribute('data-active');
    return { verdict: open && a1 === 'true' && closed && a2 === 'false' ? 'PASS' : 'FAIL', detail: `data-active before=${a0} open=${a1} (sheet present=${open}); after Back sheetClosed=${closed} data-active=${a2}; ${resumed().slice(0, 100)}` };
  });

  // ---------- 6 thread back ----------
  await chk('6-thread-back', 'Back in a thread returns to the list, second Back closes (6928baa0)', async () => {
    let q = await need(); await closeComments(q); await hideIme();
    await realTapEl(q, 'button[aria-label="Comments"]'); await sleep(900);
    await realTapEl(q, '.m-thread-row'); await sleep(1000); const inThread = await threadOpen(q); await shot('thread-open');
    sh('adb shell input keyevent 4'); await sleep(1200); q = await P();
    const listShown = (await dlg(q).count()) > 0 && !(await threadOpen(q)) && (await q.locator('.m-thread-row').count()) > 0; await shot('thread-after-back1');
    sh('adb shell input keyevent 4'); await sleep(1200); q = await P(); const closed = (await dlg(q).count()) === 0;
    return { verdict: inThread && listShown && closed ? 'PASS' : 'FAIL', detail: `threadOpened=${inThread}; Back#1 -> sheet still open showing list=${listShown}; Back#2 -> sheet closed=${closed}; ${resumed().slice(0, 100)}` };
  });

  // ---------- 7 long press ----------
  await chk('7-long-press', 'Long-press word: native selection + Add Comment above accessory bar (75f27603)', async () => {
    let q = await need(); const out = []; let ok = true;
    const probe = async (label) => {
      q = await P(); await sleep(600);
      const sel = await q.evaluate(() => window.__g.sel()); const nonEmpty = sel[0] !== sel[1];
      const geo = await q.evaluate(() => { const s = document.querySelector('.m-addcomment'); const b = document.querySelector('.m-addcomment-btn'); const a = document.querySelector('.m-accessory'); const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right }; }; return { vis: s && s.getAttribute('data-visible'), strip: R(s), btn: R(b), acc: R(a) }; });
      const above = geo.vis === 'true' && geo.btn && geo.acc && geo.strip && Math.abs(geo.strip.b - geo.acc.t) <= 2 && geo.btn.b <= geo.acc.t + 1;
      out.push(`${label}: cmSel=${JSON.stringify(sel)} nonEmpty=${nonEmpty} addComment visible=${geo.vis} btn=${JSON.stringify(geo.btn && { t: +geo.btn.t.toFixed(1), b: +geo.btn.b.toFixed(1) })} accessoryTop=${geo.acc && geo.acc.t.toFixed(1)} stripBottom=${geo.strip && geo.strip.b.toFixed(1)} directlyAbove=${!!above} ime[${IME()}]`);
      return nonEmpty && above;
    };
    const lp = async (word) => {
      const wr = await q.evaluate(async (w) => window.__g.wordRect(w), word); if (!wr) throw new Error('no word rect');
      const [x, y] = [Math.round(MAP.x0 + ((wr.l + wr.r) / 2) * MAP.dpr), Math.round(MAP.y0 + ((wr.t + wr.b) / 2) * MAP.dpr)];
      sh(`adb shell input swipe ${x} ${y} ${x} ${y} 800`); await sleep(1200); return wr;
    };
    // keyboard shown
    await closeComments(q); await hideIme(); await showImeViaEditor(q); q = await P(); await q.evaluate(() => window.__g.select(0)); await sleep(300);
    let wr = await lp('line'); const okA = await probe('kb SHOWN'); await shot('longpress-kb-shown'); ok = ok && okA;
    // drag the right handle
    try {
      const rr = await q.evaluate(() => { const s = getSelection(); if (!s.rangeCount) return null; const r = s.getRangeAt(0).getBoundingClientRect(); return { r: r.right, b: r.bottom, l: r.left, t: r.top }; });
      if (rr) {
        const before = await q.evaluate(() => window.__g.sel()); const x = MAP.x0 + rr.r * MAP.dpr, y = MAP.y0 + (rr.b + 9) * MAP.dpr;
        sh(`adb shell input swipe ${Math.round(x)} ${Math.round(y)} ${Math.round(x + 90 * MAP.dpr)} ${Math.round(y)} 700`); await sleep(1000);
        const after = await q.evaluate(() => window.__g.sel()); await shot('longpress-handle-drag');
        out.push(`handle drag from css(${rr.r.toFixed(0)},${(rr.b + 9).toFixed(0)}) +90px: sel ${JSON.stringify(before)} -> ${JSON.stringify(after)} extended=${Math.abs(after[1] - after[0]) > Math.abs(before[1] - before[0])}`);
      } else out.push('handle drag: no DOM selection range');
    } catch (e) { out.push('handle drag error ' + String(e.message).split('\n')[0]); }
    // keyboard hidden
    q = await P(); await q.evaluate(() => window.__g.select(0)); await hideIme(); await q.evaluate(() => { document.activeElement && document.activeElement.blur(); }); await sleep(600);
    wr = await lp('Paragraph'); const okB = await probe('kb HIDDEN'); await shot('longpress-kb-hidden'); ok = ok && okB;
    await q.evaluate(() => window.__g.select(0));
    return { verdict: ok ? 'PASS' : 'FAIL', detail: out.join(' ; ') };
  });

  // ---------- 8 M-40 drawer / Back ----------
  await chk('8-drawer-back', 'M-40 menu drawer drill-down, Back, unsaved prompt, leave app (97662f36)', async () => {
    let q = await need(); const out = []; let ok = true; await closeComments(q); await hideIme();
    const title = () => q.locator('.m-menu-drawer-head h2').first().innerText().catch(() => '(none)');
    await realTapEl(q, 'button[aria-label="Menu"]'); await sleep(1000); const d1 = (await q.getByRole('dialog', { name: 'Menu' }).count()) > 0; const t0 = await title();
    await domTap(q.locator('[data-menu="file"], [role="menuitem"][aria-haspopup="menu"]').filter({ hasText: /^File/ })); await sleep(700); const t1 = await title(); await shot('drawer-file');
    sh('adb shell input keyevent 4'); await sleep(900); q = await P(); const t2 = await title(); const still = (await q.getByRole('dialog', { name: 'Menu' }).count()) > 0;
    sh('adb shell input keyevent 4'); await sleep(900); q = await P(); const gone = (await q.getByRole('dialog', { name: 'Menu' }).count()) === 0; const res1 = resumed();
    const dok = d1 && t0 === 'Menu' && t1 === 'File' && t2 === 'Menu' && still && gone && /gonq/.test(res1); ok = ok && dok;
    out.push(`drawer: open=${d1} title ${t0} -> ${t1}; Back#1 -> title=${t2} drawerOpen=${still}; Back#2 -> drawerClosed=${gone}; app resumed: ${res1.slice(0, 110)} => ${dok ? 'ok' : 'NOT ok'}`);
    // unsaved prompt
    const dirty = await q.locator('[aria-label="unsaved changes"]').count();
    sh('adb shell input keyevent 4'); await sleep(1500); q = await P();
    const prompt = await q.getByText(/^Save changes to/).count(); await shot('unsaved-prompt');
    if (prompt) { await domTap(q.getByRole('button', { name: 'Cancel', exact: true })); await sleep(1000); }
    const res2 = resumed(); const stay = /gonq/.test(res2); const pok = dirty > 0 && prompt > 0 && stay; ok = ok && pok;
    out.push(`editor Back: unsaved tabs marker=${dirty} promptShown=${prompt} after Cancel app resumed=${stay} [${res2.slice(0, 110)}] => ${pok ? 'ok' : 'NOT ok'}`);
    // discard then leave (prompt -> Don't save -> leaves)
    sh('adb shell input keyevent 4'); await sleep(1500); q = await P(); const p2 = await q.getByText(/^Save changes to/).count();
    if (p2) { await domTap(q.getByRole('button', { name: /Don.t save/ })); await sleep(2500); }
    const res3 = resumed(); out.push(`Back -> prompt=${p2} -> Don't save: app resumed=${/gonq/.test(res3)} [${res3.slice(0, 110)}]`);
    return { verdict: ok ? 'PASS' : 'FAIL', detail: out.join(' ; ') };
  });
  await chk('8b-leave-clean', 'M-40: no unsaved tabs, Back leaves the app (97662f36 crit 6)', async () => {
    sh(`adb shell am force-stop ${PKG}`); await launch(); await sleep(1500);
    const before = resumed(); sh('adb shell input keyevent 4'); await sleep(2500); const after = resumed();
    const left = !/gonq/.test(after); sh('adb shell input keyevent 3');
    return { verdict: left && /gonq/.test(before) ? 'PASS' : 'FAIL', detail: `Documents home, no tabs: before [${before.slice(0, 110)}] after Back [${after.slice(0, 110)}] left app=${left}` };
  });
  // ---------- 1 launcher icon ----------
  await chk('1-launcher-icon', 'Launcher icon (a50176a8 crit 2 / 266b9882 crit 5)', async () => {
    const info = []; const W = sh('adb shell wm size').match(/(\d+)x(\d+)/g).pop().split('x').map(Number);
    const findIcon = async (tag) => {
      sh('adb shell input keyevent 3'); await sleep(1500);
      sh(`adb shell input swipe ${W[0] >> 1} ${Math.round(W[1] * 0.88)} ${W[0] >> 1} ${Math.round(W[1] * 0.2)} 350`); await sleep(1800);
      for (let i = 0; i < 10; i++) {
        const nodes = uiNodes(); const n = nodes.find((x) => /^gonq$/i.test(x.text) || /^gonq$/i.test(x.desc));
        if (n) { fs.writeFileSync(`${EV}/ui-launcher-${tag}.xml`, fs.readFileSync(`${EV}/ui.xml`)); await shot(`launcher-drawer-${tag}`); return n; }
        sh(`adb shell input swipe ${W[0] >> 1} ${Math.round(W[1] * 0.75)} ${W[0] >> 1} ${Math.round(W[1] * 0.3)} 350`); await sleep(900);
      }
      await shot(`launcher-drawer-${tag}-notfound`); return null;
    };
    const n1 = await findIcon('light');
    info.push(n1 ? `light: node bounds ${n1.bounds} (cell ${'' + n1.h}px high, centre ${n1.x},${n1.y})` : 'light: Gonq icon NOT found in drawer');
    sh('adb shell cmd uimode night yes'); await sleep(2500);
    const n2 = await findIcon('dark'); info.push(n2 ? `dark: bounds ${n2.bounds}` : 'dark: not found');
    sh('adb shell cmd uimode night no'); await sleep(1500);
    // mask variants the system image offers
    let ov = ''; try { ov = sh("adb shell cmd overlay list --user 0 | grep -i -E 'icon|shape' || true"); } catch (e) {}
    info.push(`overlays: ${ov.replace(/\n/g, ' ').slice(0, 300) || 'none'}`);
    const shapes = !process.env.EMU_SHAPES ? [] : [...ov.matchAll(/(com\.android\.theme\.icon\.(\w+))/g)].map((m) => [m[1], m[2]]).filter(([, s]) => /circle|squircle|roundedrect|teardrop/.test(s)).slice(0, 4);
    for (const [pkgo, s] of shapes) {
      try {
        sh(`adb shell cmd overlay enable-exclusive --user 0 --category ${pkgo}`); await sleep(2500);
        sh('adb shell am force-stop com.google.android.apps.nexuslauncher || true'); sh('adb shell am force-stop com.android.launcher3 || true'); await sleep(2000);
        const n = await findIcon(`mask-${s}`); info.push(`mask ${s}: ${n ? 'icon at ' + n.bounds : 'not found'}`);
      } catch (e) { info.push(`mask ${s}: failed ${String(e.message).split('\n')[0].slice(0, 80)}`); }
    }
    for (const [pkgo] of shapes) { try { sh(`adb shell cmd overlay disable --user 0 ${pkgo}`); } catch (e) {} }
    // resource analysis of the installed APK: adaptive icon safe zone
    try {
      fs.writeFileSync('/tmp/icon_an.py', `
import sys, zipfile, io, json, math
try:
    from PIL import Image
except Exception:
    import subprocess, importlib; subprocess.check_call([sys.executable,'-m','pip','install','-q','--target','/tmp/pil','pillow']); sys.path.insert(0,'/tmp/pil'); importlib.invalidate_caches(); from PIL import Image
z = zipfile.ZipFile(sys.argv[1]); out = sys.argv[2]
names = [n for n in z.namelist() if 'ic_launcher' in n or 'anydpi' in n]
print('entries:', names[:40])
def load(n): return Image.open(io.BytesIO(z.read(n))).convert('RGBA')
fg = [n for n in names if n.endswith('.png') and 'foreground' in n]
bg = [n for n in names if n.endswith('.png') and 'background' in n]
rnd = [n for n in names if n.endswith('.png') and 'round' in n]
legacy = [n for n in names if n.endswith('.png') and 'foreground' not in n and 'background' not in n and 'round' not in n]
print('fg', fg, 'bg', bg, 'round', rnd, 'legacy', legacy)
def pick(l):
    return sorted(l, key=lambda n: load(n).size[0])[-1] if l else None
f = pick(fg)
if f:
    im = load(f); W, H = im.size; a = im.split()[3]; bb = a.point(lambda v: 255 if v > 16 else 0).getbbox()
    px = im.load(); mx = 0.0; cnt = 0; out_safe = 0; out_vis = 0
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            if px[x, y][3] > 16:
                r = math.hypot(x - W / 2, y - H / 2) / W; cnt += 1
                mx = max(mx, r)
                if r > 33 / 108: out_safe += 1
                if r > 36 / 108: out_vis += 1
    print(f'FOREGROUND {f} size {W}x{H} opaque bbox {bb} max_radius/W {mx:.4f} (safe zone 0.3056, visible circle 0.3333) opaque px outside safe zone {out_safe}/{cnt}, outside visible circle {out_vis}/{cnt}')
    b = pick(bg)
    base = load(b).resize((W, H)) if b else Image.new('RGBA', (W, H), (255, 255, 255, 255))
    comp = Image.alpha_composite(base, im); comp.save(out + '/icon-composite-full.png')
    for shape in ['circle', 'squircle', 'roundedrect']:
        m = Image.new('L', (W, H), 0); mp = m.load(); R = 36 / 108 * W
        for y in range(H):
            for x in range(W):
                dx = abs(x - W / 2) / R; dy = abs(y - H / 2) / R
                inside = (dx ** 2 + dy ** 2 <= 1) if shape == 'circle' else (dx ** 4 + dy ** 4 <= 1) if shape == 'squircle' else (dx <= 1 and dy <= 1 and (min(1, max(0, (dx - 0.7) / 0.3)) ** 2 + min(1, max(0, (dy - 0.7) / 0.3)) ** 2 <= 1))
                if inside: mp[x, y] = 255
        c = Image.new('RGBA', (W, H), (128, 128, 128, 255)); c.paste(comp, (0, 0), m); c.crop((int(W/2-R), int(H/2-R), int(W/2+R), int(H/2+R))).save(f'{out}/icon-mask-{shape}.png')
else:
    for n in legacy[:3]:
        im = load(n); print('LEGACY', n, im.size, im.split()[3].getbbox())
`);
      const o = sh(`python3 /tmp/icon_an.py "${process.env.APK_PATH}" ${EV} 2>&1 | tail -12`);
      info.push('apk: ' + o.replace(/\n/g, ' ; ').slice(0, 900));
    } catch (e) { info.push('apk analysis failed: ' + String(e.message).split('\n')[0].slice(0, 150)); }
    return { verdict: n1 ? 'REVIEW (see screenshots)' : 'UNVERIFIABLE (harness)', detail: info.join(' || ') };
  });

  saveV();
  console.log('[batch] DONE'); console.log(JSON.stringify(VERD.map((v) => [v.id, v.verdict]), null, 0)); process.exit(0);
})().catch((e) => { console.error('FATAL', e); saveV(); process.exit(0); });
