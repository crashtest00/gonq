import { createContext, createElement, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  RESOLVED_COMMENT_LABEL,
  parseCommentMarkerFragment,
  parseCommentMarkers,
  parseCommentThreads,
} from '../comment-threads';
import type { FileAccess, OpenedDocument } from '../platform/files';
import { detectEol, fromEditable, splice, toEditable } from '../document/splice';
import { applyFormat, type Format } from './formatting';
import { IN_PLACE_TAGS, isVisible, offsetToPoint, piecesIn, pointToOffset, rehypeSourceSpans, snapCrlf, visibleIndex, visibleIndexToOffset } from './inplace';
import { keepMarkersWhole } from './atomicMarkers';
import { remarkIns } from './remarkIns';
import { MarkdownImage } from './MarkdownImage';
import { threadKey, type ThreadItem } from './threads';
import type { Segment } from './newThread';

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
  /** The caret moved in the field editing the block at `from`: its offset in the file. */
  onCaret?: (offset: number) => void;
  /** Typing in a block that is edited in place: replaces text[from, to); edits sharing `key` in quick succession are one undo step. */
  spliceText?: (from: number, to: number, insert: string, key: string) => void;
  /** Whether a block is being edited in place (true from the first click into the text until focus leaves). */
  onActive?: (active: boolean) => void;
  /** Rewrites text[from, to) in the file; a task checkbox uses it to flip its own `[ ]`. */
  onToggleTask?: (from: number, to: number, insert: string) => void;
  /**
   * Document-wide raw view: every block is shown as source, overriding per-block
   * state. Focusing a block's field makes it the `region`, so edits to it (which
   * may add or remove blank lines) keep a stable range until focus leaves.
   */
  rawAll?: boolean;
}

/**
 * Per rendered text node under a hast element, in document order: its source
 * range in the file, and whether the rendered text equals that source. A node
 * with no position of its own (an inline code span's text) takes its parent's.
 */
function textSegments(node: any, source: string, base: number): Segment[] {
  const out: Segment[] = [];
  const walk = (n: any, inherited: any) => {
    const here = n.position ?? inherited;
    if (n.type === 'text') {
      const start = here?.start.offset;
      const end = here?.end.offset;
      if (start === undefined || end === undefined) out.push([0, 0, 0]);
      else out.push([base + start, base + end, n.position !== undefined && source.slice(base + start, base + end) === n.value ? 1 : 0]);
    } else {
      for (const child of n.children ?? []) walk(child, here);
    }
  };
  walk(node, undefined);
  return out;
}

const REMARK_PLUGINS = [remarkGfm, remarkIns];

const BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'pre', 'blockquote', 'table', 'hr'] as const;

