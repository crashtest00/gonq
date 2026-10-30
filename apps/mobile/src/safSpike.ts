/** M-14 SPIKE (throwaway, never merged): a debug panel with buttons that drive the Kotlin SAF plugin through the `safspike` command and print results. */
type Inv = (cmd: string, args: unknown) => Promise<any>;
const inv = (): Inv => (window as any).__TAURI_INTERNALS__.invoke;
const saf = (command: string, args: object = {}) => inv()('plugin:safspike|saf', { command, args });

export function mountSafSpike(): void {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:55%;overflow:auto;background:#fff;color:#000;z-index:99999;font:11px monospace;padding:4px';
  const out = document.createElement('pre');
  out.id = 'saf-out';
  let tree = localStorage.getItem('saf-tree') ?? '';
  const log = (m: unknown) => {
    const t = typeof m === 'string' ? m : JSON.stringify(m);
    out.textContent += t + '\n';
    console.log('GonqSaf ' + t);
  };
  const step = async (label: string, f: () => Promise<unknown>) => {
    const t0 = performance.now();
    try { log(`${label}: ${JSON.stringify(await f())} (${Math.round(performance.now() - t0)} ms)`); } catch (e) { log(`${label}: FAIL ${String((e as any)?.message ?? e)}`); }
  };
  const btn = (label: string, f: () => Promise<void>) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'min-height:44px;margin:2px';
    b.onclick = () => void f();
    box.appendChild(b);
  };
  btn('Pick', () => step('pick', async () => { const r = await saf('pick'); if (r.tree) { tree = r.tree; localStorage.setItem('saf-tree', tree); } return r; }));
  btn('Persisted', () => step('persisted', () => saf('persisted')));
  btn('List', () => step('list', () => saf('list', { tree })));
  btn('Selftest', async () => {
    const created: any = await (async () => { let r; await step('create', async () => (r = await saf('create', { tree, name: 'spike-test.md' }))); return r; })();
    if (!created) return;
    const doc = created.id;
    await step('write wt', () => saf('write', { tree, doc, text: '# Spike\n\n![pic](img/pic.png)\n', mode: 'wt' }));
    await step('read', () => saf('read', { tree, doc }));
    await step('stat', () => saf('stat', { tree, doc }));
    await step('write shorter wt', () => saf('write', { tree, doc, text: 'x', mode: 'wt' }));
    await step('read after shorter', () => saf('read', { tree, doc }));
    await step('write w (no truncate)', () => saf('write', { tree, doc, text: 'yy', mode: 'w' }));
    await step('read after w', () => saf('read', { tree, doc }));
    await step('create tmp sibling', () => saf('create', { tree, name: 'spike-test.md.tmp', mime: 'application/octet-stream' }));
    await step('rename', () => saf('rename', { tree, doc, name: 'spike-renamed.md' }));
    await step('list after', () => saf('list', { tree }));
  });
  box.appendChild(out);
  document.body.appendChild(box);
}
