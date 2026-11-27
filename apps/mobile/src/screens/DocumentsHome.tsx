/**
 * The Gonq home (the documents screen, shown while no tab is open): the entry points (Open Repo… = the shared controller's openRepo (sign-in, then the picker), Open Folder… = the shared FolderProvider's openFolder (the system folder picker; cancel is silent), and the "+" button = File > New), and the recent
 * documents (listRecents through the document controller, at most MAX_RECENTS) with an icon per source, the file
 * name, "owner/repo @ branch" for GitHub files and the relative time. Tapping a row reopens it
 * (allowRecentDocument first); long names truncate. There is no sign-in row (Open Repo… starts sign-in) and no remove button. Loading and errors go
 * to the shell banner.
 */
import type { ReactNode } from 'react';
import { basename, githubDetail, localDetail, relativeTime } from '@gonq/editor/model/recentRow';
import { isLocalFolderRoot, isLocalPath, localDisplayPath } from '@gonq/editor/platform/local';
import { MAX_RECENTS } from '@gonq/editor/platform/recents';
import { parseGithubPath } from '@gonq/editor/platform/github';
import { useFolder } from '../shell/folder';
import { useGithub } from '../shell/github';
import { runFileCommand, useDocuments } from '../shell/documents';

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
const FolderIcon = () => (
  <Svg>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
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
const PlusIcon = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

const outline = { border: '1px solid var(--border)' } as const;

export function DocumentsHome() {
  const doc = useDocuments();

  const gh = useGithub();
  const folder = useFolder();

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4) 0' }}>
        <button type="button" className="m-tap" style={{ ...outline, flex: 1 }} onClick={() => void gh.openRepo()}>
          Open Repo…
        </button>
        <button type="button" className="m-tap" style={{ ...outline, flex: 1 }} onClick={() => void folder.openFolder()}>
          Open Folder…
        </button>
      </div>
      <div className="m-label">Recent documents</div>
      {doc.recents.length === 0 ? (
        <div className="m-empty">
          <p>No recent documents.</p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {doc.recents.slice(0, MAX_RECENTS).map((r) => {
            const name = basename(r.path);
            const detail = githubDetail(r.path) ?? localDetail(r.path);
            const isFolder = isLocalFolderRoot(r.path);
            return (
              <li key={r.path} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                <button
                  type="button"
                  className="m-tap"
                  title={isLocalPath(r.path) ? localDisplayPath(r.path) : r.path}
                  style={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', gap: 'var(--space-3)', textAlign: 'left', minHeight: 56 }}
                  onClick={() => void (isFolder ? folder.openFolderPath(r.path) : doc.openKnownPath(r.path, true))}
                >
                  {parseGithubPath(r.path) !== null ? <BranchIcon /> : isFolder ? <FolderIcon /> : <FileIcon />}
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
