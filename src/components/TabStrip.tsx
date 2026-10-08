import { ListTree, MessageSquare } from 'lucide-react';

export function TabStrip({
  name,
  dirty = false,
  outlineOpen = false,
  onToggleOutline,
  commentsOpen,
  onToggleComments,
}: {
  name: string | null;
  dirty?: boolean;
  outlineOpen?: boolean;
  onToggleOutline?: () => void;
  commentsOpen: boolean;
  onToggleComments: () => void;
}) {
  return (
    <>
      <div className="flex h-[46px] shrink-0 items-center overflow-x-auto px-3">
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
        {name !== null && (
          <div
            role="tab"
            aria-selected="true"
            title={name}
            className="flex h-[34px] max-w-[320px] items-center truncate bg-surface px-[22px] text-[13px] font-semibold text-foreground drop-shadow-[0_1px_2px_rgba(20,23,31,.06)]"
            style={{ clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 100%, 0 100%)' }}
          >
            <span className="truncate">{name}</span>
            {dirty && <span aria-label="unsaved changes" title="Unsaved changes" className="ml-1.5 text-accent-foreground">●</span>}
          </div>
        )}
        <button
          type="button"
          aria-label="Comments"
          title="Comments"
          aria-pressed={commentsOpen}
          onClick={onToggleComments}
          className={`ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-control border-0 p-0 text-foreground hover:bg-surface ${
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
