/**
 * <CommentsSheet/> and <CommentsButton/>: the mobile counterpart of CommentsSidebar.tsx. The sheet ("Comments") is docked
 * below the editor, not laid over it, so the editor shrinks above it and the open thread's anchor stays visible (the
 * editor screen reveals it). The list has one row per thread with its own Open/Resolved badge, "No comments yet." when
 * empty and the "Add comment" action (the add flow itself is M-27); the thread view shows the messages, Reply (Ctrl/Cmd+Enter
 * saves, same rules as desktop through controllers/commentBox), Resolve/Reopen and Close thread. Reply and status edits
 * go through controllers/threadEdits, the same functions desktop uses, into the document via the editor handle; failures
 * go to the global banner. CommentsButton is the top-bar Comments button (outside the command registry).
 */
import { useEffect, useMemo, useState } from 'react';
import { SAVE_KEYS, SAVE_TIP, saveKeyProps, useOnce } from '@gonq/editor/controllers/commentBox';
import { replyText, statusText } from '@gonq/editor/controllers/threadEdits';
import { listThreads, preview, relativeTime, type ThreadItem } from '@gonq/editor/model/threads';
import { DEFAULT_AUTHOR, getAuthorName } from '@gonq/editor/platform/settings';
import { BottomSheet } from '../shell/BottomSheet';
import { useCommandHost } from '../shell/commandContext';
import { useComments } from '../shell/comments';
import { useDocuments } from '../shell/documents';
import { useNotices } from '../shell/notices';

function Badge({ status }: { status: 'open' | 'resolved' }) {
  return (
    <span className="m-badge" data-status={status}>
      {status === 'open' ? 'Open' : 'Resolved'}
    </span>
  );
}

function ThreadList({ threads, onOpen }: { threads: ThreadItem[]; onOpen(key: string): void }) {
  const { ctx } = useCommandHost();
  return (
    <>
      <button type="button" className="m-tap m-tap-primary m-block" disabled={!ctx.canAddComment} onClick={() => ctx.addComment()}>
        Add comment
      </button>
      {threads.length === 0 ? (
        <p className="m-comments-empty">No comments yet.</p>
      ) : (
        <ul className="m-thread-list">
          {threads.map(({ key, thread }) => (
            <li key={key}>
              <button type="button" className="m-tap m-thread-row" onClick={() => onOpen(key)}>
                <span className="m-thread-meta">
                  <Badge status={thread.status} />
                  <span>{thread.messages[0] ? relativeTime(thread.messages[0].timestamp) : ''}</span>
                </span>
                {thread.anchor !== undefined && <blockquote>{thread.anchor}</blockquote>}
                <span>{thread.messages[0] ? preview(thread.messages[0].body) : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ReplyBox({ status, onReply, onToggleStatus }: { status: 'open' | 'resolved'; onReply(body: string): void; onToggleStatus(): void }) {
  const [body, setBody] = useState('');
  const send = useOnce(body, () => {
    onReply(body);
    setBody('');
  });
  return (
    <div className="m-reply">
      <textarea
        aria-label="Reply"
        {...saveKeyProps('Reply', send)}
        placeholder="Reply…"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button type="button" className="m-tap m-tap-primary m-block" onClick={send} title={`Reply (${SAVE_TIP})`} aria-keyshortcuts={SAVE_KEYS}>
        Reply
      </button>
      <button type="button" className="m-tap m-block m-outline" onClick={onToggleStatus}>
        {status === 'open' ? 'Resolve' : 'Reopen'}
      </button>
    </div>
  );
}

function SingleThread({ item, onClose, onReply, onSetStatus }: { item: ThreadItem; onClose(): void; onReply(body: string): void; onSetStatus(status: 'open' | 'resolved'): void }) {
  const { thread } = item;
  return (
    <div className="m-thread">
      <div className="m-thread-meta">
        <Badge status={thread.status} />
        <span>{thread.messages[0] ? relativeTime(thread.messages[0].timestamp) : ''}</span>
        <button type="button" className="m-tap m-outline" style={{ marginLeft: 'auto' }} onClick={onClose}>
          Close thread
        </button>
      </div>
      {thread.anchor !== undefined && <blockquote>{thread.anchor}</blockquote>}
      <ol className="m-messages">
        {thread.messages.map((m, i) => (
          <li key={i}>
            <div className="m-message-head">
              <span>{m.author}</span> · <span title={m.timestamp}>{relativeTime(m.timestamp)}</span>
            </div>
            <div className="m-message-body">{m.body}</div>
          </li>
        ))}
      </ol>
      <ReplyBox key={item.key} status={thread.status} onReply={onReply} onToggleStatus={() => onSetStatus(thread.status === 'open' ? 'resolved' : 'open')} />
    </div>
  );
}

export function CommentsSheet() {
  const { open, selectedKey, openThread, showList, close } = useComments();
  const { session } = useDocuments();
  const { editor } = useCommandHost();
  const { setError } = useNotices();
  const [author, setAuthor] = useState(DEFAULT_AUTHOR);
  const text = session.text;
  const threads = useMemo(() => (open ? listThreads(text) : []), [open, text]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void getAuthorName().then((n) => live && setAuthor(n));
    return () => {
      live = false;
    };
  }, [open]);
  const selected = selectedKey === null ? undefined : threads.find((t) => t.key === selectedKey);

  const edit = (make: (item: ThreadItem) => string) => {
    if (selected === undefined) return;
    try {
      editor.current?.setText(make(selected));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <BottomSheet open={open} title="Comments" onClose={close} docked>
      {selected !== undefined ? (
        <SingleThread
          item={selected}
          onClose={showList}
          onReply={(body) => body.trim() !== '' && edit((i) => replyText(text, i, author, body))}
          onSetStatus={(status) => edit((i) => statusText(text, i, status))}
        />
      ) : (
        <ThreadList threads={threads} onOpen={openThread} />
      )}
    </BottomSheet>
  );
}

/** The top-bar Comments button: opens the thread list (closes the sheet when it is open). Not a registry command. */
export function CommentsButton() {
  const { open, toggle } = useComments();
  return (
    <button type="button" className="m-tap" aria-label="Comments" aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
      💬
    </button>
  );
}
