/** Tests for copyText: navigator.clipboard first, then the execCommand fallback when it is missing or rejects. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

function stub(writeText: unknown, exec: boolean) {
  Object.defineProperty(navigator, 'clipboard', { value: writeText ? { writeText } : undefined, configurable: true });
  const execCommand = vi.fn(() => exec);
  (document as unknown as { execCommand: unknown }).execCommand = execCommand;
  return execCommand;
}

afterEach(() => vi.restoreAllMocks());

describe('copyText', () => {
  it('uses navigator.clipboard when it works', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const exec = stub(writeText, true);
    await copyText('abc');
    expect(writeText).toHaveBeenCalledWith('abc');
    expect(exec).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when writeText rejects (Android WebView)', async () => {
    const exec = stub(vi.fn().mockRejectedValue(new Error('Write permission denied.')), true);
    await copyText('abc');
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('rejects with the original error when the fallback fails too', async () => {
    stub(vi.fn().mockRejectedValue(new Error('Write permission denied.')), false);
    await expect(copyText('abc')).rejects.toThrow('Write permission denied.');
  });
});
