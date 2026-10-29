/**
 * Puts text on the clipboard. navigator.clipboard exists only in a secure context
 * (https, localhost, the desktop webview), so over plain http fall back to a
 * hidden textarea and execCommand('copy'). Rejects if neither works.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
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
      throw new Error('the browser refused to copy');
    }
  } finally {
    area.remove();
    active?.focus();
  }
}
