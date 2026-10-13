import { openExternal, opensExternallyNatively } from '../platform/external';

/** Ctrl/Cmd+click on a link: the default browser on desktop, a new tab on the web. */
export function openLink(href: string): void {
  if (opensExternallyNatively()) void openExternal(href);
  else window.open(href, '_blank', 'noopener,noreferrer');
}
