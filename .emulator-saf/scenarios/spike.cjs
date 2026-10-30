// M-14 evidence scenario: every pending row of docs/mobile-local-folders.md "Device evidence", driven against the backend spike APK's
// debug panel (buttons Pick / Persisted / List / Selftest, output in #saf-out, log tag GonqSaf). Each phase is isolated so one failure
// does not hide the others; every result (value or error text, with ms) goes to results.json and the screenshots/logcat.
const DOCS = 'primary:Documents/GonqSpike';
const FALLBACK_TREE = 'content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FGonqSpike';
module.exports = async ({ device, L }) => {
  const phase = async (name, f) => { try { await f(); } catch (e) { L.log(name, false, String(e.stack || e).slice(0, 600)); try { L.shot(`${name}-error`); } catch {} } };
  const getPage = async () => { const p = await L.webPage(device); await p.waitForSelector('#saf-out', { state: 'attached', timeout: 60000 }); return p; };
  const out = (p) => p.evaluate(() => document.getElementById('saf-out').textContent);
  // Direct invoke with timing and the error text, for steps the panel has no button for.
  const saf = (p, command, args) => p.evaluate(async ([command, args]) => {
    const t0 = performance.now();
    try { const v = await window.__TAURI_INTERNALS__.invoke('plugin:safspike|saf', { command, args }); return { ok: true, ms: Math.round(performance.now() - t0), v }; }
    catch (e) { return { ok: false, ms: Math.round(performance.now() - t0), err: String(e && e.message || e) }; }
  }, [command, args]);
  const click = async (p, label, waitFor, ms = 30000) => {
    const before = (await out(p)).length;
    await p.getByRole('button', { name: label, exact: true }).click();
    const end = Date.now() + ms;
    while (Date.now() < end) { const o = await out(p); if (o.length > before && (!waitFor || o.slice(before).includes(waitFor))) return o.slice(before); await L.sleep(500); }
    return (await out(p)).slice(before);
  };
  const rec = (k, r) => L.log(k, !!r.ok, JSON.stringify(r).slice(0, 700));

  let p = await getPage(); let tree = null;

  // 1. JS open({directory:true}) through the dialog plugin: expected to reject or do nothing useful on Android.
  await phase('js-dialog-open-directory', async () => {
    const r = await p.evaluate(() => Promise.race([
      window.__TAURI_INTERNALS__.invoke('plugin:dialog|open', { options: { directory: true } }).then((v) => ({ resolved: JSON.stringify(v) }), (e) => ({ rejected: String(e && e.message || e) })),
      new Promise((res) => setTimeout(() => res({ timeout15s: true }), 15000))]));
    L.shot('01-js-dialog-open-directory'); L.log('js open({directory:true})', true, JSON.stringify(r));
    if (r.timeout15s) { L.sh('adb shell input keyevent 4'); await L.sleep(1000); L.shot('01-after-back'); }
    p = await getPage();
  });

  // 2. System picker: Pick -> DocumentsUI -> GonqSpike -> Use this folder -> Allow.
  await phase('pick', async () => {
    await p.getByRole('button', { name: 'Pick', exact: true }).click();
    const ok = await L.pickTree(['Documents', 'GonqSpike'], '02-pick');
    p = await getPage(); await L.sleep(1500);
    const o = await out(p); L.log('pick output', ok && /tree/.test(o), o.slice(0, 600)); L.shot('02-pick-after');
    tree = await p.evaluate(() => localStorage.getItem('saf-tree'));
    L.log('picked tree URI', !!tree, tree);
  });
  tree = tree || FALLBACK_TREE;

  // 3. Persisted + List (root), panel buttons.
  await phase('persisted-list', async () => {
    L.log('Persisted button', true, await click(p, 'Persisted', 'persisted')); L.shot('03-persisted');
    L.log('List button', true, await click(p, 'List', 'list')); L.shot('03-list');
    L.log('dumpsys uri_grants', true, L.persistedGrants().slice(0, 800));
  });

  // 4. Selftest: create, write wt, read, stat, shorter wt, read, write w, read, create tmp, rename, list.
  await phase('selftest', async () => {
    const o = await click(p, 'Selftest', 'list after', 60000); L.log('selftest output', /list after/.test(o), o); L.shot('04-selftest');
  });

  // 5. Read/stat of seeded files, a.md and the second-provider-folder file (Downloads: outside the granted tree).
  await phase('read-stat', async () => {
    rec('read a.md', await saf(p, 'read', { tree, doc: `${DOCS}/a.md` }));
    rec('stat a.md', await saf(p, 'stat', { tree, doc: `${DOCS}/a.md` }));
    rec('read sub/c.md (nested)', await saf(p, 'read', { tree, doc: `${DOCS}/sub/c.md` }));
    rec('list sub', await saf(p, 'list', { tree, doc: `${DOCS}/sub` }));
    rec('read img/pic.png (relative image target, as text)', await saf(p, 'read', { tree, doc: `${DOCS}/img/pic.png` }));
    rec('read ../GonqSecond/d.md (outside granted tree)', await saf(p, 'read', { tree, doc: 'primary:Download/GonqSecond/d.md' }));
    rec('create outside tree (Download/GonqSecond)', await saf(p, 'create', { tree, doc: 'primary:Download/GonqSecond', name: 'x.md' }));
  });

  // 6. Conflict check: stat, external modification via adb, stat again.
  await phase('conflict', async () => {
    const a = await saf(p, 'stat', { tree, doc: `${DOCS}/a.md` }); rec('stat before external write', a);
    await L.sleep(2500);
    L.externalWrite('/sdcard/Documents/GonqSpike/a.md', '# Alpha changed externally with a longer body\n');
    const b = await saf(p, 'stat', { tree, doc: `${DOCS}/a.md` }); rec('stat after external write', b);
    L.log('modified/size changed', !!(a.ok && b.ok && (a.v.modified !== b.v.modified || a.v.size !== b.v.size)), `before=${JSON.stringify(a.v)} after=${JSON.stringify(b.v)}`);
    rec('read after external write', await saf(p, 'read', { tree, doc: `${DOCS}/a.md` }));
  });

  // 7. ~3000-file folder listing and a 5 MB file read (text path: the spike has no binary command; ASCII content keeps JSON size honest).
  await phase('perf', async () => {
    L.sh(`adb shell 'mkdir -p /sdcard/Documents/GonqSpike/big; cd /sdcard/Documents/GonqSpike/big; i=0; while [ $i -lt 3000 ]; do : > f$i.md; i=$((i+1)); done; ls | wc -l'`);
    L.sh(`adb shell 'head -c 3932160 /dev/urandom | base64 -w0 > /sdcard/Documents/GonqSpike/img/big.png; ls -l /sdcard/Documents/GonqSpike/img/big.png'`);
    for (let i = 1; i <= 3; i++) { const r = await saf(p, 'list', { tree, doc: `${DOCS}/big` }); L.log(`list 3000 files run ${i}`, !!r.ok, `${r.ms} ms entries=${r.ok ? r.v.entries.length : r.err}`); }
    for (let i = 1; i <= 3; i++) { const r = await saf(p, 'read', { tree, doc: `${DOCS}/img/big.png` }); L.log(`read 5 MB (as text) run ${i}`, !!r.ok, `${r.ms} ms chars=${r.ok ? r.v.text.length : r.err}`); }
    L.shot('07-perf');
  });

  // 8. Persistence: force-stop, relaunch, no new pick.
  await phase('persist-relaunch', async () => {
    L.forceStop(); await L.launch(); p = await getPage(); L.shot('08-relaunch');
    L.log('Persisted after force-stop', true, await click(p, 'Persisted', 'persisted')); L.shot('08-persisted');
    L.log('List after force-stop (no new pick)', true, await click(p, 'List', 'list')); L.shot('08-list');
    rec('read a.md after relaunch (direct tree)', await saf(p, 'read', { tree, doc: `${DOCS}/a.md` }));
    L.log('dumpsys uri_grants after relaunch', true, L.persistedGrants().slice(0, 800));
  });

  // 9. Revoke: folder moved away (provider-side change), then the grant itself revoked (pm clear drops the app's URI grants).
  await phase('revoke', async () => {
    L.sh('adb shell mv /sdcard/Documents/GonqSpike /sdcard/Documents/GonqSpikeMoved');
    rec('list while folder moved away', await saf(p, 'list', { tree })); rec('read a.md while moved away', await saf(p, 'read', { tree, doc: `${DOCS}/a.md` }));
    L.sh('adb shell mv /sdcard/Documents/GonqSpikeMoved /sdcard/Documents/GonqSpike');
    L.log('cmd uri_grants / am revoke-uri probe', true, ['adb shell cmd uri_grants help 2>&1 | head -5', 'adb shell am help 2>&1 | grep -i uri | head -5'].map((c) => { try { return L.sh(c); } catch (e) { return 'err'; } }).join(' | '));
    L.sh(`adb shell pm clear ${L.PKG}`); await L.sleep(1000);
    L.log('dumpsys uri_grants after pm clear', true, L.persistedGrants().slice(0, 500) || '(no grants for app)');
    await L.launch(); p = await getPage(); L.shot('09-after-revoke');
    L.log('Persisted after revoke', true, await click(p, 'Persisted', 'persisted')); L.shot('09-persisted');
    rec('list with the revoked tree URI', await saf(p, 'list', { tree })); rec('read a.md with the revoked tree URI', await saf(p, 'read', { tree, doc: `${DOCS}/a.md` }));
    rec('write a.md with the revoked tree URI', await saf(p, 'write', { tree, doc: `${DOCS}/a.md`, text: 'x', mode: 'wt' }));
    L.shot('09-list-revoked');
  });
};
