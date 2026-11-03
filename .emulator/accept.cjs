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
// ---- main ---------------------------------------------------------------------------------------------------------
(async () => {
  [device] = await _android.devices();
  global.info = { model: sh('adb shell getprop ro.product.model'), android: sh('adb shell getprop ro.build.version.release'), repo: REPO };
  sh('adb shell settings put secure show_ime_with_hard_kb 1');           // keep Gboard up although the emulator has a hardware keyboard
  sh('adb shell cmd uimode night no');
  let p; let folderOpened = false;

  await step('01-install', 'Fresh install of the RC APK, versionCode higher than the skeleton', async () => {
    const apkVc = (f) => {                                                    // versionCode from the APK itself: aapt dump badging, fallback apkanalyzer
      let aapt = ''; try { aapt = sh('ls -d "${ANDROID_HOME:-$ANDROID_SDK_ROOT}"/build-tools/*/aapt | sort -V | tail -1', { shell: '/bin/bash' }); } catch (e) {}
      if (aapt) { try { const m = sh(`"${aapt}" dump badging "${f}"`).match(/versionCode='(\d+)'/); if (m) return +m[1]; } catch (e) {} }
      let az = ''; try { az = sh('ls -d "${ANDROID_HOME:-$ANDROID_SDK_ROOT}"/cmdline-tools/*/bin/apkanalyzer | tail -1', { shell: '/bin/bash' }); } catch (e) {}
      if (az) { try { return +sh(`"${az}" manifest version-code "${f}"`); } catch (e) {} }
      return null;
    };
    const vc = () => (sh(`adb shell dumpsys package ${PKG}`).match(/versionCode=(\d+)/) || [])[1];
    const rcApk = apkVc(process.env.APK_PATH), skelApk = process.env.SKELETON_APK ? apkVc(process.env.SKELETON_APK) : null;
    let skel = null;
    if (process.env.SKELETON_APK) { sh(`adb uninstall ${PKG} || true`); sh(`adb install -r "${process.env.SKELETON_APK}"`); skel = +vc(); }
    sh(`adb uninstall ${PKG} || true`);                                     // each CI build has its own debug key
    if (sh(`adb shell pm list packages ${PKG} || true`)) skip('uninstall failed');
    sh(`adb install "${process.env.APK_PATH}"`);
    const rc = +vc();
    p = await launch(); await shot('fresh-launch');
    const rcN = rcApk ?? rc, skN = skelApk ?? skel;                           // numeric comparison, never string
    if (skN === null || skN === undefined || Number.isNaN(skN)) return { ok: false, detail: `rc versionCode=${rcN} (installed ${rc}); skeleton versionCode unknown: SKELETON_APK not set or unreadable (the workflow must download run 41131818493 artifact gonq-android-debug-signed-* and export SKELETON_APK)` };
    return { ok: rcN > skN, detail: `rc versionCode=${rcN} (apk ${rcApk}, installed ${rc}) skeleton versionCode=${skN} (apk ${skelApk}, installed ${skel}); rc > skeleton = ${rcN > skN}` };
  });

  // ----- GitHub: sign in (the one human touchpoint), read-only use -----
  if (SIGNIN_FREE) console.log('[accept] ONLY excludes 02/03: sign-in gate skipped, no GitHub comments posted');
  await step('02-signin-approved', 'Sign in from the idle Start screen, app backgrounded during approval, to approved', async () => {
    p = await launch();
    await p.getByText('Sign in to GitHub').click();
    await p.getByRole('button', { name: /^Start$/ }).waitFor({ timeout: 60000 });          // idle Start screen
    await shot('idle-start');
    await comment(`READY FOR CODE (M-34 acceptance run ${process.env.GITHUB_RUN_ID}): app installed and on the sign-in Start screen. Reply with a commit comment "GO" to request the device code; waits up to ${process.env.GO_WAIT_MIN || 60} min.`);
    if (!(await waitComment('GO', Number(process.env.GO_WAIT_MIN || 60)))) return { ok: false, detail: 'no GO within the wait' };
    p = await cur();
    await p.getByRole('button', { name: /^Start$/ }).click();
    const code = (await p.getByLabel('User code').textContent({ timeout: 60000 })).trim();
    await shot('code');
    await comment(`DEVICE CODE ${code} — approve at https://github.com/login/device (M-34 run ${process.env.GITHUB_RUN_ID}; waits up to 14 min)`);
    await p.getByRole('button', { name: /Open github.com\/login\/device/ }).click(); await sleep(3000);
    sh('adb shell input keyevent KEYCODE_HOME'); await sleep(2000);                          // background the app: it stays backgrounded during approval
    await shot('home-while-approving');
    await sleep(Number(process.env.BACKGROUND_SEC || 60) * 1000);                          // stay backgrounded while the owner approves
    sh(`adb shell monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`); await sleep(3000);   // resume, NOT a cold start
    p = await cur();
    const ok = await p.getByText(/Signed in as/).waitFor({ timeout: 13 * 60000 }).then(() => true, () => false);
    await shot('approved');
    if (ok) await p.getByRole('button', { name: 'Done' }).click().catch(() => {});
    return { ok, detail: ok ? await p.evaluate(() => document.body.innerText.match(/Signed in as[^\n]*/)?.[0] || '') : 'not approved in time' };
  });

  await step('03-relaunch-signedin', 'Force-stop and relaunch: still signed in', async () => {
    p = await launch(); await p.getByText('Sign in to GitHub').click();
    const ok = await p.getByText(/@\w|You are signed in/).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    await p.getByRole('button', { name: 'Done' }).click().catch(() => {});
    return { ok };
  });

  await step('04-open-repo-switch-branch', 'Open a repo with the signed-in account and switch branch (read-only)', async () => {
    if (!BR.a || !BR.b) skip('BRANCH_A and BRANCH_B not set');
    p = await cur(); await goHome(p); p = await cur();
    await signedInOpenRepo(p, null);
    await p.getByRole('button', { name: /^Branch:/ }).click();
    const lb = p.getByRole('listbox', { name: 'Branches' });
    const sheetShown = await lb.waitFor({ timeout: 15000 }).then(() => true, () => false);   // branch sheet must render before its options are read
    await lb.getByRole('option').first().waitFor({ timeout: 90000 }).catch(() => {});                    // branch list loads lazily
    const loadDone = async () => !(await p.getByText(/^Loading( more| branches)?…$/).count());
    for (let i = 0; i < 45 && !(await loadDone()); i++) await sleep(2000);
    const opts = await lb.getByRole('option').allTextContents(); await shot('branches');
    const screenTxt = await p.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n/g, ' | '));
    await p.keyboard.press('Escape');
    await switchBranch(p, BR.a); await switchBranch(p, BR.b);
    const loadingEl = p.getByText(/Loading(\.\.\.|…)/);                                                  // 'Loading...' under the branch field while the tree loads
    const treeLoaded = await loadingEl.first().waitFor({ state: 'hidden', timeout: 90000 }).then(() => true, () => false);   // up to 90 s
    const rows = await p.locator('.m-tree-row').count(); const empty = await p.getByText(/No Markdown files/).count(); await shot('after-switch-loaded');
    const still = !treeLoaded;
    const onScreen = await p.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n/g, ' | '));
    return { ok: sheetShown && opts.length > 0 && treeLoaded, detail: `${treeLoaded ? 'PASS: file tree finished loading (Loading... gone)' : 'FAIL: Loading... still on screen after 90 s'}; sheetShown=${sheetShown}; branches=${opts.map((o) => o.replace('✓', '')).join(',').slice(0, 200)}; switched ${BR.a} -> ${BR.b}; treeRows=${rows} emptyMsg=${empty} stillLoading=${still}; screen(sheet open)="${screenTxt.slice(0, 120)}" screen(after)="${onScreen.slice(0, 200)}"` };
  });

  await step('05-readonly-banner', 'Read-only banner on a branch with an open PR', async () => {
    if (!BR.pr) skip('PR_BRANCH not set');
    p = await cur();
    if (!(await p.getByRole('button', { name: /^Branch:/ }).count())) await signedInOpenRepo(p, null);
    await switchBranch(p, BR.pr); await openFirstRepoFile(p);
    const b = p.getByTestId('read-only-banner'); await b.waitFor({ timeout: 30000 });
    const t = await b.innerText(); const ce = await p.evaluate(() => document.querySelector('.cm-content')?.getAttribute('contenteditable'));
    return { ok: /Pull request #\d+ is open for this branch\. You can read this document but not change it\./.test(t) && /Open PR/.test(t) && ce === 'false', detail: `${t.replace(/\n/g, ' ')} contenteditable=${ce}` };
  });

  // ----- Local folders (M-14 outcome: Kotlin SAF plugin, folder = opaque tree handle) -----
  await step('06-local-folder', 'Local folder: Open Folder… (SAF picker), list, open a file', async () => {
    const nav = await openFolderFlow(); folderOpened = true;
    return `folder opened, one.md open; picker: ${nav}`;
  });

  await step('07-insert-image-local', 'Insert > Image into a local:// document', async () => {
    p = await cur();
    if (!folderOpened) skip('SAF picker not drivable');
    sh(`adb shell "mkdir -p /sdcard/Pictures; printf '\\x89PNG' > /sdcard/Pictures/m34.png"`);   // unconfirmed: a real PNG would be better; see NOTES
    await menu(p, 'Insert', 'Image…'); await sleep(3000); await shot('image-picker');
    uiTap(/m34\.png/); await sleep(2500); p = await cur();
    const t = await editorText(p);
    return { ok: /!\[|m34\.png/.test(t), detail: 'image picker is a native chooser; selection by uiautomator is unconfirmed' };
  });

  await step('08-save-as', 'Local: Save as into the opened folder', async () => {
    if (!folderOpened) skip('SAF picker not drivable');
    p = await ensureDoc(); await focusEditorEnd(p); await typeIme(' edited');
    await menu(p, 'File', /^Save As/);
    const s = p.getByRole('dialog', { name: 'Save as' }); await s.waitFor({ timeout: T });
    await s.getByLabel('File name').fill(`saved-${STAMP}.md`); await shot('save-as');
    await s.getByRole('button', { name: 'Save', exact: true }).click();
    await s.waitFor({ state: 'detached', timeout: 30000 });
    const exists = sh(`adb shell ls ${DIR}`).includes(`saved-${STAMP}.md`);
    return { ok: exists, detail: `fileOnDevice=${exists}` };
  });

  await step('09-reopen-tab-after-back', 'Re-open a tab after Back (two in-app documents; open tab re-opened from Documents)', async () => {
    p = await newDoc('First doc alpha'); p = await newDoc('Second doc beta');   // second doc opens in a new tab
    const tabs = await p.getByRole('tab').count(); await shot('two-tabs');
    await domTap(p.getByRole('tab').first()); await sleep(500);                     // switching tabs in the editor's tab strip (before Back) works: record it
    const switched = /First doc alpha/.test(await editorText(await cur()));
    p = await cur(); await goHome(p); p = await cur(); await shot('documents-after-back');
    // Evidence of the last run: Documents shows 'No recent documents.' (untitled, unsaved in-app docs are never recents) and the open tabs live only in the editor's tab strip;
    // EditorBridge pushes the editor again only when the active tab CHANGES, and DocumentsHome has no tab list. So the only way back to an open tab is a recents row, if the app lists one.
    const row = p.locator('li button[title]').first();
    const rows = await p.locator('li button[title]').count();
    if (rows) await row.click({ timeout: T });
    p = await cur();
    const shown = rows ? await p.locator('.cm-content').waitFor({ timeout: 15000 }).then(() => true, () => false) : false;
    return { ok: shown, detail: `tabs=${tabs} tabSwitchBeforeBack=${switched} recentsRows=${rows} editorShown=${shown}${rows ? '' : ' (no Documents-screen control re-opens an open tab: recents empty for unsaved in-app docs)'}` };
  });

  // ----- Android behaviour -----
  await step('10-editor-gboard', 'Editor: type with Gboard incl. autocorrect', async () => {
    p = await ensureDoc(); await focusEditorEnd(p); await p.keyboard.press('Enter');
    await shot('keyboard-up');
    const kb = sh('adb shell dumpsys input_method | grep -m1 mInputShown || true');
    await typeIme('teh quick brwn fox '); await sleep(800);
    const t = await editorText(p);
    // adb input text sends key events (not an IME commit), so Gboard may or may not autocorrect; the result is recorded either way
    return { ok: /quick/.test(t) && /mInputShown=true/.test(kb), detail: `${kb} autocorrect=${/\bthe quick\b/.test(t) ? 'corrected' : 'not corrected (see NOTES: unconfirmed)'}` };
  });

  await step('11-accessory-toolbar', 'Editor: accessory toolbar (Bold, Undo, Redo)', async () => {
    p = await ensureDoc(); await focusEditorEnd(p);
    const tb = p.getByRole('toolbar', { name: 'Editing' }); await tb.waitFor({ timeout: T });
    const before = await editorText(p);
    await tb.getByRole('button', { name: /^Bold/ }).click(); await typeIme('bolded'); const afterBold = await editorText(p);
    await tb.getByRole('button', { name: 'Undo' }).click(); await tb.getByRole('button', { name: 'Redo' }).click();
    await shot('toolbar');
    return { ok: /\*\*/.test(afterBold) && afterBold !== before, detail: `bold markers=${/\*\*/.test(afterBold)}` };
  });

  await step('12-menus', 'Editor: long-press menu and ⋯ menu (no Connect to Server)', async () => {
    p = await ensureDoc();
    await longPress(p, '.cm-content .cm-line');                                   // EditorSheet: dialog "Editor" > menu "Editor"
    const sheet = p.getByRole('menu', { name: 'Editor', exact: true }); const lp = await sheet.isVisible().catch(() => false); await shot('long-press');
    const items = lp ? await sheet.getByRole('menuitem').allTextContents() : [];
    await closeSheets(p);
    await domTap(p.getByRole('button', { name: 'More', exact: true })); await sleep(500);
    const menus = await p.getByRole('menu').evaluateAll((l) => l.map((e) => e.getAttribute('aria-label')));
    const connect = await p.getByRole('menuitem', { name: /Connect to Server/ }).count(); await shot('overflow-menu');
    await closeSheets(p);
    return { ok: lp && connect === 0 && menus.length >= 4, detail: `longPress=${lp} editorItems=${items.join('|')} menus=${menus.join('|')} connectToServer=${connect}` };
  });

  await step('13-openpr-back-nav', 'Back navigation in the Open PR flow (open the screen read-only, Back; no PR submitted) and System Back elsewhere', async () => {
    if (!BR.pr) skip('PR_BRANCH not set');
    p = await cur(); await goHome(p); p = await cur();
    await signedInOpenRepo(p, BR.pr); await openFirstRepoFile(p);
    await menu(p, 'File', 'Open PR…');
    await p.getByRole('heading', { name: 'Open pull request' }).or(p.getByText('Open pull request')).first().waitFor({ timeout: 30000 }); await shot('open-pr-screen');
    await back(); p = await cur();                                                       // system Back leaves the flow
    const left = (await p.getByText('Open pull request').count()) === 0;
    await shot('after-system-back');
    // unconfirmed: the screen's wording when no session branch exists, and whether the in-screen Cancel/Back is needed to leave
    if (!left) { await p.getByRole('button', { name: /^(Cancel|Back)$/ }).first().click().catch(() => {}); }
    const toHome = []; for (let i = 0; i < 3; i++) { await goHome(p); p = await cur(); toHome.push(await p.getByText('Recent documents').count()); }   // in-app Back to Documents (the Back KEY would close the app: M-35, see 19-system-back-key)
    return { ok: left, detail: `system Back leaves Open PR=${left}; Recent-documents visible after further Backs=${toHome.join(',')}; nothing submitted` };
  });

  await step('14-open-link-native', 'Opening links natively (tap a link; leaves the app to the browser)', async () => {
    // livePreview.ts: links are `.cm-link[data-href]` marks (shown as a link only while the caret is outside it) and open ONLY on Ctrl/Cmd+click (linkClicks); a plain tap just
    // puts the caret in the link (the last run's screenshot: raw '[example](...)' shown, app still focused). The opener allow-list (capabilities/mobile.json) is
    // https://github.com/crashtest00/gonq, https://github.com/login/device and https://github.com/*/pull/*, so https://example.com would be refused: use the repo URL.
    p = await newDoc('See [gonq](https://github.com/crashtest00/gonq) here.');
    const link = p.locator('.cm-content .cm-link'); await link.first().waitFor({ timeout: T });
    await link.first().evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })));   // touch has no Ctrl key: unconfirmed that a real tap can ever open it
    await sleep(3000); const f = focusPkg(); await shot('after-link');
    const left = !f.includes(PKG); sh('adb shell input keyevent KEYCODE_BACK'); await sleep(1500);
    if (!(await device.webView({ pkg: PKG }, { timeout: 20000 }).then(() => true, () => false))) sh(`adb shell monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
    return { ok: left, detail: f };
  });

  await step('15-invalid-range-caret-comment', 'Invalid-range selection falls back to a caret comment', async () => {
    p = await newDoc('Heading line\n\nBody one\n\nBody two');
    // unconfirmed trigger: the validator's rule was not read. Select from the first line across several lines (heading to body) and add a comment.
    await p.locator('.cm-line').first().click();
    await p.keyboard.down('Shift'); for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowDown'); await p.keyboard.up('Shift');
    // Add Comment has only a context-menu placement (no menu), so it is NOT under ⋯ > Edit. Start it from the top-bar Comments button (aria-label "Comments") > sheet "Comments" > "Add comment".
    await domTap(p.getByRole('button', { name: 'Comments', exact: true }));
    await domTap(p.getByRole('dialog', { name: 'Comments' }).getByRole('button', { name: 'Add comment', exact: true }));
    const draft = p.getByRole('textbox', { name: 'Comment', exact: true }); await draft.waitFor({ timeout: T });
    const quote = await p.locator('.m-thread blockquote').count(); await shot('caret-draft');
    await domTap(p.getByRole('button', { name: 'Cancel', exact: true }));
    const cb = p.getByRole('button', { name: 'Comments', exact: true }); if ((await cb.getAttribute('aria-expanded')) === 'true') await domTap(cb);   // close the docked sheet
    return { ok: quote === 0, detail: `draft opened; anchor quote shown=${quote} (0 = caret comment); trigger unconfirmed` };
  });

  // ----- Settings, theme -----
  await step('16-theme', 'Theme under ⋯ > View > Theme (Light/Dark/Auto), no Settings theme row', async () => {
    p = await ensureDoc();
    await menu(p, 'View', /Dark/, { role: 'menuitemradio' }); await sleep(800);
    const dark = await p.evaluate(() => document.documentElement.className); await shot('theme-dark');
    await menu(p, 'View', /Light/, { role: 'menuitemradio' }); await sleep(800);
    const light = await p.evaluate(() => document.documentElement.className);
    return { ok: /dark/.test(dark) && !/dark/.test(light), detail: `dark="${dark}" light="${light}"` };
  });

  await step('17-settings-author', 'Settings: author name saved; Settings has no theme row', async () => {
    p = await ensureDoc(); await menu(p, 'Edit', 'Settings…');
    const f = p.getByRole('form', { name: 'Settings' }); await f.waitFor({ timeout: T });
    const themeRow = await f.getByText(/Theme/).count();
    await f.getByLabel('Author name').fill(`M34 ${STAMP}`); await shot('settings'); await domTap(f.getByRole('button', { name: 'Save', exact: true }));   // Save pops back to the editor
    await menu(p, 'Edit', 'Settings…'); const f2 = p.getByRole('form', { name: 'Settings' }); await f2.waitFor({ timeout: T }); await sleep(800);   // author name loads async
    const v = await p.getByLabel('Author name').inputValue(); await domTap(p.getByRole('button', { name: 'Cancel', exact: true }));
    return { ok: v === `M34 ${STAMP}` && themeRow === 0, detail: `author=${v} themeRows=${themeRow}` };
  });

  await step('18-signout', 'Settings: sign out, relaunch shows signed out', async () => {
    p = await cur(); await menu(p, 'Edit', 'Settings…');
    await p.getByRole('button', { name: 'Sign Out' }).click(); await p.getByRole('button', { name: 'Sign In' }).waitFor({ timeout: T }); await shot('signed-out');
    await p.getByRole('button', { name: 'Cancel' }).click();
    p = await launch(); await p.getByText('Sign in to GitHub').click();
    return { ok: await p.getByRole('button', { name: /^Start$/ }).waitFor({ timeout: 30000 }).then(() => true, () => false) };
  });

  // M-35 (informational): what the Android Back KEY does. Expected FAIL on the current RC (no Back handler: Back closes the app from any screen), PASS after M-35.
  await step('19-system-back-key', 'M-35 (informational): Android Back key: leaves from Documents; steps back from an open editor', async () => {
    const inApp = () => focusPkg().includes(PKG);
    p = await launch(); await goHome(p); await shot('back-key-1-documents');
    sh('adb shell input keyevent KEYCODE_BACK'); await sleep(2500);
    const leftFromDocs = !inApp(); await shot('back-key-2-after-back-on-documents');
    p = await launch();                                                               // relaunch (force-stop + monkey + wait for 'Documents')
    await goHome(p); p = await cur();
    await p.getByRole('button', { name: 'New', exact: true }).click({ timeout: T });
    await p.locator('.cm-content').waitFor({ timeout: 30000 }); await shot('back-key-3-editor-open');
    sh('adb shell input keyevent KEYCODE_BACK'); await sleep(2500);
    const stays = inApp(); let editorGone = null, onDocs = null;
    if (stays) { p = await cur(); editorGone = (await p.locator('.cm-content').count()) === 0; onDocs = (await p.getByText('Recent documents').count()) > 0; }
    await shot('back-key-4-after-back-in-editor');
    const ok = leftFromDocs && stays && editorGone === true && onDocs === true;
    return { ok, detail: `M-35: Back on Documents leavesApp=${leftFromDocs} (intended: true); Back in editor appStillForeground=${stays} editorGone=${editorGone} onDocuments=${onDocs} (intended: true/true/true); focus=${focusPkg().replace(/.*\{|\}/g, '')}` };
  });

  // ----- wrap up -----
  save();
  await device.close();
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
})().catch(async (e) => { console.error(e); fs.writeFileSync(`${EV}/error.txt`, String(e.stack || e)); save(); process.exit(1); });
