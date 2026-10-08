import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  RESOLVED_COMMENT_LABEL,
  parseCommentMarkerFragment,
  parseCommentMarkers,
  parseCommentThreads,
} from '../comment-threads';
import type { FileAccess, OpenedDocument } from '../platform/files';
import { MarkdownImage } from './MarkdownImage';
import { threadKey, type ThreadItem } from './threads';

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

export function MarkdownView({
  doc,
  files,
  threads = [],
  onOpenThread,
}: {
  doc: OpenedDocument;
  files: FileAccess;
  threads?: ThreadItem[];
  onOpenThread?: (key: string) => void;
}) {
  const source = useMemo(() => viewText(doc.text), [doc.text]);
  const markers = useMemo(() => parseCommentMarkers(source), [source]);

  const components = useMemo<Components>(
    () => ({
      a({ node, href, children, ...props }) {
        const threadId = href === undefined ? undefined : parseCommentMarkerFragment(href);
        if (threadId !== undefined) {
          const resolved = String(children) === RESOLVED_COMMENT_LABEL;
          const className = `gonq-marker ${resolved ? 'gonq-marker-resolved' : 'gonq-marker-open'}`;
          // Pair with its block by ordinal among same-id markers, as the library does.
          const offset = node?.position?.start.offset;
          const ordinal = (markers.get(threadId) ?? []).findIndex((m) => m.from === offset);
          const key = ordinal < 0 ? undefined : threadKey(threadId, ordinal);
          const target = key === undefined ? undefined : threads.find((t) => t.key === key);
          if (key === undefined || target === undefined || onOpenThread === undefined) {
            // Dangling marker: just the glyph.
            return <span className={className}>{children}</span>;
          }
          return (
            <span
              role="button"
              tabIndex={0}
              className={`${className} gonq-marker-link`}
              data-thread-key={key}
              onClick={() => onOpenThread(key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenThread(key);
                }
              }}
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
    [doc, files, markers, threads, onOpenThread],
  );

  return (
    <article className="gonq-doc" data-testid="markdown-view">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {source}
      </ReactMarkdown>
    </article>
  );
}
