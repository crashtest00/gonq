/** openLink: Ctrl/Cmd+click on a link opens it in the default browser (desktop) or a new tab (web). */
import { openExternal, opensExternallyNatively } from '../platform/external';

/** Ctrl/Cmd+click on a link: the default browser on desktop, a new tab on the web. */
export function openLink(href: string): void {
  if (opensExternallyNatively()) void openExternal(href);
  else window.open(href, '_blank', 'noopener,noreferrer');
}
