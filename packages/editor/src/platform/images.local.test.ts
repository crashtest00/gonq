/** Insert > Image (pickImage) into a local:// document on Android: the picture is copied into the document's folder through local_create_bytes. */
import { vi } from 'vitest';
import { fakeSafPlugin } from '../testing/mockBindings';

const saf = fakeSafPlugin();
const dialogOpen = vi.fn();
const fsRead = vi.fn();
const fsStat = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => saf.invoke(cmd, args) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a: unknown[]) => dialogOpen(...a) }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: (...a: unknown[]) => fsRead(...a), stat: (...a: unknown[]) => fsStat(...a) }));

import { MAX_LOCAL_IMAGE_BYTES, pickImage } from './images';
import { localPath } from './local';

const TREE = 'content://com.android.externalstorage.documents/tree/primary%3ANotes';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 0, 255]);
const doc = (rel: string) => localPath({ tree: TREE, rel });

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  vi.stubGlobal('__GONQ_APP__', 'mobile');
  saf.granted.clear();
  saf.addTree(TREE, { 'a.md': 'x', 'sub/b.md': 'y' });
  dialogOpen.mockReset().mockResolvedValue('content://media/picker/0/42');
  fsRead.mockReset().mockResolvedValue(PNG);
  fsStat.mockReset().mockResolvedValue({ size: PNG.length });
});

describe('pickImage into a local:// document', () => {
  it('writes the picture bytes next to the document and returns a relative reference', async () => {
    const r = await pickImage(doc('sub/b.md'));
    expect(r).toEqual({ src: 'image.png', alt: 'image' });
    const stored = await saf.invoke('local_read', { tree: TREE, rel: 'sub/image.png' }) as { bytes: string };
    expect(Uint8Array.from(atob(stored.bytes), (c) => c.charCodeAt(0))).toEqual(PNG);
  });

  it('never overwrites: a taken name gets a number', async () => {
    saf.put(TREE, 'image.png', Uint8Array.from([9]));
    const r = await pickImage(doc('a.md'));
    expect(r?.src).toBe('image%202.png');
    const old = await saf.invoke('local_read', { tree: TREE, rel: 'image.png' }) as { size: number };
    expect(old.size).toBe(1);
  });

  it('takes the extension from the first bytes when the picked URI has none', async () => {
    fsRead.mockResolvedValue(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]));
    expect((await pickImage(doc('a.md')))?.src).toBe('image.jpg');
  });

  it('resolves null when the picker is cancelled and writes nothing', async () => {
    dialogOpen.mockResolvedValue(null);
    expect(await pickImage(doc('a.md'))).toBeNull();
    expect(saf.text(TREE, 'image.png')).toBeNull();
  });

  it('refuses a picture over the size limit before reading it', async () => {
    fsStat.mockResolvedValue({ size: MAX_LOCAL_IMAGE_BYTES + 1 });
    await expect(pickImage(doc('a.md'))).rejects.toThrow(/Resize it first/);
    expect(fsRead).not.toHaveBeenCalled();
  });

  it('explains a single-document grant has no folder to keep a picture in', async () => {
    const uri = 'content://com.android.providers/document/primary%3Asolo.md';
    saf.nextDocument = { uri, name: 'solo.md' };
    await saf.invoke('local_create_document', { name: 'solo.md' });
    await expect(pickImage(localPath({ tree: uri, rel: 'solo.md' }))).rejects.toThrow(/Open the folder/);
    expect(dialogOpen).not.toHaveBeenCalled();
  });
});