function BlockEditor({
  value,
  onChange,
  onClose,
  onFocus,
  onCaret,
  autoFocus = true,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onFocus?: () => void;
  /** Reports the caret as an offset into `value`, whenever it is placed or the text under it changes. */
  onCaret?: (offset: number) => void;
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
  useEffect(() => {
    const el = ref.current;
    if (el && el === el.ownerDocument.activeElement) onCaret?.(el.selectionStart);
  }, [value, onCaret]);
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
      onSelect={(e) => onCaret?.(e.currentTarget.selectionStart)}
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
      onCaret={(i) =>
        editing?.onCaret?.(range.from + fromEditable(toEditable(text.slice(range.from, range.to)).slice(0, i), detectEol(text)).length)
      }
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


/** Blocks that are edited where they are rendered; the others (tables, rules) still open the Markdown field. */
const IN_PLACE = new Set<string>(IN_PLACE_TAGS);

const hastText = (n: any): string => (n.type === 'text' ? String(n.value) : (n.children ?? []).map(hastText).join(''));

/** A place in the rendered document: an exact file offset, or a count of shown characters into a block not yet source-aware. */
type Place = { off: number } | { block: number; base: number };
const END = Number.MAX_SAFE_INTEGER;

const sameRanges = (a: BlockRange[], b: BlockRange[]) => a.length === b.length && a.every((r, i) => r.from === b[i].from && r.to === b[i].to);
const NO_RANGES: BlockRange[] = [];

export function MarkdownView({
  doc,
  files,
  threads = [],
  onOpenThread,
  editing,
  plain = false,
  showMarkers = true,
}: {
  doc: OpenedDocument;
  files: FileAccess;
  threads?: ThreadItem[];
  onOpenThread?: (key: string) => void;
  editing?: BlockEditing;
  /** Documentation, not a document with threads: examples of thread blocks inside it are shown, not hidden. */
  plain?: boolean;
  /** Show the Markdown syntax of the block(s) holding the caret (View > Show markers in active block). */
  showMarkers?: boolean;
}) {
  const source = useMemo(() => (plain ? doc.text.replace(/^﻿/, ' ') : maskThreadBlocks(doc.text)), [doc.text, plain]);
  const markers = useMemo(() => parseCommentMarkers(source), [source]);
  const articleRef = useRef<HTMLElement>(null);
  const rawAll = editing?.rawAll === true;
  const region = rawAll ? null : (editing?.region ?? null);

  // In-place editing: `mode` is null until the user clicks into the text; then it holds the blocks the caret touches.
  const [mode, setMode] = useState<{ ranges: BlockRange[] } | null>(null);
  // Where the selection was when an IME composition began; `rev` redraws the document from the source once it ends.
  const composing = useRef<{ lo: number; hi: number } | null>(null);
  const [rev, setRev] = useState(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const canEdit = editing !== undefined && editing.spliceText !== undefined && !rawAll && region === null;
  const ranges = mode?.ranges ?? NO_RANGES;
  /** Where the caret/selection goes once the next render has put the active blocks' source spans in place. */
  const pendingRef = useRef<{ anchor: Place; focus: Place } | null>(null);
  const selRef = useRef<{ anchor: number; focus: number } | null>(null);
  // The text as edits already made will leave it, before React has rendered them.
  const latestRef = useRef(doc.text);
  const expectedRef = useRef<string[]>([]);
  if (expectedRef.current.length === 0) latestRef.current = doc.text;
  const pointerRef = useRef(false);
  const live = useRef({ editing, showMarkers });
  live.current = { editing, showMarkers };

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
        const known = pos?.start.offset !== undefined && pos.end.offset !== undefined;
        const from = known ? base + pos.start.offset : -1;
        const to = known ? base + pos.end.offset : -1;
        const range = known ? { 'data-from': from, 'data-to': to } : {};
        const active = known && ranges.some((r) => r.from === from && r.to === to);
        const segs = tag === 'p' && node && !active ? { 'data-segs': JSON.stringify(textSegments(node, source, base)) } : {};
        const state = {
          ...(active ? { 'data-active': '' } : {}),
          // Inside an editable document, tables and rules are not text to type into.
          ...(mode !== null && !IN_PLACE.has(tag) ? { contentEditable: false, suppressContentEditableWarning: true } : {}),
        };
        return createElement(tag, { ...props, ...range, ...segs, ...state }, children);
      };
    }
    return {
      ...blocks,
      a({ node, href, children, ...props }) {
        const threadId = href === undefined ? undefined : parseCommentMarkerFragment(href);
        if (threadId !== undefined) {
          const resolved = (node ? hastText(node) : String(children)) === RESOLVED_COMMENT_LABEL;
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
      li({ node, children, ...props }: any) {
        const start = node?.position?.start.offset;
        const end = node?.position?.end.offset;
        const inActive = start !== undefined && end !== undefined && ranges.some((r) => base + start >= r.from && base + end <= r.to);
        return (
          <li
            {...props}
            {...(start === undefined ? {} : { 'data-item-from': base + start })}
            {...(node && !inActive ? { 'data-segs': JSON.stringify(textSegments(node, source, base)) } : {})}
          >
            {children}
          </li>
        );
      },
      input({ node: _node, type, checked, disabled: _disabled, ...props }: any) {
        if (type !== 'checkbox') return <input type={type} checked={checked} disabled {...props} />;
        return (
          <input
            type="checkbox"
            checked={checked === true}
            aria-label="Task done"
            onChange={(e) => toggleTask(e.currentTarget)}
          />
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
    [doc, files, markers, threads, onOpenThread, source, ranges, mode !== null],
  );
  const afterBase = region?.to ?? 0;
  const after = useMemo(
    () => componentsFor(afterBase),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, files, markers, threads, onOpenThread, afterBase, source, ranges, mode !== null],
  );
  const rehype = useMemo(() => [[rehypeSourceSpans, { source, ranges }]] as any, [source, ranges]);

  /** The block (a direct child of the article) a DOM node sits in, if it is a source block. */
  const blockOf = (node: EventTarget | null): HTMLElement | null => {
    let el = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
    while (el && el.parentElement !== articleRef.current) el = el.parentElement;
    return el instanceof HTMLElement && el.hasAttribute('data-from') ? el : null;
  };
  const topBlocks = (): HTMLElement[] =>
    Array.from(articleRef.current?.children ?? []).filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute('data-from'));
  const rangeOf = (b: HTMLElement): BlockRange => ({ from: Number(b.dataset.from), to: Number(b.dataset.to) });
  const editable = (b: HTMLElement) => IN_PLACE.has(b.tagName.toLowerCase());
  const startEdit = (block: HTMLElement) =>
    editing?.onStart({ from: Number(block.dataset.from), to: Number(block.dataset.to) });

  /** Flips the `[ ]`/`[x]` of the list item a checkbox sits in, in the file's own text. */
  const toggleTask = (box: HTMLInputElement) => {
    const from = Number(box.closest('li')?.dataset.itemFrom);
    if (!editing?.onToggleTask || Number.isNaN(from)) return;
    const m = /^(?:[-*+]|\d+[.)])[ \t]+\[( |x|X)\]/.exec(doc.text.slice(from, from + 40));
    if (!m) return;
    const at = from + m[0].length - 2;
    editing.onToggleTask(at, at + 1, m[1] === ' ' ? 'x' : ' ');
  };

  // ---- in-place editing -------------------------------------------------

  /** Where a point of the browser's selection is, in terms that survive the block being re-rendered with source spans. */
  const describe = (node: Node, offset: number): Place | null => {
    const article = articleRef.current;
    if (!article) return null;
    if (node === article) {
      const blocks = topBlocks();
      const next = Array.from(article.childNodes)
        .slice(offset)
        .find((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute('data-from'));
      const block = next ?? blocks[blocks.length - 1];
      return block && editable(block) ? { block: Number(block.dataset.from), base: next ? 0 : END } : null;
    }
    const block = blockOf(node);
    if (!block || !editable(block)) return null;
    if (block.hasAttribute('data-active')) {
      const off = pointToOffset(article, node, offset);
      if (off !== null) return { off };
    }
    return { block: Number(block.dataset.from), base: visibleIndex(block, node, offset) };
  };

  const resolve = (place: Place): [Node, number] | null => {
    const article = articleRef.current;
    if (!article) return null;
    if ('off' in place) return offsetToPoint(article, place.off, live.current.showMarkers);
    const block = topBlocks().find((b) => Number(b.dataset.from) === place.block);
    if (!block?.hasAttribute('data-active')) return null;
    const off = visibleIndexToOffset(block, place.base);
    return off === null ? null : offsetToPoint(article, off, live.current.showMarkers);
  };

  /** The editable blocks a selection range touches; a range that merely ends at the start of a block does not touch it. */
  const touched = (range: Range): HTMLElement[] => {
    const blocks = topBlocks().filter((b) => range.intersectsNode(b));
    const last = blocks[blocks.length - 1];
    if (!range.collapsed && blocks.length > 1 && last.contains(range.endContainer) && visibleIndex(last, range.endContainer, range.endOffset) === 0) blocks.pop();
    return blocks.filter(editable);
  };

  const selectionPlaces = (): { anchor: Place; focus: Place; blocks: HTMLElement[] } | null => {
    const article = articleRef.current;
    const sel = window.getSelection();
    if (!article || !sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
    if (!article.contains(sel.anchorNode) || !article.contains(sel.focusNode)) return null;
    const anchor = describe(sel.anchorNode, sel.anchorOffset);
    const focus = describe(sel.focusNode, sel.focusOffset);
    return anchor && focus ? { anchor, focus, blocks: touched(sel.getRangeAt(0)) } : null;
  };

  /** Starts editing in place (or moves it): the blocks the selection touches become source-aware and get the caret. */
  const begin = (clicked?: HTMLElement, atEnd = true) => {
    let places = selectionPlaces();
    if (places && clicked && !places.blocks.includes(clicked)) places = null;
    if (!places && clicked && editable(clicked)) {
      const place = { block: Number(clicked.dataset.from), base: atEnd ? END : 0 };
      places = { anchor: place, focus: place, blocks: [clicked] };
    }
    if (!places) return;
    pendingRef.current = { anchor: places.anchor, focus: places.focus };
    setMode({ ranges: places.blocks.map(rangeOf) });
  };

  /** Follows the caret: the blocks it touches show their markers, the others do not. */
  const sync = () => {
    if (modeRef.current === null || pendingRef.current !== null || composing.current !== null) return;
    const places = selectionPlaces();
    if (!places) return;
    const wanted = places.blocks.map(rangeOf);
    if (sameRanges(wanted, modeRef.current.ranges) && 'off' in places.anchor && 'off' in places.focus) {
      selRef.current = { anchor: places.anchor.off, focus: places.focus.off };
      live.current.editing?.onCaret?.(places.focus.off);
      return;
    }
    pendingRef.current = { anchor: places.anchor, focus: places.focus };
    setMode({ ranges: wanted });
  };
  const syncRef = useRef(sync);
  syncRef.current = sync;

  const exit = () => {
    composing.current = null;
    pendingRef.current = null;
    selRef.current = null;
    setMode(null);
  };

  // After a render: put the caret where it belongs now that the active blocks carry source spans.
  useLayoutEffect(() => {
    const article = articleRef.current;
    const pending = pendingRef.current;
    if (!article || !pending || mode === null) return;
    if ('off' in pending.anchor && 'off' in pending.focus) {
      // An edit may have split a block in two or joined two: the active blocks follow the caret.
      const lo = Math.min(pending.anchor.off, pending.focus.off);
      const hi = Math.max(pending.anchor.off, pending.focus.off);
      const wanted = topBlocks()
        .filter(editable)
        .filter((b) => !b.hasAttribute('data-virtual'))
        .filter((b) => (lo === hi ? Number(b.dataset.from) <= lo && lo <= Number(b.dataset.to) : Number(b.dataset.from) < hi && Number(b.dataset.to) > lo))
        .map(rangeOf);
      // Between blocks (a new line after Enter at the end of one): the caret gets an empty paragraph of its own.
      if (wanted.length === 0 && lo === hi) wanted.push({ from: lo, to: lo });
      if (!sameRanges(wanted, mode.ranges)) {
        setMode({ ranges: wanted });
        return;
      }
    }
    const a = resolve(pending.anchor);
    const f = resolve(pending.focus);
    if (!a || !f) {
      pendingRef.current = null;
      return;
    }
    pendingRef.current = null;
    if (!article.contains(article.ownerDocument.activeElement)) article.focus({ preventScroll: true });
    window.getSelection()?.setBaseAndExtent(a[0], a[1], f[0], f[1]);
    const offs = [pending.anchor, pending.focus].map((p) => ('off' in p ? p.off : pointToOffset(article, ...(resolve(p) as [Node, number]))));
    if (offs[0] !== null && offs[1] !== null) {
      selRef.current = { anchor: offs[0], focus: offs[1] };
      live.current.editing?.onCaret?.(offs[1]);
    }
  }, [mode, doc.text, rev]);

  // Text changed by anything but typing here (undo, a comment, a task box, another tab): the caret's place is gone.
  useLayoutEffect(() => {
    const queue = expectedRef.current;
    const i = queue.lastIndexOf(doc.text);
    if (i >= 0) expectedRef.current = queue.slice(i + 1);
    else if (modeRef.current !== null) exit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.text]);
  useEffect(() => {
    if (!canEdit && mode !== null) exit();
  }, [canEdit, mode]);
  const isEditing = mode !== null;
  useEffect(() => {
    editing?.onActive?.(isEditing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  /** The selection in file offsets, read from the document as it is now. */
  const currentOffsets = (): [number, number] | null => {
    const article = articleRef.current;
    const sel = window.getSelection();
    if (!article || !sel || !sel.anchorNode || !sel.focusNode) return null;
    const a = pointToOffset(article, sel.anchorNode, sel.anchorOffset);
    const f = pointToOffset(article, sel.focusNode, sel.focusOffset);
    return a === null || f === null ? null : [Math.min(a, f), Math.max(a, f)];
  };

  /** Writes an edit into the file and moves the caret to `after` (default: just past the inserted text). */
  const apply = (from: number, to: number, insert: string, after?: [number, number]) => {
    const prev = latestRef.current;
    let next = splice(prev, from, to, insert);
    let caret = from + insert.length;
    if (!after) {
      // A thread marker is one atomic unit: edits that would split it are repaired.
      const repaired = keepMarkersWhole(prev, next);
      if (repaired) {
        next = repaired.value;
        caret = repaired.caret;
      }
    }
    if (next === prev) return;
    let p = 0;
    const max = Math.min(prev.length, next.length);
    while (p < max && prev[p] === next[p]) p++;
    let s = 0;
    while (s < max - p && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
    const key = `inplace-${modeRef.current?.ranges[0]?.from ?? 0}`;
    live.current.editing?.spliceText?.(p, prev.length - s, next.slice(p, next.length - s), key);
    latestRef.current = next;
    expectedRef.current.push(next);
    const delta = next.length - prev.length;
    const removedTo = prev.length - s;
    const mapped = (modeRef.current?.ranges ?? []).map((r) =>
      r.to < p ? r : r.from > removedTo ? { from: r.from + delta, to: r.to + delta } : { from: Math.min(r.from, p), to: Math.max(r.to, removedTo) + delta },
    );
    const [c1, c2] = after ?? [caret, caret];
    pendingRef.current = { anchor: { off: c1 }, focus: { off: c2 } };
    setMode({ ranges: mapped });
  };

  /** Range of the one visible character before (or after) `at` inside `block`, or undefined when the block has none that way (null: it has one that must stay). */
  const charStep = (block: HTMLElement | null, at: number, dir: -1 | 1): [number, number] | null | undefined => {
    const article = articleRef.current;
    if (!article || !block) return undefined;
    const text = latestRef.current;
    const shown = live.current.showMarkers;
    const pieces = piecesIn(article).filter((p) => p.len > 0 && isVisible(p, shown) && blockOf(p.el) === block);
    const piece = dir < 0 ? pieces.filter((p) => p.s < at).pop() : pieces.find((p) => p.s + p.len > at);
    if (!piece) return undefined;
    // A thread marker is only ever removed by a selection that covers it.
    if (piece.el.closest('.gonq-marker')) return null;
    if (piece.kind === 'at') return [piece.s, piece.s + piece.len];
    if (dir < 0) {
      const end = Math.min(at, piece.s + piece.len);
      const width = text.slice(end - 2, end) === '\r\n' ? 2 : /[\uDC00-\uDFFF]/.test(text[end - 1] ?? '') ? 2 : 1;
      return [end - width, end];
    }
    let begin = Math.max(at, piece.s);
    // The \r of a \r\n is syntax on screen; the break is still one unit.
    if (text[begin] === '\n' && text[begin - 1] === '\r' && begin - 1 >= at) begin -= 1;
    const width = text.slice(begin, begin + 2) === '\r\n' ? 2 : /[\uD800-\uDBFF]/.test(text[begin] ?? '') ? 2 : 1;
    return [begin, begin + width];
  };

  const blockAtCaret = () => {
    const sel = window.getSelection();
    return sel?.focusNode ? blockOf(sel.focusNode) : null;
  };

  /**
   * What Backspace (Delete) removes from `at`: one visible character, or at a block's edge the blank-line
   * separator that joins it to its neighbour. Source that is not whitespace (a link reference definition,
   * a comment, a thread block) is never part of that, and code, tables and HTML are never joined to text.
   */
  const stepRange = (at: number, dir: -1 | 1): [number, number] | null => {
    const block = blockAtCaret();
    const one = charStep(block, at, dir);
    if (one !== undefined) return one;
    if (!block) return null;
    const text = latestRef.current;
    const blocks = topBlocks();
    const i = blocks.indexOf(block);
    if (dir < 0) {
      // Hidden syntax at the start of the block goes first (a heading becomes a paragraph), then the block joins the one before.
      const lead = piecesIn(block).filter((p) => p.kind === 'mk' && p.s + p.len <= at);
      if (!live.current.showMarkers && lead.length > 0) return [lead[0].s, at];
    }
    const [first, second] = dir < 0 ? [blocks[i - 1], block] : [block, blocks[i + 1]];
    if (!first || !second) return null;
    const joinable = (b: HTMLElement) => editable(b) && b.tagName !== 'PRE';
    if (!joinable(first) || !joinable(second)) return null;
    const gap: [number, number] = [Number(first.dataset.to), Number(second.dataset.from)];
    return /\S/.test(text.slice(gap[0], gap[1])) ? null : gap;
  };

  /** The text Enter inserts at `at`: a new paragraph, or a new list item that carries on the marker. */
  const paragraphBreak = (at: number, eol: string): string | null => {
    const text = latestRef.current;
    const block = topBlocks().find((b) => Number(b.dataset.from) <= at && at <= Number(b.dataset.to) && !b.hasAttribute('data-virtual'));
    const tag = block?.tagName.toLowerCase();
    if (tag === 'pre') return eol;
    const lineStart = text.lastIndexOf('\n', at - 1) + 1;
    const line = text.slice(lineStart, at);
    const quote = /^(?:[ \t]{0,3}>[ \t]?)*/.exec(line)![0];
    if (tag === 'ul' || tag === 'ol') {
      const m = /^([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)(\[[ xX]\][ \t]+)?/.exec(text.slice(lineStart + quote.length, at + 400).split('\n')[0]);
      if (m) {
        if (at < lineStart + quote.length + m[1].length) return null;
        return eol + quote + m[1] + (m[2] ? '[ ] ' : '');
      }
      // A continuation line of an item: a new paragraph of the same item.
      const indent = /^[ \t]*/.exec(line.slice(quote.length))![0];
      return eol + eol + quote + indent;
    }
    if (quote) return eol + quote.trimEnd() + eol + quote;
    return eol + eol;
  };

  /** The range a word / line delete takes, one visible character at a time so hidden syntax in between is spared. */
  const bigStep = (at: number, dir: -1 | 1, unit: 'word' | 'line'): { from: number; to: number; insert: string } | null => {
    const block = blockAtCaret();
    const text = latestRef.current;
    const word = /[\p{L}\p{N}_]/u;
    const removed: [number, number][] = [];
    let cur = at;
    let cls: 'space' | 'word' | 'punct' | null = null;
    for (;;) {
      const r = charStep(block, cur, dir);
      if (!r) break;
      const ch = text.slice(r[0], r[1]);
      if (unit === 'line') {
        if (/^\r?\n$/.test(ch)) break;
      } else {
        const c = /^\s+$/.test(ch) ? 'space' : word.test(ch) ? 'word' : 'punct';
        if (cls === null) {
          if (c !== 'space') cls = c;
        } else if (c !== cls) break;
      }
      removed.push(r);
      cur = dir < 0 ? r[0] : r[1];
    }
    if (removed.length === 0) return null;
    const lo = Math.min(...removed.map((r) => r[0]));
    const hi = Math.max(...removed.map((r) => r[1]));
    let insert = '';
    for (let k = lo; k < hi; ) {
      const hit = removed.find((r) => r[0] === k);
      if (hit) k = hit[1];
      else insert += text[k++];
    }
    return { from: lo, to: hi, insert };
  };

  const handleBeforeInput = (e: InputEvent) => {
    if (modeRef.current === null) return;
    if ((e.target as Element | null)?.closest?.('[data-block-editor]')) return;
    const type = e.inputType;
    // The browser owns text being composed (IME); the composed text is written to the file when the composition ends.
    if (/Composition/.test(type)) return;
    e.preventDefault();
    const current = currentOffsets();
    if (!current) return;
    const text = latestRef.current;
    const eol = detectEol(text);
    let [lo, hi] = snapCrlf(text, current[0], current[1]);
    const typed = () => e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
    const put = (s: string) => {
      if (s !== '') apply(lo, hi, fromEditable(toEditable(s), eol));
    };
    const remove = (dir: -1 | 1) => {
      const r = lo === hi ? stepRange(lo, dir) : [lo, hi];
      if (r) apply(r[0], r[1], '');
    };
    const removeMore = (dir: -1 | 1, unit: 'word' | 'line') => {
      if (lo !== hi) return remove(dir);
      const big = bigStep(lo, dir, unit);
      if (!big) return remove(dir);
      apply(big.from, big.to, big.insert, [dir < 0 ? big.from + big.insert.length : lo, dir < 0 ? big.from + big.insert.length : lo]);
    };
    if (type === 'insertReplacementText') {
      // Spellcheck and autocorrect name the text to replace; the caret is not it.
      const target = e.getTargetRanges?.()[0];
      const article = articleRef.current;
      if (target && article) {
        const a = pointToOffset(article, target.startContainer, target.startOffset);
        const b = pointToOffset(article, target.endContainer, target.endOffset);
        if (a !== null && b !== null) [lo, hi] = snapCrlf(text, Math.min(a, b), Math.max(a, b));
      }
      put(typed());
    } else if (type === 'insertText' || type === 'insertFromPaste' || type === 'insertFromDrop') put(typed());
    else if (type === 'insertParagraph') {
      if (blockAtCaret()?.hasAttribute('data-virtual')) return;
      const lead = paragraphBreak(lo, eol);
      if (lead !== null) apply(lo, hi, lead);
    } else if (type === 'insertLineBreak') apply(lo, hi, eol);
    else if (type === 'deleteWordBackward') removeMore(-1, 'word');
    else if (type === 'deleteWordForward') removeMore(1, 'word');
    else if (type === 'deleteSoftLineBackward' || type === 'deleteHardLineBackward') removeMore(-1, 'line');
    else if (type === 'deleteSoftLineForward' || type === 'deleteHardLineForward') removeMore(1, 'line');
    else if (/^delete.*Backward$/.test(type)) remove(-1);
    else if (/^delete.*Forward$/.test(type)) remove(1);
    else if (type === 'deleteByCut' || type === 'deleteByDrag') {
      if (lo < hi) remove(-1);
    } else if (type === 'deleteContent') remove(-1);
  };

  const onCompositionStart = () => {
    const sel = currentOffsets();
    if (modeRef.current !== null && sel) composing.current = { lo: sel[0], hi: sel[1] };
  };
  /** The browser put the composed text in the DOM only; write it to the file and draw the block again from the source. */
  const onCompositionEnd = (e: CompositionEvent) => {
    const at = composing.current;
    composing.current = null;
    if (!at || modeRef.current === null) return;
    const eol = detectEol(latestRef.current);
    const data = e.data ?? '';
    const caret = data === '' ? [at.lo, at.hi] : [at.lo + fromEditable(toEditable(data), eol).length];
    pendingRef.current = { anchor: { off: caret[0] }, focus: { off: caret[caret.length - 1] } };
    if (data !== '') apply(at.lo, at.hi, fromEditable(toEditable(data), eol));
    setRev((n) => n + 1);
  };

  const handleFormat = (e: Event) => {
    const m = modeRef.current;
    const sel = currentOffsets() ?? (selRef.current && [Math.min(selRef.current.anchor, selRef.current.focus), Math.max(selRef.current.anchor, selRef.current.focus)]);
    if (!m || m.ranges.length === 0 || !sel) return;
    const { format, url } = (e as CustomEvent<{ format: Format; url?: string }>).detail;
    const text = latestRef.current;
    const eol = detectEol(text);
    const from = Math.min(...m.ranges.map((r) => r.from));
    const to = Math.max(...m.ranges.map((r) => r.to));
    const rel = (n: number) => toEditable(text.slice(from, Math.min(Math.max(n, from), to))).length;
    const value = toEditable(text.slice(from, to));
    const next = applyFormat(format, value, rel(sel[0]), rel(sel[1]), url ?? '');
    if (next.value === value) return;
    const abs = (n: number) => from + fromEditable(next.value.slice(0, n), eol).length;
    apply(from, to, fromEditable(next.value, eol), [abs(next.start), abs(next.end)]);
  };

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const onInput = (e: Event) => handleBeforeInputRef.current(e as InputEvent);
    const onFormat = (e: Event) => handleFormatRef.current(e);
    const onCompStart = () => compStartRef.current();
    const onCompEnd = (e: Event) => compEndRef.current(e as CompositionEvent);
    const onSelection = () => syncRef.current();
    article.addEventListener('beforeinput', onInput);
    article.addEventListener('gonq-format', onFormat);
    article.addEventListener('compositionstart', onCompStart);
    article.addEventListener('compositionend', onCompEnd);
    document.addEventListener('selectionchange', onSelection);
    return () => {
      article.removeEventListener('beforeinput', onInput);
      article.removeEventListener('gonq-format', onFormat);
      article.removeEventListener('compositionstart', onCompStart);
      article.removeEventListener('compositionend', onCompEnd);
      document.removeEventListener('selectionchange', onSelection);
    };
  }, []);
  const handleBeforeInputRef = useRef(handleBeforeInput);
  handleBeforeInputRef.current = handleBeforeInput;
  const compStartRef = useRef(onCompositionStart);
  compStartRef.current = onCompositionStart;
  const compEndRef = useRef(onCompositionEnd);
  compEndRef.current = onCompositionEnd;
  const handleFormatRef = useRef(handleFormat);
  handleFormatRef.current = handleFormat;

  const onClick = (e: MouseEvent) => {
    if (!editing || rawAll) return;
    const target = e.target as Element;
    if (target.closest('[data-block-editor]')) return;
    // Markers and links keep their own behaviour; neither starts an edit.
    if (target.closest('[data-thread-key], input')) return;
    const link = target.closest('a');
    if (link) {
      if (mode !== null && (e.ctrlKey || e.metaKey)) window.open(link.href, '_blank', 'noopener,noreferrer');
      return;
    }
    const block = blockOf(target);
    if (block && !editable(block)) return startEdit(block);
    if (mode === null) begin(block ?? undefined);
    else sync();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && mode !== null && !e.nativeEvent.isComposing && composing.current === null) {
      e.preventDefault();
      exit();
      (e.currentTarget.ownerDocument.activeElement as HTMLElement | null)?.blur?.();
      return;
    }
    if (e.key === 'Tab' && mode !== null) {
      // Tab moves the caret to the start of the next (previous) block.
      const sel = window.getSelection();
      const here = sel?.focusNode ? blockOf(sel.focusNode) : null;
      const blocks = topBlocks().filter((b) => !b.hasAttribute('data-virtual'));
      const next = here ? blocks[blocks.indexOf(here) + (e.shiftKey ? -1 : 1)] : undefined;
      if (next) {
        e.preventDefault();
        next.focus();
      }
      return;
    }
    if (e.key !== 'Enter' || mode !== null || e.target !== e.currentTarget.ownerDocument.activeElement) return;
    const block = blockOf(e.target);
    if (editing && !rawAll && block && block === e.target) {
      e.preventDefault();
      if (editable(block)) begin(block);
      else startEdit(block);
    }
  };
  // While editing, tabbing onto a block puts the caret at its start.
  const onFocus = (e: FocusEvent) => {
    if (modeRef.current === null || !canEdit || pointerRef.current || e.target !== blockOf(e.target)) return;
    const block = e.target as HTMLElement;
    if (!editable(block)) return;
    const place = { block: Number(block.dataset.from), base: 0 };
    pendingRef.current = { anchor: place, focus: place };
    setMode({ ranges: [rangeOf(block)] });
  };
  const onBlur = (e: FocusEvent) => {
    if (modeRef.current !== null && !e.currentTarget.contains(e.relatedTarget as Node | null)) exit();
  };

  const eol = detectEol(doc.text);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <article
      ref={articleRef}
      className="gonq-doc"
      data-testid="markdown-view"
      data-markers={showMarkers ? 'on' : 'off'}
      {...(mode !== null ? { contentEditable: true, suppressContentEditableWarning: true, tabIndex: -1 } : {})}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      onMouseDown={() => {
        pointerRef.current = true;
        setTimeout(() => (pointerRef.current = false), 0);
      }}
    >
      {rawAll ? (
        <RawContext.Provider value={{ text: doc.text, editing }}>
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={RAW_COMPONENTS} skipHtml>
            {source}
          </ReactMarkdown>
        </RawContext.Provider>
      ) : region === null ? (
        <ReactMarkdown key={rev} remarkPlugins={REMARK_PLUGINS} rehypePlugins={rehype} components={before} skipHtml>
          {source}
        </ReactMarkdown>
      ) : (
        <>
          <ReactMarkdown key={rev} remarkPlugins={REMARK_PLUGINS} components={before} skipHtml>
            {source.slice(0, region.from)}
          </ReactMarkdown>
          <BlockEditor
            value={toEditable(doc.text.slice(region.from, region.to))}
            onChange={(v) => editing?.onChange(fromEditable(v, eol))}
            onCaret={(i) =>
              editing?.onCaret?.(region.from + fromEditable(toEditable(doc.text.slice(region.from, region.to)).slice(0, i), eol).length)
            }
            onClose={() => editing?.onClose()}
          />
          <ReactMarkdown key={rev} remarkPlugins={REMARK_PLUGINS} components={after} skipHtml>
            {source.slice(region.to)}
          </ReactMarkdown>
        </>
      )}
    </article>
  );
}
