import { useState } from 'react';
import { X } from 'lucide-react';
import { preview, relativeTime, type ThreadItem } from './threads';

function Badge({ status }: { status: 'open' | 'resolved' }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        status === 'open' ? 'bg-accent text-accent-foreground' : 'bg-border text-muted-foreground'
      }`}
    >
      {status === 'open' ? 'Open' : 'Resolved'}
    </span>
  );
}

function Anchor({ text }: { text: string }) {
  return (
    <blockquote className="m-0 border-l-2 border-accent pl-2 text-[12.5px] italic text-muted-foreground">{text}</blockquote>
  );
}

function ThreadList({
  threads,
  onOpen,
  onAdd,
  canAdd,
}: {
  threads: ThreadItem[];
  onOpen: (key: string) => void;
  onAdd: () => void;
  canAdd: boolean;
}) {
  return (
    <>
      <h2 className="m-0 px-4 pb-3 pt-4 text-sm font-semibold">Comments</h2>
      <div className="px-4 pb-3">
        <button
          type="button"
          disabled={!canAdd}
          onClick={onAdd}
          className="w-full cursor-pointer rounded-control border-0 bg-accent px-3.5 py-2.5 font-sans text-[13.5px] font-semibold text-accent-foreground disabled:cursor-default disabled:opacity-50"
        >
          Add comment
        </button>
      </div>
      {threads.length === 0 ? (
        <p className="m-0 px-4 text-[13px] text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {threads.map(({ key, thread }) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => onOpen(key)}
                className="flex w-full flex-col items-start gap-1.5 border-0 border-t border-solid border-border bg-transparent px-4 py-3 text-left font-sans text-foreground hover:bg-surface"
              >
                <span className="flex items-center gap-2">
                  <Badge status={thread.status} />
                  <span className="text-[11px] text-muted-foreground">
                    {thread.messages[0] ? relativeTime(thread.messages[0].timestamp) : ''}
                  </span>
                </span>
                {thread.anchor !== undefined && <Anchor text={thread.anchor} />}
                <span className="text-[13.5px]">{thread.messages[0] ? preview(thread.messages[0].body) : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SingleThread({ item, onClose }: { item: ThreadItem; onClose: () => void }) {
  const { thread } = item;
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Badge status={thread.status} />
        <span className="text-[11px] text-muted-foreground">
          {thread.messages[0] ? relativeTime(thread.messages[0].timestamp) : ''}
        </span>
        <button
          type="button"
          aria-label="Close thread"
          onClick={onClose}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-control border-0 bg-transparent p-0 text-muted-foreground hover:bg-surface"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      {thread.anchor !== undefined && <Anchor text={thread.anchor} />}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {thread.messages.map((m, i) => (
          <li key={i}>
            <div className="text-[11.5px] font-semibold text-muted-foreground">
              <span>{m.author}</span> · <span title={m.timestamp}>{relativeTime(m.timestamp)}</span>
            </div>
            <div className="whitespace-pre-wrap text-[13.5px]">{m.body}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Draft({ anchor, onCancel, onSubmit }: { anchor?: string; onCancel: () => void; onSubmit: (body: string) => void }) {
  const [body, setBody] = useState('');
  return (
    <div className="flex flex-col gap-3.5 p-5">
      <span className="text-sm font-semibold">New comment</span>
      {anchor !== undefined && <Anchor text={`On: '${anchor}'`} />}
      <textarea
        aria-label="Comment"
        placeholder="Write a comment…"
        rows={4}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="box-border w-full rounded-control border border-ring bg-background p-3 font-sans text-[13.5px] text-foreground outline-none"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded-control border border-solid border-border bg-transparent px-3.5 py-2 font-sans text-[13px] font-semibold text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => body.trim() !== '' && onSubmit(body)}
          className="cursor-pointer rounded-control border-0 bg-primary px-3.5 py-2 font-sans text-[13px] font-semibold text-primary-foreground"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

/** Lists threads, shows one, and drafts a new one; writing the document is the caller's. */
export function CommentsSidebar({
  threads,
  selectedKey,
  onOpen,
  onClose,
  draft = null,
  canAdd = false,
  onAdd,
  onCancelDraft,
  onSubmitDraft,
}: {
  threads: ThreadItem[];
  selectedKey: string | null;
  onOpen: (key: string) => void;
  onClose: () => void;
  /** The comment being written, if any; `anchor` is the quoted text for a selection. */
  draft?: { anchor?: string } | null;
  canAdd?: boolean;
  onAdd?: () => void;
  onCancelDraft?: () => void;
  onSubmitDraft?: (body: string) => void;
}) {
  const selected = selectedKey === null ? undefined : threads.find((t) => t.key === selectedKey);
  return (
    <aside aria-label="Comments" className="flex w-[340px] shrink-0 overflow-hidden">
      <div className="w-px shrink-0" style={{ background: 'var(--brass-hairline-v)' }} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        {draft !== null ? (
          <Draft anchor={draft.anchor} onCancel={() => onCancelDraft?.()} onSubmit={(b) => onSubmitDraft?.(b)} />
        ) : selected !== undefined ? (
          <SingleThread item={selected} onClose={onClose} />
        ) : (
          <ThreadList threads={threads} onOpen={onOpen} onAdd={() => onAdd?.()} canAdd={canAdd} />
        )}
      </div>
    </aside>
  );
}
