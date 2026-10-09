import { useEffect, useRef } from 'react';
import { FolderTree, ListTree, MessageSquare, Plus, X } from 'lucide-react';
import type { TabInfo } from '../document/useDocument';

function segments(path: string): string[] {
  return path.split(/[\\/]/).filter((s) => s !== '');
}

/**
 * Tab labels: the file name, with just enough of the folder path in front of it to tell
 * apart tabs that share a name (`notes/todo.md` vs `work/todo.md`).
 */
export function tabLabels(tabs: Pick<TabInfo, 'name' | 'path'>[]): string[] {
  return tabs.map((tab, i) => {
    const twins = tabs.filter((o, j) => j !== i && o.name === tab.name && o.path !== tab.path);
    if (tab.path === null || twins.length === 0) return tab.name;
    const mine = segments(tab.path);
    for (let depth = 2; depth <= mine.length; depth++) {
      const label = mine.slice(-depth).join('/');
      const clash = twins.some((o) => o.path !== null && segments(o.path).slice(-depth).join('/') === label);
      if (!clash) return label;
    }
    return mine.join('/');
  });
}

export function TabStrip({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  outlineOpen = false,
  onToggleOutline,
  folderOpen = false,
  onToggleFolder,
  commentsOpen,
  onToggleComments,
}: {
  tabs: TabInfo[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onNew: () => void;
  outlineOpen?: boolean;
  onToggleOutline?: () => void;
  folderOpen?: boolean;
  onToggleFolder?: () => void;
  commentsOpen: boolean;
  onToggleComments: () => void;
}) {
  const labels = tabLabels(tabs);
  const activeRef = useRef<HTMLDivElement>(null);
  // The strip scrolls sideways when tabs overflow; the active tab is always brought into view.
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeId, tabs.length]);

  return (
    <>
      <div className="flex h-[46px] shrink-0 items-center px-3">
        <button
          type="button"
          aria-label="Document outline"
          title="Document outline"
          aria-pressed={outlineOpen}
          onClick={onToggleOutline}
          className={`mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-control border-0 p-0 text-foreground hover:bg-surface ${
            outlineOpen ? 'bg-surface' : 'bg-transparent'
          }`}
        >
          <ListTree size={18} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Folder navigator"
          title="Folder navigator"
          aria-pressed={folderOpen}
          onClick={onToggleFolder}
          className={`mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-control border-0 p-0 text-foreground hover:bg-surface ${
            folderOpen ? 'bg-surface' : 'bg-transparent'
          }`}
        >
          <FolderTree size={18} aria-hidden />
        </button>
        <div role="tablist" aria-label="Open documents" className="flex min-w-0 flex-1 items-end self-end overflow-x-auto">
          {tabs.map((tab, i) => {
            const active = tab.id === activeId;
            return (
              <div
                key={tab.id}
                ref={active ? activeRef : undefined}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                title={tab.path ?? tab.name}
                onClick={() => onSelect(tab.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(tab.id);
                  }
                }}
                className={`flex h-[34px] max-w-[320px] shrink-0 cursor-pointer items-center whitespace-nowrap bg-surface pl-[22px] pr-3 text-[13px] ${
                  active
                    ? 'font-semibold text-foreground drop-shadow-[0_1px_2px_rgba(20,23,31,.06)]'
                    : 'text-muted-foreground opacity-45'
                }`}
                style={{ clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 100%, 0 100%)' }}
              >
                <span className="truncate">{labels[i]}</span>
                {tab.dirty && <span aria-label="unsaved changes" title="Unsaved changes" className="ml-1.5 text-accent-foreground">●</span>}
                <button
                  type="button"
                  aria-label={`Close ${tab.name}`}
                  title="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className="ml-2 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent p-0 text-inherit hover:bg-background"
                >
                  <X size={12} aria-hidden />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            aria-label="New tab"
            title="New tab"
            onClick={onNew}
            className="mb-0 flex h-[34px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent p-0 text-muted-foreground hover:bg-surface"
          >
            <Plus size={16} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          aria-label="Comments"
          title="Comments"
          aria-pressed={commentsOpen}
          onClick={onToggleComments}
          className={`ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-control border-0 p-0 text-foreground hover:bg-surface ${
            commentsOpen ? 'bg-surface' : 'bg-transparent'
          }`}
        >
          <MessageSquare size={18} aria-hidden />
        </button>
      </div>
      <div className="h-[2px] shrink-0" style={{ background: 'var(--brass-hairline)' }} />
    </>
  );
}
