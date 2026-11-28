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
    ok: () => !!find(), focus: () => find().focus(),
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

  // ===================== DIAG: marker shift cause (S1..S5) =====================
  const DIAG = []; const saveD = () => fs.writeFileSync(`${EV}/diag.json`, JSON.stringify({ info: global.info, MAP, fixErr, DIAG }, null, 1));
  const DSNAP = (i) => {
    const m = document.querySelectorAll('.cm-thread-marker')[i]; const ln = m.closest('.cm-line');
    const rr = (n) => { let r; if (n.nodeType === 3) { const g = document.createRange(); g.selectNodeContents(n); r = g.getBoundingClientRect(); } else r = n.getBoundingClientRect(); return { l: +r.left.toFixed(2), w: +r.width.toFixed(2) }; };
    const dn = (n) => n.nodeType === 3 ? '#text' : n.tagName.toLowerCase() + (n.className ? '.' + String(n.className).replace(/\s+/g, '.').slice(0, 50) : '');
    const pre = []; let after = null;
    const walk = (par, depth) => { for (const c of par.childNodes) { if (c === m) return true; if (c.contains(m)) { pre.push({ n: 'WRAP:' + dn(c), t: '', ...rr(c) }); if (walk(c, depth + 1)) return true; } else pre.push({ n: dn(c), t: (c.textContent || '').slice(0, 20), ...rr(c) }); } return false; };
    walk(ln, 0);
    const tw = document.createTreeWalker(ln, NodeFilter.SHOW_TEXT); let nn; while ((nn = tw.nextNode())) { if (nn.textContent.trim() && (m.compareDocumentPosition(nn) & Node.DOCUMENT_POSITION_FOLLOWING)) { after = { t: nn.textContent.slice(0, 20), ...rr(nn) }; break; } }
    const cs = getComputedStyle(m); const mr = m.getBoundingClientRect(); const ae = document.activeElement; const ed = document.querySelector('.cm-editor');
    const first = pre.length ? pre[0] : null;
    return {
      marker: { l: +mr.left.toFixed(2), w: +mr.width.toFixed(2) }, line: +ln.getBoundingClientRect().left.toFixed(2), pre, after,
      cs: { display: cs.display, transform: cs.transform, fontSize: cs.fontSize, padL: cs.paddingLeft, padR: cs.paddingRight, marL: cs.marginLeft, marR: cs.marginRight, textIndent: cs.textIndent, letterSpacing: cs.letterSpacing, width: cs.width },
      hover: m.matches(':hover'), active: ae ? (ae.tagName.toLowerCase() + '.' + String(ae.className).slice(0, 30)) : null, activeInEditor: !!(ae && ae.closest && ae.closest('.cm-editor')), cmFocused: !!(ed && ed.classList.contains('cm-focused')),
      sel: window.__g.sel(), vv: { w: visualViewport.width, h: visualViewport.height, ol: visualViewport.offsetLeft, ot: visualViewport.offsetTop }, innerH: innerHeight, scrollLeft: (document.querySelector('.cm-scroller') || {}).scrollLeft,
      sameLine: window.__ln0 ? window.__ln0 === ln : null, sameMarker: window.__m0 ? window.__m0 === m : null, html: ln.outerHTML.slice(0, 600),
    };
  };
  const OBS = (i) => {
    const m = document.querySelectorAll('.cm-thread-marker')[i]; window.__m0 = m; window.__ln0 = m.closest('.cm-line');
    window.__mut = []; window.__ev = []; window.__trace = []; window.__t0 = performance.now(); const T = () => +(performance.now() - window.__t0).toFixed(0);
    if (window.__mo) window.__mo.disconnect();
    const dn = (n) => n.nodeType === 3 ? '#t' : n.tagName + '.' + String(n.className).slice(0, 30);
    window.__mo = new MutationObserver((rs) => { for (const r of rs) { if (window.__mut.length > 80) return; window.__mut.push({ t: T(), ty: r.type, tg: dn(r.target), inLine: window.__ln0.contains(r.target) || r.target === window.__ln0, a: r.attributeName, old: (r.oldValue || '').slice(0, 60), add: [...r.addedNodes].map((x) => dn(x) + ':' + (x.textContent || '').slice(0, 12)).join('|'), rem: [...r.removedNodes].map((x) => dn(x) + ':' + (x.textContent || '').slice(0, 12)).join('|') }); } });
    window.__mo.observe(document.querySelector('.cm-content'), { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true });
    const lg = (n) => (e) => window.__ev.push({ t: T(), e: n, tg: e.target && e.target.tagName ? e.target.tagName.toLowerCase() + '.' + String(e.target.className).slice(0, 25) : String(e.target) });
    if (window.__lis) for (const [t, f, o] of window.__lis) o.removeEventListener(t, f, true);
    window.__lis = [];
    for (const t of ['touchstart', 'pointerdown', 'mouseover', 'mousedown', 'focusin', 'mouseup', 'click', 'touchend', 'pointerup']) { const f = lg(t); document.addEventListener(t, f, true); window.__lis.push([t, f, document]); }
    const f2 = lg('selectionchange'); document.addEventListener('selectionchange', f2); window.__lis.push(['selectionchange', f2, document]);
    const f3 = lg('vv-resize'); visualViewport.addEventListener('resize', f3); window.__lis.push(['resize', f3, visualViewport]);
    let last = null; window.__iv && clearInterval(window.__iv);
    window.__iv = setInterval(() => { const mm = document.querySelectorAll('.cm-thread-marker')[i]; const l = mm ? +mm.getBoundingClientRect().left.toFixed(2) : null; if (l !== last) { window.__trace.push([T(), l]); last = l; } }, 15);
  };
  const OBSOUT = () => { clearInterval(window.__iv); window.__mo && window.__mo.disconnect(); return { mut: window.__mut, ev: window.__ev, trace: window.__trace }; };
  const KEYS = ['Numbered', 'Bullet', 'Task', 'Paragraph'];
  const WORD = { Numbered: 'alpha', Bullet: 'bravo', Task: 'charlie', Paragraph: 'delta' };
  const prep = async (key) => {
    let q = await P(); await closeComments(q); await hideIme(); q = await P();
    await q.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); window.__g.select(0); const a2 = document.activeElement; if (a2 && a2.blur) a2.blur(); });
    await sleep(500); return q;
  };
  async function scn(sid, key, setup, action) {
    const rec = { sid, key };
    try {
      let q = await prep(key);
      const mi = await markerIdx(q, key); if (mi < 0) throw new Error('marker not found');
      if (setup) await setup(q, key, mi, rec);
      q = await P();
      await q.evaluate((i) => document.querySelectorAll('.cm-thread-marker')[i].scrollIntoView({ block: 'center' }), mi); await sleep(700);
      rec.ime0 = IME();
      rec.s0 = await q.evaluate(DSNAP, mi);
      await q.evaluate(OBS, mi);
      await action(q, key, mi, rec);
      await sleep(300); rec.ime300 = IME(); rec.s300 = await q.evaluate(DSNAP, mi).catch((e) => ({ err: String(e.message).slice(0, 100) }));
      await sleep(700); rec.ime1000 = IME(); rec.s1000 = await q.evaluate(DSNAP, mi).catch((e) => ({ err: String(e.message).slice(0, 100) }));
      Object.assign(rec, await q.evaluate(OBSOUT));
      const d = (s) => (s && s.marker ? +(s.marker.l - rec.s0.marker.l).toFixed(2) : null);
      const dp = (s) => (s && s.pre ? s.pre.map((n, j) => (rec.s0.pre[j] ? +(n.l - rec.s0.pre[j].l).toFixed(2) : null)) : null);
      rec.d300 = d(rec.s300); rec.d1000 = d(rec.s1000); rec.dpre300 = dp(rec.s300); rec.dpre1000 = dp(rec.s1000);
      rec.dw300 = rec.s300.marker ? +(rec.s300.marker.w - rec.s0.marker.w).toFixed(2) : null;
      rec.dafter300 = rec.s300.after && rec.s0.after ? +(rec.s300.after.l - rec.s0.after.l).toFixed(2) : null;
      await shot(`diag-${sid}-${key}`);
    } catch (e) { rec.error = String(e.message || e).split('\n')[0].slice(0, 300); }
    DIAG.push(rec); saveD();
    note(`DIAG ${sid} ${key}: d300=${rec.d300} d1000=${rec.d1000} dpre300=${JSON.stringify(rec.dpre300)} dw=${rec.dw300} hover0=${rec.s0 && rec.s0.hover} hover300=${rec.s300 && rec.s300.hover} focus300=${rec.s300 && rec.s300.cmFocused} ime300=[${rec.ime300}] sameLine=${rec.s300 && rec.s300.sameLine} sameMarker=${rec.s300 && rec.s300.sameMarker} mut=${(rec.mut || []).length} err=${rec.error || ''}`);
  }
  const tapMarker = async (q, key, mi, rec) => { rec.tap = tapCss(...(await (async () => { const r = await rect(q, '.cm-thread-marker', mi); return [(r.l + r.r) / 2, (r.t + r.b) / 2]; })())); await q.evaluate(() => window.__ev.push({ t: +(performance.now() - window.__t0).toFixed(0), e: 'ADB-TAP-SENT' })); };
  const tapElsewhere = async (q, key, mi, rec) => { const li = await q.evaluate(() => [...document.querySelectorAll('.cm-line')].findIndex((l) => l.innerText.includes('Trailing'))); await realTapEl(q, '.cm-line', li); await sleep(1800); rec.imeAfterElsewhere = IME(); rec.focusElsewhere = await q.evaluate(() => ({ cm: !!document.querySelector('.cm-editor.cm-focused'), vvH: visualViewport.height })); await sleep(1000); };
  note('DIAG start');
  if (!MAP || fixErr) { note('DIAG cannot run: ' + fixErr); saveD(); process.exit(0); }
  for (const k of KEYS) await scn('S1-baseline', k, null, tapMarker);
  for (const k of KEYS) await scn('S2-focus-first', k, tapElsewhere, tapMarker);
  await hideIme(); saveD();
  console.log('[diag] DONE'); process.exit(0);
})().catch((e) => { console.error('FATAL', e); try { saveD(); } catch (x) {} process.exit(0); });
