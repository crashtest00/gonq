import { isTauri } from './files';

/** The one place the project repository URL is written down (the Tauri capability scopes to the same URL). */
export const REPO_URL = 'https://github.com/crashtest00/gonq';

/** True in the desktop app, where links go to the default browser through the opener plugin. */
export function opensExternallyNatively(): boolean {
  return isTauri();
}

/** Opens a URL in the user's default browser (desktop only; the web build uses a normal link). */
export async function openExternal(url: string): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}
