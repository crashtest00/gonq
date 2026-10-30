// M-14 runner: installs the APK, seeds the test trees, records environment info, then runs each scenario file
// named in SCENARIOS (comma list, from ./scenarios/<name>.cjs, each exporting async (ctx) => void). With no
// scenarios it records the baseline only: launch screenshot, system picker reachability, seeded tree listing.
const { _android } = require('../.emulator/node_modules/playwright-core');
const L = require('./lib.cjs');
(async () => {
  const [device] = await _android.devices();
  L.sh(`adb install -r -g "${process.env.APK_PATH}"`);
  const info = { apkSha: process.env.APK_SHA, model: L.sh('adb shell getprop ro.product.model'), android: L.sh('adb shell getprop ro.build.version.release'),
    api: L.sh('adb shell getprop ro.build.version.sdk'), abi: L.sh('adb shell getprop ro.product.cpu.abilist'), image: process.env.IMAGE };
  console.log(info);
  L.sh('bash .emulator-saf/seed.sh');
  L.sh('adb logcat -c');
  await L.launch(); try { const pg = await L.webPage(device); await pg.waitForSelector('text=Documents', { timeout: 60000 }); } catch (e) { console.log('webview wait', e.message); } L.shot('00-launch'); L.logcat('00-launch');
  const ctx = { device, L };
  for (const s of (process.env.SCENARIOS || '').split(',').filter(Boolean)) {
    try { await require(`./scenarios/${s}.cjs`)(ctx); } catch (e) { L.log(`scenario ${s}`, false, String(e.stack || e)); L.shot(`${s}-error`); }
    L.logcat(`${s}`);
  }
  L.finish(info); await device.close();
  process.exit(0); // evidence run: failures are findings, recorded in results.json, not CI failures
})().catch((e) => { console.error(e); require('fs').writeFileSync(`${L.EV}/error.txt`, String(e.stack || e)); process.exit(1); });
