/**
 * startMobile(root): applies the saved theme, then renders <App/> into `root`, so the first render is already in the
 * theme (index.html applied the stored one before first paint). Called by main.tsx; exported so a test can drive it.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme, isDark, systemPrefersDark } from '@gonq/editor/lib/theme';
import { getTheme } from '@gonq/editor/platform/settings';

export function startMobile(root: HTMLElement): Promise<void> {
  return getTheme()
    .then((choice) => applyTheme(isDark(choice, systemPrefersDark())))
    .finally(() => {
      ReactDOM.createRoot(root).render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      );
    });
}
