/**
 * <GonqHome/>: the desktop editor area when no tab is open (the web build shows it too). The real Gonq logo, the
 * entry points New, Open Folder… and Open Repo… (each runs its existing registry command through `onRun`), and the
 * recent documents, most recent first, from the same list as the sidebar's Recent documents, without remove buttons.
 */
import logo from '../assets/gonq-logo-OUTLINE.svg';
import type { RecentDocument } from '@gonq/editor/platform/recents';
import { basename, relativeTime } from '@gonq/editor/model/recentRow';
import { parseGithubPath } from '@gonq/editor/platform/github';
import { isSshPath, remoteAccount } from '@gonq/editor/platform/remote';

const ENTRY_POINTS = [
  { id: 'file.new', label: 'New' },
  { id: 'file.openFolder', label: 'Open Folder…' },
  { id: 'github.openRepo', label: 'Open Repo…' },
] as const;

export function GonqHome({ recents, onRun, onOpenRecent }: { recents: RecentDocument[]; onRun: (commandId: string) => void; onOpenRecent: (path: string) => void }) {
  return (
    <div data-testid="gonq-home" className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-10 py-8">
      <img src={logo} alt="Gonq logo" className="mb-6 h-40 w-40 max-w-full shrink-0 object-contain" />
      <div className="mb-8 flex flex-wrap justify-center gap-2">
        {ENTRY_POINTS.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onRun(e.id)}
            className="cursor-pointer rounded-control border border-solid border-border bg-transparent px-3 py-1.5 text-[13px] text-foreground hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring"
          >
            {e.label}
          </button>
        ))}
      </div>
      <section aria-label="Recent documents" className="w-full max-w-[560px]">
        <h2 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Recent documents</h2>
        {recents.length === 0 ? (
          <p className="m-0 text-[13px] text-muted-foreground">No recent documents.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {recents.map((r) => {
              const gh = parseGithubPath(r.path);
              return (
                <li key={r.path}>
                  <button
                    type="button"
                    onClick={() => onOpenRecent(r.path)}
                    title={r.path}
                    aria-label={`Open ${basename(r.path)} from home`}
                    className="w-full cursor-pointer border-0 bg-transparent px-2 py-1 text-left hover:bg-surface"
                  >
                    <span className="block truncate text-[13px] text-foreground">
                      {basename(r.path)}
                      {gh !== null && (
                        <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                          {gh.owner}/{gh.repo} @ {gh.branch}
                        </span>
                      )}
                      {isSshPath(r.path) && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{remoteAccount(r.path)}</span>}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">{relativeTime(r.openedAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
