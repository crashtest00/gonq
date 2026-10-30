/**
 * The registry command ids the mobile menus leave out: SSH is not part of the mobile app, so File > Connect to
 * Server… (the only SSH command in the registry; remote-folder recents live inside the desktop-only Connect dialog,
 * not as commands) is skipped. The mobile menus filter the shared registry with EXCLUDED_COMMAND_IDS.
 */
export const EXCLUDED_COMMAND_IDS: readonly string[] = ['file.connect'];
