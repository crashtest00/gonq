/**
 * Puts text on the clipboard. navigator.clipboard exists only in a secure context
 * (https, localhost, the desktop webview), so over plain http fall back to a
 * hidden textarea and execCommand('copy'). The same fallback runs when writeText rejects (the Android WebView
 * denies it with "Write permission denied."). Rejects if nothing works.
 */
export async function copyText(text: string): Promise<void> {
  let denied: unknown;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (e) {
      denied = e;
    }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(area);
  try {
    area.select();
    if (typeof document.execCommand !== 'function' || !document.execCommand('copy')) {
      throw denied ?? new Error('the browser refused to copy');
    }
  } finally {
    area.remove();
    active?.focus();
  }
}
