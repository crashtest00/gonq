import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  RESOLVED_COMMENT_LABEL,
  parseCommentMarkerFragment,
  parseCommentThreads,
} from '../comment-threads';
import type { FileAccess, OpenedDocument } from '../platform/files';
import { MarkdownImage } from './MarkdownImage';

/**
 * The text handed to the renderer: the document with its thread blocks cut out,
 * located by the comment-threads library. This is a throwaway copy; the
 * document text itself is never changed.
 */
export function viewText(text: string): string {
  let out = '';
  let at = 0;
  for (const thread of [...parseCommentThreads(text)].sort((a, b) => a.from - b.from)) {
    out += text.slice(at, thread.from);
    at = thread.to;
  }
  // Drop a leading BOM for rendering only; it stays in the document text.
  return (out + text.slice(at)).replace(/^﻿/, '');
}

export function MarkdownView({ doc, files }: { doc: OpenedDocument; files: FileAccess }) {
  const source = useMemo(() => viewText(doc.text), [doc.text]);

  const components = useMemo<Components>(
    () => ({
      a({ node: _node, href, children, ...props }) {
        const threadId = href === undefined ? undefined : parseCommentMarkerFragment(href);
        if (threadId !== undefined) {
          const resolved = String(children) === RESOLVED_COMMENT_LABEL;
          return (
            <span
              className={`gonq-marker ${resolved ? 'gonq-marker-resolved' : 'gonq-marker-open'}`}
              data-thread-id={threadId}
            >
              {children}
            </span>
          );
        }
        return (
          <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
            {children}
          </a>
        );
      },
      img({ node: _node, src, alt }) {
        return typeof src === 'string' ? <MarkdownImage doc={doc} files={files} src={src} alt={alt} /> : null;
      },
    }),
    [doc, files],
  );

  return (
    <article className="gonq-doc" data-testid="markdown-view">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {source}
      </ReactMarkdown>
    </article>
  );
}
