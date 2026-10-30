/** Web entry point (index.html): applies the saved theme before first paint, then renders <App/>. */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme, isDark, systemPrefersDark } from '@gonq/editor/lib/theme';
import { getTheme } from '@gonq/editor/platform/settings';
import './styles/index.css';

// The first paint is already in the saved theme: index.html applied the stored one, and on desktop the saved
// preference is read (and applied) before any content renders.
getTheme()
  .then((choice) => applyTheme(isDark(choice, systemPrefersDark())))
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
