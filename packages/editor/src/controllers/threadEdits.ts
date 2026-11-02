/**
 * The document edits behind the comments panel's Reply, Resolve/Reopen, Edit thread and Delete thread, shared by the desktop sidebar (App.tsx) and the
 * mobile Comments sheet so both produce the same bytes: replyText, statusText, editText and deleteText take the document text and a ThreadItem
 * (from model/threads) and return the new text via the comment-threads library, which throws on an ambiguous id.
 */
import { appendToThread, deleteThread, editThreadMessage, setThreadStatus, type CommentThreadStatus } from '../comment-threads';
import type { ThreadItem } from '../model/threads';

const ref = (item: ThreadItem) => ({ id: item.thread.id, ordinal: item.ordinal });

/** `text` with `body` (trimmed) appended to the thread as a message by `author`. */
export const replyText = (text: string, item: ThreadItem, author: string, body: string): string =>
  appendToThread(text, ref(item), author, body.trim());

/** `text` with the thread's status (block and marker glyph) set. */
export const statusText = (text: string, item: ThreadItem, status: CommentThreadStatus): string =>
  setThreadStatus(text, ref(item), status);

/** `text` with the thread's first message replaced by `body` (trimmed). */
export const editText = (text: string, item: ThreadItem, body: string): string => editThreadMessage(text, ref(item), body.trim());

/** `text` with the thread's block and marker removed. */
export const deleteText = (text: string, item: ThreadItem): string => deleteThread(text, ref(item));
