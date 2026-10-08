import { createContext, createElement, useContext, useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  RESOLVED_COMMENT_LABEL,
  parseCommentMarkerFragment,
  parseCommentMarkers,
  parseCommentThreads,
} from '../comment-threads';
import type { FileAccess, OpenedDocument } from '../platform/files';
import { detectEol, fromEditable, toEditable } from '../document/splice';
import { keepMarkersWhole } from './atomicMarkers';
import { MarkdownImage } from './MarkdownImage';
import { threadKey, type ThreadItem } from './threads';

/**
 * The text handed to the renderer: the document with its thread blocks blanked
 * out, located by the comment-threads library. Same length as the document, so
 * a rendered node's offset is also its offset in the file, which is what lets a
 * click find the exact source text of a block. A throwaway copy; the document
 * text itself is never changed.
 */
export function maskThreadBlocks(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  let out = '';
  let at = 0;
  for (const thread of [...parseCommentThreads(text)].sort((a, b) => a.from - b.from)) {
    out += text.slice(at, thread.from) + blank(text.slice(thread.from, thread.to));
    at = thread.to;
  }
  // A leading BOM stays in the document text; the renderer sees a space in its place.
  return (out + text.slice(at)).replace(/^\uFEFF/, ' ');
}

/** The source range of one top-level block: text[from, to). */
export interface BlockRange {
  from: number;
  to: number;
}

export interface BlockEditing {
  /** The block being edited, if any; it is shown as its Markdown source in place of the rendered block. */
  region: BlockRange | null;
  onStart: (range: BlockRange) => void;
  /** Receives the editor's new text, in the file's own line endings. */
  onChange: (value: string) => void;
  onClose: () => void;
  /**
   * Document-wide raw view: every block is shown as source, overriding per-block
   * state. Focusing a block's field makes it the `region`, so edits to it (which
   * may add or remove blank lines) keep a stable range until focus leaves.
   */
  rawAll?: boolean;
}

const BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'pre', 'blockquote', 'table', 'hr'] as const;

