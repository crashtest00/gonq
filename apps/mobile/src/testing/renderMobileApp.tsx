/**
 * renderMobileApp: renders the mobile <App/> with a user-event session, for the per-feature mobile tests (the
 * counterpart of apps/desktop/src/testing/renderApp.tsx). Defaults to the Documents home (splashMs 0 plus
 * waiting for it); pass `splash: true` to stay on the splash. Also renderInShell() for a bare screen.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import App from '../App';
import { NoticesProvider } from '../shell/notices';
import { ThemeProvider } from '../shell/theme';
import { NavigatorProvider, StackNavigator, type Screen } from '../shell/StackNavigator';
import { PhoneShell } from '../shell/PhoneShell';

export type User = ReturnType<typeof userEvent.setup>;

export async function renderMobileApp({ splash = false }: { splash?: boolean } = {}) {
  const user = userEvent.setup();
  const result = render(<App splashMs={splash ? 3_600_000 : 0} />);
  if (!splash) await screen.findByRole('heading', { name: 'Documents' });
  return { ...result, user };
}

/** Renders `initial` inside the real shell (providers, top bar, banner); `extra` is rendered beside the screen. */
export function renderInShell(initial: Screen, extra?: ReactNode) {
  const user = userEvent.setup();
  const result = render(
    <NoticesProvider>
      <ThemeProvider>
        <NavigatorProvider initial={initial}>
          <PhoneShell>
            <StackNavigator />
          </PhoneShell>
          {extra}
        </NavigatorProvider>
      </ThemeProvider>
    </NoticesProvider>,
  );
  return { ...result, user };
}
