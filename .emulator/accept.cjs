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
const only = (process.env.ONLY || '').split(',').filter(Boolean);

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
  if (only.length && !only.includes(id)) return;
  let status = 'PASS', detail = '';
  try {
    const r = await fn();
    if (r && typeof r === 'object' && r.ok === false) { status = 'FAIL'; detail = r.detail || ''; } else detail = typeof r === 'string' ? r : (r && r.detail) || '';
  } catch (e) {
    if (e instanceof Skip) { status = 'SKIP'; detail = e.message; } else { status = 'FAIL'; detail = String(e.message || e).split('\n')[0]; }
  }
  await shot(`${id}-${status}`);
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
async function menu(p, menuName, item, opts = {}) {            // ⋯ (aria-label "More") > <menu> > <item>
  await p.getByRole('button', { name: 'More' }).click();
  const m = p.getByRole('menu', { name: menuName });
  await m.getByRole(opts.role || 'menuitem', { name: item }).click({ timeout: T });
}
async function menuItemState(p, menuName, item) {
  await p.getByRole('button', { name: 'More' }).click();
  const b = p.getByRole('menu', { name: menuName }).getByRole('menuitem', { name: item });
  const r = { count: await b.count(), disabled: count0(await b.count()) ? await b.isDisabled() : null };
  await p.keyboard.press('Escape'); return r;
}
const count0 = (n) => n > 0;
const goHome = async (p) => { for (let i = 0; i < 6; i++) { if (await p.getByText('Recent documents').count()) return; await back(); p = await cur(); } };
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
// uiautomator: tap a native control by text/resource-id substring (system pickers, permission dialogs, browser)
function uiTap(re) {
  sh('adb shell uiautomator dump /sdcard/ui.xml >/dev/null && adb pull /sdcard/ui.xml evidence/ui.xml >/dev/null');
  const xml = fs.readFileSync(`${EV}/ui.xml`, 'utf8');
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const n = m[0]; const txt = (n.match(/ text="([^"]*)"/) || [])[1] + ' ' + (n.match(/resource-id="([^"]*)"/) || [])[1] + ' ' + (n.match(/content-desc="([^"]*)"/) || [])[1];
    const b = n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (b && re.test(txt)) { sh(`adb shell input tap ${(+b[1] + +b[3]) >> 1} ${(+b[2] + +b[4]) >> 1}`); return true; }
  }
  return false;
}
const focusPkg = () => sh('adb shell dumpsys window | grep -m1 mCurrentFocus || true');