function BlockEditor({
  value,
  onChange,
  onClose,
  onFocus,
  autoFocus = true,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onFocus?: () => void;
  /** False in the document-wide raw view, where every block is a field and none is focused for you. */
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Focus once, caret at the end; the editor is never remounted while a block is being edited.
  useEffect(() => {
    const el = ref.current;
    if (!el || !autoFocus) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      data-block-editor
      aria-label="Markdown source of this block"
      spellCheck={false}
      value={value}
      rows={1}
      onChange={(e) => {
        const el = e.target;
        // A thread marker is one atomic unit: edits that would split it are repaired.
        const repaired = keepMarkersWhole(value, el.value);
        if (repaired === null) return onChange(el.value);
        if (repaired.value !== value) onChange(repaired.value);
        // React puts the controlled value back after this handler; the caret is set once it has.
        queueMicrotask(() => {
          if (el.isConnected) el.setSelectionRange(repaired.caret, repaired.caret);
        });
      }}
      onFocus={onFocus}
      onBlur={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      className="mb-5 box-border block w-full resize-none overflow-hidden rounded-control border border-ring bg-surface px-3 py-2 font-mono text-[13.5px] leading-[1.6] text-foreground outline-none [box-shadow:0_0_0_3px_color-mix(in_srgb,var(--ring)_18%,transparent)]"
    />
  );
}

const RawContext = createContext<{ text: string; editing?: BlockEditing }>({ text: '' });

/** One top-level block of the document-wide raw view: its source in a field. */
function RawBlock({ node }: { node?: any }) {
  const { text, editing } = useContext(RawContext);
  const pos = node?.position;
  if (pos?.start.offset === undefined || pos.end.offset === undefined) return null;
  const from: number = pos.start.offset;
  const to: number = pos.end.offset;
  const active = editing?.region ?? null;
  // A block swallowed by the field being edited (typed in as a new paragraph) shows once that loses focus.
  if (active !== null && from > active.from && to <= active.to) return null;
  const range = active !== null && from === active.from ? active : { from, to };
  return (
    <BlockEditor
      autoFocus={false}
      value={toEditable(text.slice(range.from, range.to))}
      onFocus={() => active?.from !== from && editing?.onStart({ from, to })}
      onChange={(v) => {
        editing?.onChange(fromEditable(v, detectEol(text)));
        if (v === '') editing?.onClose();
      }}
      onClose={() => editing?.onClose()}
    />
  );
}

// Defined once, so React keeps a field (and its focus) mounted while its text changes.
const RAW_COMPONENTS = Object.fromEntries(BLOCK_TAGS.map((tag) => [tag, RawBlock])) as Components;

export function MarkdownView({
  doc,
  files,
  threads = [],
  onOpenThread,
  editing,
}: {
  doc: OpenedDocument;
  files: FileAccess;
  threads?: ThreadItem[];
  onOpenThread?: (key: string) => void;
  editing?: BlockEditing;
}) {
  const source = useMemo(() => maskThreadBlocks(doc.text), [doc.text]);
  const markers = useMemo(() => parseCommentMarkers(source), [source]);
  const articleRef = useRef<HTMLElement>(null);
  const rawAll = editing?.rawAll === true;
  const region = rawAll ? null : (editing?.region ?? null);

  // Top-level blocks are keyboard-reachable: Enter on a focused block edits it.
  useEffect(() => {
    for (const el of Array.from(articleRef.current?.children ?? [])) {
      if (el.hasAttribute('data-from')) (el as HTMLElement).tabIndex = 0;
    }
  });

  /** Renderer overrides for a piece of the source that starts at `base` in the file. */
  const componentsFor = (base: number): Components => {
    const blocks: Record<string, unknown> = {};
    for (const tag of BLOCK_TAGS) {
      // Each block carries its source range so a click can be traced back to the file text.
      blocks[tag] = ({ node, children, ...props }: any) => {
        const pos = node?.position;
        const range =
          pos?.start.offset === undefined || pos.end.offset === undefined
            ? {}
            : { 'data-from': base + pos.start.offset, 'data-to': base + pos.end.offset };
        return createElement(tag, { ...props, ...range }, children);
      };
    }
    return {
      ...blocks,
      a({ node, href, children, ...props }) {
        const threadId = href === undefined ? undefined : parseCommentMarkerFragment(href);
        if (threadId !== undefined) {
          const resolved = String(children) === RESOLVED_COMMENT_LABEL;
          const className = `gonq-marker ${resolved ? 'gonq-marker-resolved' : 'gonq-marker-open'}`;
          // Pair with its block by ordinal among same-id markers, as the library does.
          const offset = node?.position?.start.offset;
          const ordinal = (markers.get(threadId) ?? []).findIndex((m) => offset !== undefined && m.from === base + offset);
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
                  e.stopPropagation();
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
    };
  };

  const before = useMemo(
    () => componentsFor(0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, files, markers, threads, onOpenThread],
  );
  const afterBase = region?.to ?? 0;
  const after = useMemo(
    () => componentsFor(afterBase),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, files, markers, threads, onOpenThread, afterBase],
  );

  /** The block (a direct child of the article) a DOM node sits in, if it is a source block. */
  const blockOf = (node: EventTarget | null): HTMLElement | null => {
    let el = node instanceof Element ? node : null;
    while (el && el.parentElement !== articleRef.current) el = el.parentElement;
    return el instanceof HTMLElement && el.hasAttribute('data-from') ? el : null;
  };
  const startEdit = (block: HTMLElement) =>
    editing?.onStart({ from: Number(block.dataset.from), to: Number(block.dataset.to) });

  const onClick = (e: MouseEvent) => {
    if (!editing || rawAll) return;
    const target = e.target as Element;
    // Markers and links keep their own behaviour; a drag-selection is not an edit.
    if (target.closest('[data-thread-key], a')) return;
    if (!window.getSelection()?.isCollapsed) return;
    const block = blockOf(target);
    if (block) startEdit(block);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.target !== e.currentTarget.ownerDocument.activeElement) return;
    const block = blockOf(e.target);
    if (editing && !rawAll && block && block === e.target) {
      e.preventDefault();
      startEdit(block);
    }
  };

  const eol = detectEol(doc.text);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <article ref={articleRef} className="gonq-doc" data-testid="markdown-view" onClick={onClick} onKeyDown={onKeyDown}>
      {rawAll ? (
        <RawContext.Provider value={{ text: doc.text, editing }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={RAW_COMPONENTS} skipHtml>
            {source}
          </ReactMarkdown>
        </RawContext.Provider>
      ) : region === null ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={before} skipHtml>
          {source}
        </ReactMarkdown>
      ) : (
        <>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={before} skipHtml>
            {source.slice(0, region.from)}
          </ReactMarkdown>
          <BlockEditor
            value={toEditable(doc.text.slice(region.from, region.to))}
            onChange={(v) => editing?.onChange(fromEditable(v, eol))}
            onClose={() => editing?.onClose()}
          />
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={after} skipHtml>
            {source.slice(region.to)}
          </ReactMarkdown>
        </>
      )}
    </article>
  );
}
