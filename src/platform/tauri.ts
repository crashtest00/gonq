/** isTauri(): whether the app runs inside the Tauri webview. Its own file so github.ts and files.ts can both use it without importing each other. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
