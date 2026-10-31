/**
 * <CommentsSheet/> and <CommentsButton/>: the mobile counterpart of CommentsSidebar.tsx. The sheet ("Comments") is docked
 * below the editor, not laid over it, so the editor shrinks above it and the open thread's anchor stays visible (the
 * editor screen reveals it). The list has one row per thread with its own Open/Resolved badge, "No comments yet." when
 * empty and the "Add comment" action (it runs the same Add Comment command as Alt+M; the draft box "New comment" replaces the
 * list while a draft is open, Submit/Cancel); the thread view shows the messages, Edit thread (first message), Delete thread
 * (confirmed first), Reply (Ctrl/Cmd+Enter saves, same rules as desktop through controllers/commentBox), Resolve/Reopen and
 * Close thread. Reply, status, edit and delete go through controllers/threadEdits, the same functions desktop uses, into the
 * document via the editor handle; failures go to the global banner. CommentsButton is the top-bar Comments button (outside the command registry).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { SAVE_KEYS, SAVE_TIP, saveKeyProps, useOnce } from '@gonq/editor/controllers/commentBox';
import { deleteText, editText, replyText, statusText } from '@gonq/editor/controllers/threadEdits';
import { listThreads, preview, relativeTime, type ThreadItem } from '@gonq/editor/model/threads';
import { DEFAULT_AUTHOR, getAuthorName } from '@gonq/editor/platform/settings';
import { BottomSheet } from '../shell/BottomSheet';
import { useCommandHost } from '../shell/commandContext';
import { useComments, type CommentDraft } from '../shell/comments';
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

function EditBox({ initial, onCancel, onSave }: { initial: string; onCancel(): void; onSave(body: string): void }) {
  const [body, setBody] = useState(initial);
  const save = useOnce(body, () => onSave(body));
  return (
    <div className="m-reply">
      <textarea aria-label="Edit comment" {...saveKeyProps('Save', save)} rows={4} autoFocus value={body} onChange={(e) => setBody(e.target.value)} />
      <button type="button" className="m-tap m-tap-primary m-block" onClick={save} title={`Save (${SAVE_TIP})`} aria-keyshortcuts={SAVE_KEYS}>
        Save
      </button>
      <button type="button" className="m-tap m-block m-outline" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function DeleteSheet({ item, onChoose }: { item: ThreadItem; onChoose(confirmed: boolean): void }) {
  const { thread } = item;
  const cancel = useRef<HTMLButtonElement>(null);
  // Cancel is the safe default for a destructive action.
  useEffect(() => cancel.current?.focus(), []);
  const label = thread.anchor !== undefined && thread.anchor !== '' ? `\u201c${preview(thread.anchor)}\u201d` : thread.messages[0] ? `\u201c${preview(thread.messages[0].body)}\u201d` : 'this thread';
  return (
    <>
      <div className="m-scrim" data-testid="choice-scrim" onClick={() => onChoose(false)} />
      <section className="m-sheet m-choice" role="alertdialog" aria-modal="true" aria-labelledby="delete-thread-title" aria-describedby="delete-thread-body">
        <h2 id="delete-thread-title" className="m-choice-title">
          Delete thread {label}?
        </h2>
        <p id="delete-thread-body" className="m-choice-body">
          The whole thread, including its replies, is removed from the document.
        </p>
        <button type="button" ref={cancel} className="m-tap m-block m-outline" onClick={() => onChoose(false)}>
          Cancel
        </button>
        <button type="button" className="m-tap m-block m-destructive" onClick={() => onChoose(true)}>
          Delete
        </button>
      </section>
    </>
  );
}

function Draft({ anchor, onCancel, onSubmit }: { anchor?: string; onCancel(): void; onSubmit(body: string): void }) {
  const [body, setBody] = useState('');
  const submit = useOnce(body, () => onSubmit(body));
  return (
    <div className="m-thread">
      <span className="m-draft-title">New comment</span>
      {anchor !== undefined && <blockquote>{`On: '${anchor}'`}</blockquote>}
      <div className="m-reply">
        <textarea aria-label="Comment" {...saveKeyProps('Submit', submit)} placeholder="Write a comment…" rows={4} autoFocus value={body} onChange={(e) => setBody(e.target.value)} />
        <button type="button" className="m-tap m-tap-primary m-block" onClick={submit} title={`Submit (${SAVE_TIP})`} aria-keyshortcuts={SAVE_KEYS}>
          Submit
        </button>
        <button type="button" className="m-tap m-block m-outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SingleThread({
  item,
  onClose,
  onReply,
  onSetStatus,
  onEdit,
  onDelete,
}: {
  item: ThreadItem;
  onClose(): void;
  onReply(body: string): void;
  onSetStatus(status: 'open' | 'resolved'): void;
  onEdit(body: string): void;
  onDelete(): void;
}) {
  const { thread } = item;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="m-thread">
      <div className="m-thread-meta">
        <Badge status={thread.status} />
        <span>{thread.messages[0] ? relativeTime(thread.messages[0].timestamp) : ''}</span>
        <span className="m-thread-actions">
          <button type="button" className="m-tap m-outline" aria-label="Edit thread" disabled={editing} onClick={() => setEditing(true)}>
            ✎
          </button>
          <button type="button" className="m-tap m-outline" aria-label="Delete thread" onClick={() => setConfirming(true)}>
            🗑
          </button>
          <button type="button" className="m-tap m-outline" onClick={onClose}>
            Close thread
          </button>
        </span>
      </div>
      {thread.anchor !== undefined && <blockquote>{thread.anchor}</blockquote>}
      {editing ? (
        <EditBox
          initial={thread.messages[0]?.body ?? ''}
          onCancel={() => setEditing(false)}
          onSave={(b) => {
            onEdit(b);
            setEditing(false);
          }}
        />
      ) : (
        <>
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
        </>
      )}
      {confirming && (
        <DeleteSheet
          item={item}
          onChoose={(ok) => {
            setConfirming(false);
            if (ok) onDelete();
          }}
        />
      )}
    </div>
  );
}

export function CommentsSheet() {
  const { open, selectedKey, draft, openThread, showList, close, cancelDraft } = useComments();
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
    if (selected === undefined) return false;
    try {
      editor.current?.setText(make(selected));
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const submitDraft = (d: CommentDraft, body: string) => {
    if (body.trim() === '') return;
    if (d.text !== text) {
      cancelDraft();
      return setError('The document changed while you were writing; start the comment again.');
    }
    try {
      if (editor.current === null) throw new Error('No document is open.');
      const before = new Set(listThreads(text).map((t) => t.thread.id));
      const next = editor.current.createThread(d.target, author, body.trim());
      const created = listThreads(next).find((t) => !before.has(t.thread.id));
      setError(null);
      cancelDraft();
      editor.current.collapse();
      if (created) openThread(created.key);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <BottomSheet open={open} title="Comments" onClose={close} docked>
      {draft !== null ? (
        <Draft anchor={draft.anchor} onCancel={cancelDraft} onSubmit={(b) => submitDraft(draft, b)} />
      ) : selected !== undefined ? (
        <SingleThread
          item={selected}
          onClose={showList}
          onReply={(body) => body.trim() !== '' && edit((i) => replyText(text, i, author, body))}
          onSetStatus={(status) => edit((i) => statusText(text, i, status))}
          onEdit={(body) => body.trim() !== '' && edit((i) => editText(text, i, body))}
          onDelete={() => {
            if (edit((i) => deleteText(text, i))) showList();
          }}
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
