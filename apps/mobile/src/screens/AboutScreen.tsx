/**
 * The mobile About screen (M-29), reached from the ⋯ menu's Help > About Gonq: the real logo asset unmodified, the
 * name "Gonq", "Version {APP_VERSION}", the repository link (REPO_URL through openExternal) and Close. No tagline,
 * release notes or licences. Exports aboutScreen and APP_VERSION.
 */
import { createElement } from 'react';
import logo from '@repo-assets/gonq-logo-OUTLINE.svg';
import { REPO_URL, openExternal } from '@gonq/editor/platform/external';
import { useNotices } from '../shell/notices';
import { useNavigator, type Screen } from '../shell/StackNavigator';

export const APP_VERSION: string = __APP_VERSION__;

export function AboutScreen() {
  const { pop } = useNavigator();
  const { setError } = useNotices();
  return (
    <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)', textAlign: 'center' }}>
      <img src={logo} alt="Gonq logo" style={{ width: 'min(220px, 60vw)', height: 'auto' }} />
      <h2 style={{ margin: 0, fontSize: 20 }}>Gonq</h2>
      <p style={{ margin: 0, color: 'var(--muted-foreground)' }}>Version {APP_VERSION}</p>
      <a
        className="m-tap"
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        style={{ color: 'var(--primary-text, var(--primary))', textDecoration: 'underline', overflowWrap: 'anywhere' }}
        onClick={(e) => {
          e.preventDefault();
          openExternal(REPO_URL).catch((err) => setError(err instanceof Error ? err.message : String(err)));
        }}
      >
        {REPO_URL}
      </a>
      <button type="button" className="m-tap m-tap-primary" onClick={pop}>
        Close
      </button>
    </div>
  );
}

export const aboutScreen: Screen = { key: 'about', title: 'About Gonq', render: () => createElement(AboutScreen) };