// ---- main ---------------------------------------------------------------------------------------------------------
(async () => {
  [device] = await _android.devices();
  global.info = { model: sh('adb shell getprop ro.product.model'), android: sh('adb shell getprop ro.build.version.release'), repo: REPO };
  sh('adb shell settings put secure show_ime_with_hard_kb 1');           // keep Gboard up although the emulator has a hardware keyboard
  sh('adb shell cmd uimode night no');
  let p;

  await step('01-install', 'Fresh install of the RC APK, versionCode higher than the skeleton', async () => {
    const vc = () => (sh(`adb shell dumpsys package ${PKG}`).match(/versionCode=(\d+)/) || [])[1];
    let skel = null;
    if (process.env.SKELETON_APK) { sh(`adb uninstall ${PKG} || true`); sh(`adb install -r "${process.env.SKELETON_APK}"`); skel = +vc(); }
    sh(`adb uninstall ${PKG} || true`);                                     // each CI build has its own debug key
    if (sh(`adb shell pm list packages ${PKG} || true`)) skip('uninstall failed');
    sh(`adb install "${process.env.APK_PATH}"`);
    const rc = +vc();
    p = await launch(); await shot('fresh-launch');
    if (skel === null) return { ok: rc > 200, detail: `versionCode=${rc}; SKELETON_APK not given, compared with the 200 in tauri.conf.json (unconfirmed baseline)` };
    return { ok: rc > skel, detail: `rc=${rc} skeleton=${skel}` };
  });

  // ----- GitHub: sign in (the one human touchpoint), read-only use -----
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
    const opts = await p.getByRole('listbox', { name: 'Branches' }).getByRole('option').allTextContents(); await shot('branches');
    await p.keyboard.press('Escape');
    await switchBranch(p, BR.a); await switchBranch(p, BR.b);
    return { ok: opts.length > 0, detail: `branches=${opts.map((o) => o.replace('✓', '')).join(',').slice(0, 200)}; switched ${BR.a} -> ${BR.b}` };
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
    sh(`adb shell mkdir -p ${DIR}`);
    sh(`printf '# Local one\\n\\nhello\\n' | adb shell "cat > ${DIR}/one.md"`);
    sh(`printf '# Links\\n\\nSee [example](https://example.com) here.\\n' | adb shell "cat > ${DIR}/links.md"`);
    p = await launch(); await p.getByRole('button', { name: 'Open Folder…' }).click(); await sleep(4000); await shot('saf-picker');
    // DocumentsUI ignored injected touch in the M-14 run; uiautomator taps are an unconfirmed path
    uiTap(/Documents|GonqAccept/); await sleep(1500); uiTap(/USE THIS FOLDER|Use this folder|button_use|select_button/i); await sleep(1500); uiTap(/Allow|permission_allow/i); await sleep(3000);
    p = await cur(); await p.getByRole('dialog', { name: 'Folder navigator' }).or(p.getByText('one.md')).first().waitFor({ timeout: 30000 });
    await p.getByText('one.md').first().click(); await p.locator('.cm-content').waitFor({ timeout: 30000 });
    return 'folder opened, one.md open';
  });

  await step('07-insert-image-local', 'Insert > Image into a local:// document', async () => {
    p = await cur();
    sh(`adb shell "mkdir -p /sdcard/Pictures; printf '\\x89PNG' > /sdcard/Pictures/m34.png"`);   // unconfirmed: a real PNG would be better; see NOTES
    await menu(p, 'Insert', 'Image…'); await sleep(3000); await shot('image-picker');
    uiTap(/m34\.png/); await sleep(2500); p = await cur();
    const t = await editorText(p);
    return { ok: /!\[|m34\.png/.test(t), detail: 'image picker is a native chooser; selection by uiautomator is unconfirmed' };
  });

  await step('08-save-as', 'Local: Save as into the opened folder', async () => {
    p = await cur(); await focusEditorEnd(p); await typeIme(' edited');
    await menu(p, 'File', /^Save As/);
    const s = p.getByRole('dialog', { name: 'Save as' }); await s.waitFor({ timeout: T });
    await s.getByLabel('File name').fill(`saved-${STAMP}.md`); await shot('save-as');
    await s.getByRole('button', { name: 'Save', exact: true }).click();
    await s.waitFor({ state: 'detached', timeout: 30000 });
    const exists = sh(`adb shell ls ${DIR}`).includes(`saved-${STAMP}.md`);
    return { ok: exists, detail: `fileOnDevice=${exists}` };
  });

  await step('09-reopen-tab-after-back', 'Re-open a tab after Back (recents row reopens the document)', async () => {
    p = await cur(); await back(); p = await cur(); await back(); p = await cur();
    p = await openLocal(p, 'one.md');
    return { ok: (await p.getByRole('tab').count()) >= 1, detail: 'document reopened from Documents after Back' };
  });

  // ----- Android behaviour -----
  await step('10-editor-gboard', 'Editor: type with Gboard incl. autocorrect', async () => {
    p = await cur(); await focusEditorEnd(p); await p.keyboard.press('Enter');
    await shot('keyboard-up');
    const kb = sh('adb shell dumpsys input_method | grep -m1 mInputShown || true');
    await typeIme('teh quick brwn fox '); await sleep(800);
    const t = await editorText(p);
    // adb input text sends key events (not an IME commit), so Gboard may or may not autocorrect; the result is recorded either way
    return { ok: /quick/.test(t) && /mInputShown=true/.test(kb), detail: `${kb} autocorrect=${/\bthe quick\b/.test(t) ? 'corrected' : 'not corrected (see NOTES: unconfirmed)'}` };
  });

  await step('11-accessory-toolbar', 'Editor: accessory toolbar (Bold, Undo, Redo)', async () => {
    p = await cur(); await focusEditorEnd(p);
    const tb = p.getByRole('toolbar', { name: 'Editing' }); await tb.waitFor({ timeout: T });
    const before = await editorText(p);
    await tb.getByRole('button', { name: /^Bold/ }).click(); await typeIme('bolded'); const afterBold = await editorText(p);
    await tb.getByRole('button', { name: 'Undo' }).click(); await tb.getByRole('button', { name: 'Redo' }).click();
    await shot('toolbar');
    return { ok: /\*\*/.test(afterBold) && afterBold !== before, detail: `bold markers=${/\*\*/.test(afterBold)}` };
  });

  await step('12-menus', 'Editor: long-press menu and ⋯ menu (no Connect to Server)', async () => {
    p = await cur();
    const box = await p.locator('.cm-content').boundingBox();
    const dpr = await p.evaluate(() => devicePixelRatio);
    const top = await p.evaluate(() => window.outerHeight - window.innerHeight);   // unconfirmed: toolbar offset
    const x = Math.round((box.x + 40) * dpr), y = Math.round((box.y + 20) * dpr + (top > 0 ? top : 0));
    sh(`adb shell input swipe ${x} ${y} ${x} ${y} 900`); await sleep(800);
    const sheet = p.getByRole('menu', { name: 'Editor' }); const lp = await sheet.isVisible().catch(() => false); await shot('long-press');
    const items = lp ? await sheet.getByRole('menuitem').allTextContents() : [];
    if (lp) await p.keyboard.press('Escape');
    await p.getByRole('button', { name: 'More' }).click(); await sleep(500);
    const menus = await p.getByRole('menu').evaluateAll((l) => l.map((e) => e.getAttribute('aria-label')));
    const connect = await p.getByRole('menuitem', { name: /Connect to Server/ }).count(); await shot('overflow-menu');
    await p.keyboard.press('Escape');
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
    const toHome = []; for (let i = 0; i < 3; i++) { await back(); p = await cur(); toHome.push(await p.getByText('Recent documents').count()); }   // System Back elsewhere
    return { ok: left, detail: `system Back leaves Open PR=${left}; Recent-documents visible after further Backs=${toHome.join(',')}; nothing submitted` };
  });

  await step('14-open-link-native', 'Opening links natively (tap a link; leaves the app to the browser)', async () => {
    p = await cur(); p = await openLocal(p, 'links.md');
    await p.locator('.cm-content a, .cm-content .cm-link, .cm-content [class*=link]').first().click({ timeout: T });   // unconfirmed: link element/class
    await sleep(3000); const f = focusPkg(); await shot('after-link');
    const left = !f.includes(PKG); sh('adb shell input keyevent KEYCODE_BACK'); await sleep(1500);
    if (!(await device.webView({ pkg: PKG }, { timeout: 20000 }).then(() => true, () => false))) sh(`adb shell monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
    return { ok: left, detail: f };
  });

  await step('15-invalid-range-caret-comment', 'Invalid-range selection falls back to a caret comment', async () => {
    p = await cur(); p = await openLocal(p, 'one.md');
    // unconfirmed trigger: the validator's rule was not read. Select from the first line across several lines (heading to body) and add a comment.
    await p.locator('.cm-line').first().click();
    await p.keyboard.down('Shift'); for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowDown'); await p.keyboard.up('Shift');
    await menu(p, 'Edit', 'Add Comment').catch(async () => { await p.getByRole('menuitem', { name: 'Add Comment' }).click(); });
    const draft = p.getByRole('textbox', { name: 'Comment' }); await draft.waitFor({ timeout: T });
    const quote = await p.locator('.m-thread blockquote').count(); await shot('caret-draft');
    await p.keyboard.press('Escape'); await p.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
    return { ok: quote === 0, detail: `draft opened; anchor quote shown=${quote} (0 = caret comment); trigger unconfirmed` };
  });

  // ----- Settings, theme -----
  await step('16-theme', 'Theme under ⋯ > View > Theme (Light/Dark/Auto), no Settings theme row', async () => {
    p = await cur();
    await menu(p, 'View', /Dark/, { role: 'menuitemradio' }); await sleep(800);
    const dark = await p.evaluate(() => document.documentElement.className); await shot('theme-dark');
    await menu(p, 'View', /Light/, { role: 'menuitemradio' }); await sleep(800);
    const light = await p.evaluate(() => document.documentElement.className);
    return { ok: /dark/.test(dark) && !/dark/.test(light), detail: `dark="${dark}" light="${light}"` };
  });

  await step('17-settings-author', 'Settings: author name saved; Settings has no theme row', async () => {
    p = await cur(); await menu(p, 'Edit', 'Settings…');
    const f = p.getByRole('form', { name: 'Settings' }); await f.waitFor({ timeout: T });
    const themeRow = await f.getByText(/Theme/).count();
    await f.getByLabel('Author name').fill(`M34 ${STAMP}`); await shot('settings'); await f.getByRole('button', { name: 'Save', exact: true }).click();
    await menu(p, 'Edit', 'Settings…'); const v = await p.getByLabel('Author name').inputValue(); await p.getByRole('button', { name: 'Cancel' }).click();
    return { ok: v === `M34 ${STAMP}` && themeRow === 0, detail: `author=${v} themeRows=${themeRow}` };
  });

  await step('18-signout', 'Settings: sign out, relaunch shows signed out', async () => {
    p = await cur(); await menu(p, 'Edit', 'Settings…');
    await p.getByRole('button', { name: 'Sign Out' }).click(); await p.getByRole('button', { name: 'Sign In' }).waitFor({ timeout: T }); await shot('signed-out');
    await p.getByRole('button', { name: 'Cancel' }).click();
    p = await launch(); await p.getByText('Sign in to GitHub').click();
    return { ok: await p.getByRole('button', { name: /^Start$/ }).waitFor({ timeout: 30000 }).then(() => true, () => false) };
  });

  // ----- wrap up -----
  save();
  await device.close();
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
})().catch(async (e) => { console.error(e); fs.writeFileSync(`${EV}/error.txt`, String(e.stack || e)); save(); process.exit(1); });
