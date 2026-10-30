// Orchestrator verification script (Gonq mobile M-13 walking skeleton). Drives the debug APK's
// WebView over CDP with Playwright's Android API, records screenshots and a results.json in evidence/.
const { _android } = require('./node_modules/playwright-core');
const { execSync } = require('child_process');
const fs = require('fs');
const PKG = process.env.APP_ID || 'com.gonq.app';
const EV = 'evidence'; fs.mkdirSync(EV, { recursive: true });
const results = []; const log = (k, ok, d) => { results.push({ k, ok, d }); console.log(`[check] ${k}: ${ok ? 'PASS' : 'FAIL'} ${d || ''}`); };
const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function comment(body) {
  const repo = process.env.GITHUB_REPOSITORY, sha = process.env.GITHUB_SHA;
  try { sh(`gh api repos/${repo}/commits/${sha}/comments -f body=${JSON.stringify(body)}`); } catch (e) { console.log('comment failed', e.message); }
}
async function page(device) {
  const wv = await device.webView({ pkg: PKG }, { timeout: 60000 });
  return wv.page();
}
async function launch(device) {
  sh(`adb shell am force-stop ${PKG}`);
  sh(`adb shell monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  await sleep(4000);
  return page(device);
}
async function shot(device, name) { fs.writeFileSync(`${EV}/${name}.png`, await device.screenshot()); }
(async () => {
  const [device] = await _android.devices();
  const mode = process.env.MODE || 'm13';
  sh(`adb install -r "${process.env.APK_PATH}"`);
  log('install', true, sh(`adb shell dumpsys package ${PKG} | grep -m1 versionName || true`));
  const info = { model: sh('adb shell getprop ro.product.model'), android: sh('adb shell getprop ro.build.version.release'), abi: sh('adb shell getprop ro.product.cpu.abilist') };
  log('device', true, JSON.stringify(info));
  // 1. light and dark launch
  for (const theme of ['no', 'yes']) {
    sh(`adb shell cmd uimode night ${theme}`);
    const p = await launch(device);
    await p.waitForSelector('text=Documents', { timeout: 60000 });
    await sleep(3000);
    await shot(device, `launch-${theme === 'yes' ? 'dark' : 'light'}`);
    const st = await p.evaluate(() => ({ top: (document.querySelector('header,[role=banner]')||document.body.firstElementChild).getBoundingClientRect().top, cls: document.documentElement.className, media: matchMedia('(prefers-color-scheme: dark)').matches, bg: getComputedStyle(document.body).backgroundColor }));
    const sys = sh('adb shell cmd uimode night');
    const wantDark = theme === 'yes';
    log(`launch-${wantDark ? 'dark' : 'light'}`, (wantDark ? /dark/.test(st.cls) : !/dark/.test(st.cls)), `${sys} ${JSON.stringify(st)}`);
  }
  sh('adb shell cmd uimode night no');
  if (mode === 'smoke') {
    const sp = await launch(device);
    await sp.getByText('Sign in to GitHub').click();
    // copy check: request a code (never approved; it simply expires) and tap Copy code
    await sp.getByRole('button', { name: /^Start$/ }).click();
    await sp.getByLabel('User code').waitFor({ timeout: 60000 });
    await sp.getByRole('button', { name: /Copy code/ }).click();
    await sleep(1500);
    const t = await sp.evaluate(() => document.body.innerText);
    await shot(device, 'after-copy');
    log('copy code', /Copied/.test(t) && !/Copy failed|Write permission denied/.test(t), (t.match(/Cop(y|ied)[^\n]*/g) || []).join(' | '));
    await sp.getByRole('button', { name: /^Cancel$/ }).click().catch(() => {}); fs.writeFileSync(`${EV}/results.json`, JSON.stringify({ info, results }, null, 1)); await device.close(); process.exit(results.every((r) => r.ok) ? 0 : 1); }
  // 2. sign in
  let p = await launch(device);
  await p.getByText('Sign in to GitHub').click();
  await p.getByRole('button', { name: /^Start$/ }).waitFor({ timeout: 60000 });
  await shot(device, 'ready');
  await comment(`READY FOR CODE (emulator run ${process.env.GITHUB_RUN_ID}): app installed and on the sign-in Start screen. Reply with a commit comment "GO" to request the device code; waits up to ${process.env.GO_WAIT_MIN || 60} min.`);
  const goDeadline = Date.now() + (Number(process.env.GO_WAIT_MIN || 60)) * 60000;
  let go = false;
  while (!go && Date.now() < goDeadline) {
    try { go = sh(`gh api repos/${process.env.GITHUB_REPOSITORY}/commits/${process.env.GITHUB_SHA}/comments -q '.[].body'`).split('\n').some((b) => b.trim() === 'GO'); } catch (e) {}
    if (!go) await sleep(20000);
  }
  log('go-signal', go);
  if (!go) { fs.writeFileSync(`${EV}/results.json`, JSON.stringify({ info, results }, null, 1)); await device.close(); process.exit(1); }
  p = await page(device);
  await p.getByRole('button', { name: /^Start$/ }).click();
  const code = (await p.getByLabel('User code').textContent({ timeout: 60000 })).trim();
  await shot(device, 'code');
  await p.getByRole('button', { name: /Copy code/ }).click();
  await sleep(1500);
  const copyState = await p.evaluate(() => document.body.innerText);
  await shot(device, 'after-copy');
  log('copy code', /Copied/.test(copyState) && !/Copy failed|Write permission denied/.test(copyState), (copyState.match(/Cop(y|ied)[^\n]*/g) || []).join(' | '));
  await comment(`DEVICE CODE ${code} — approve at https://github.com/login/device (emulator run ${process.env.GITHUB_RUN_ID}; waits up to 14 min)`);
  log('device-code', !!code, code);
  try { await p.getByRole('button', { name: /Open github.com\/login\/device/ }).click(); await sleep(3000); } catch (e) { log('open-github', false, e.message); }
  await shot(device, 'browser');
  sh('adb shell input keyevent KEYCODE_BACK'); await sleep(2000);
  p = await page(device);
  const signed = await p.getByText(/Signed in as/).waitFor({ timeout: 14 * 60000 }).then(() => true, () => false);
  await shot(device, 'signed-in');
  log('signed-in (device flow, resume, HTTPS)', signed, signed ? await p.getByText(/Signed in as/).textContent() : '');
  const sessionOnly = await p.getByText(/session only/).count();
  log('storage keychain (no "session only")', signed && sessionOnly === 0, `sessionOnly=${sessionOnly}`);
  // 3. force-stop and relaunch
  p = await launch(device);
  await p.getByText('Sign in to GitHub').click().catch(() => {});
  const still = await p.getByText(/Signed in as/).waitFor({ timeout: 30000 }).then(() => true, () => false);
  await shot(device, 'relaunch');
  log('still signed in after force-stop', still);
  // 4. sign out, relaunch
  if (still) { await p.getByRole('button', { name: /Sign Out/ }).click(); await sleep(2000); }
  p = await launch(device);
  await p.getByText('Sign in to GitHub').click().catch(() => {});
  const out = await p.getByRole('button', { name: /^Start$/ }).waitFor({ timeout: 30000 }).then(() => true, () => false);
  await shot(device, 'signed-out');
  log('signed out after relaunch', out);
  // 5. airplane mode
  sh('adb shell cmd connectivity airplane-mode enable'); await sleep(3000);
  await p.getByRole('button', { name: /^Start$/ }).click().catch(() => {});
  await sleep(8000);
  const alertText = await p.locator('[role=alert]').allTextContents();
  await shot(device, 'airplane');
  const alive = sh(`adb shell pidof ${PKG} || true`);
  log('airplane: network error, no crash', alertText.length > 0 && !!alive, JSON.stringify(alertText));
  sh('adb shell cmd connectivity airplane-mode disable');
  fs.writeFileSync(`${EV}/results.json`, JSON.stringify({ info, results }, null, 1));
  await comment(`EMULATOR RESULTS run ${process.env.GITHUB_RUN_ID}:\n` + results.map((r) => `- ${r.ok ? 'PASS' : 'FAIL'} ${r.k} ${r.d || ''}`).join('\n'));
  await device.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch(async (e) => { console.error(e); fs.writeFileSync(`${EV}/error.txt`, String(e.stack || e)); process.exit(1); });
