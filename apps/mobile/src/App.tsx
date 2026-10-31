/**
 * The mobile app root: notices and navigator providers around the phone shell. It starts on the splash and
 * replaces it with the Documents home after `splashMs` (default 800 ms). ThemeProvider runs the saved theme. DocumentProvider holds the shared document session. GithubProvider runs the shared GitHub controller (Open Repo, the repo screen, and ensureSignedIn opening the sign-in screen). CommandHostProvider builds the registry CommandContext the ⋯ menu and the long-press sheet run against. DialogsProvider shows the unsaved-changes and conflict sheets. FolderProvider holds the opened local folder, the Folder navigator sheet and the Save as name prompt. CommentsProvider holds the Comments sheet state. OutlineProvider holds the Outline drawer state. EditorBridge opens the editor screen when a document opens.
 */
import { useEffect } from 'react';
import { NoticesProvider } from './shell/notices';
import { DialogsProvider } from './shell/dialogs';
import { OutlineProvider } from './shell/outline';
import { DocumentProvider } from './shell/documents';
import { ThemeProvider } from './shell/theme';
import { NavigatorProvider, StackNavigator, useNavigator } from './shell/StackNavigator';
import { PhoneShell } from './shell/PhoneShell';
import { GithubProvider } from './shell/github';
import { FolderProvider } from './shell/folder';
import { CommandHostProvider } from './shell/commandContext';
import { CommentsProvider } from './shell/comments';
import { EditorBridge } from './screens/EditorScreen';
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
      <ThemeProvider>
        <DialogsProvider>
        <DocumentProvider>
          <NavigatorProvider initial={splashScreen}>
            <SplashTimer ms={splashMs} />
            <FolderProvider>
              <GithubProvider>
                <EditorBridge />
                <CommandHostProvider>
                  <CommentsProvider>
                    <OutlineProvider>
                      <PhoneShell>
                        <StackNavigator />
                      </PhoneShell>
                    </OutlineProvider>
                  </CommentsProvider>
                </CommandHostProvider>
              </GithubProvider>
            </FolderProvider>
          </NavigatorProvider>
        </DocumentProvider>
        </DialogsProvider>
      </ThemeProvider>
    </NoticesProvider>
  );
}
