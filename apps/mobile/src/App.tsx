/**
 * The mobile app root: notices and navigator providers around the phone shell. It starts on the splash and
 * replaces it with the Documents home after `splashMs` (default 800 ms). SignInBridge lets ensureSignedIn open the sign-in screen.
 */
import { useEffect } from 'react';
import { NoticesProvider } from './shell/notices';
import { NavigatorProvider, StackNavigator, useNavigator } from './shell/StackNavigator';
import { PhoneShell } from './shell/PhoneShell';
import { SignInBridge } from './screens/GitHubSignIn';
import { documentsScreen, splashScreen } from './screens/screens';

function SplashTimer({ ms }: { ms: number }) {
  const { top, replace } = useNavigator();
  useEffect(() => {
    if (top.key !== splashScreen.key) return;
    const t = setTimeout(() => replace(documentsScreen), ms);
    return () => clearTimeout(t);
  }, [top.key, ms, replace]);
  return null;
}

export default function App({ splashMs = 800 }: { splashMs?: number }) {
  return (
    <NoticesProvider>
      <NavigatorProvider initial={splashScreen}>
        <SplashTimer ms={splashMs} />
        <SignInBridge />
        <PhoneShell>
          <StackNavigator />
        </PhoneShell>
      </NavigatorProvider>
    </NoticesProvider>
  );
}
