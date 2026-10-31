/**
 * The Documents home: the entry points (Open Repo… = the shared controller's openRepo (sign-in, then the picker), Open Folder… which says it is not
 * available yet until M-31, and the "+" button = File > New), the interim "Sign in to GitHub" row, and the recent
 * documents (listRecents through the document controller, at most MAX_RECENTS) with an icon per source, the file
 * name, "owner/repo @ branch" for GitHub files and the relative time. Tapping a row reopens it
 * (allowRecentDocument first); each row has a "Remove <name> from recent documents" button. Loading and errors go
 * to the shell banner.
 */
import type { ReactNode } from 'react';
import { basename, githubDetail, relativeTime } from '@gonq/editor/model/recentRow';
import { MAX_RECENTS } from '@gonq/editor/platform/recents';
import { parseGithubPath } from '@gonq/editor/platform/github';
import { githubSignInScreen } from './GitHubSignIn';
import { useGithub } from '../shell/github';
import { runFileCommand, useDocuments } from '../shell/documents';
import { useNotices } from '../shell/notices';
import { useNavigator } from '../shell/StackNavigator';

const Svg = ({ children }: { children: ReactNode }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const FileIcon = () => (
  <Svg>
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
    <path d="M14 3v5h5" />
  </Svg>
);
const BranchIcon = () => (
  <Svg>
    <circle cx="6" cy="5" r="2" />
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="7" r="2" />
    <path d="M6 7v10M18 9c0 5-12 3-12 8" />
  </Svg>
);
const XIcon = () => (
  <Svg>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
const PlusIcon = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

const outline = { border: '1px solid var(--border)' } as const;

export const OPEN_FOLDER_UNAVAILABLE = 'Opening a folder is not available yet in the Gonq app.';

export function DocumentsHome() {
  const { push } = useNavigator();
  const { setError } = useNotices();
  const doc = useDocuments();

  const gh = useGithub();

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4) 0' }}>
        <button type="button" className="m-tap" style={{ ...outline, flex: 1 }} onClick={() => void gh.openRepo()}>
          Open Repo…
        </button>
        <button type="button" className="m-tap" style={{ ...outline, flex: 1 }} onClick={() => setError(OPEN_FOLDER_UNAVAILABLE)}>
          Open Folder…
        </button>
      </div>
      <button
        type="button"
        className="m-tap"
        style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, marginTop: 'var(--space-2)' }}
        onClick={() => push(githubSignInScreen)}
      >
        Sign in to GitHub
      </button>
      <div className="m-label">Recent documents</div>
      {doc.recents.length === 0 ? (
        <div className="m-empty">
          <p>No recent documents.</p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {doc.recents.slice(0, MAX_RECENTS).map((r) => {
            const name = basename(r.path);
            const detail = githubDetail(r.path);
            return (
              <li key={r.path} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                <button
                  type="button"
                  className="m-tap"
                  title={r.path}
                  style={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', gap: 'var(--space-3)', textAlign: 'left', minHeight: 56 }}
                  onClick={() => void doc.openKnownPath(r.path, true)}
                >
                  {parseGithubPath(r.path) !== null ? <BranchIcon /> : <FileIcon />}
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                      {detail !== null && (
                        <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--muted-foreground)' }}>{detail}</span>
                      )}
                    </span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--muted-foreground)' }}>{relativeTime(r.openedAt)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="m-tap"
                  aria-label={`Remove ${name} from recent documents`}
                  style={{ color: 'var(--muted-foreground)' }}
                  onClick={() => void doc.forgetRecent(r.path)}
                >
                  <XIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        className="m-tap m-tap-primary"
        aria-label="New"
        style={{ position: 'fixed', right: 'var(--space-4)', bottom: 'calc(var(--space-4) + env(safe-area-inset-bottom))', width: 56, height: 56, borderRadius: '50%' }}
        onClick={() => runFileCommand('file.new', { newFile: doc.newFile })}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
