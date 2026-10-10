import { syntaxTree } from '@codemirror/language';
import { type Extension, type Range, RangeSet } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { parseCommentMarkerFragment } from '../comment-threads';

/**
 * Live preview: styles the Markdown constructs in place and hides their syntax characters
 * until the caret or selection touches the construct. Decorations are built from the syntax
 * tree, for the visible part of the document only. Nothing here edits text except the task
 * checkbox, which toggles `[ ]` / `[x]`.
 */

class Bullet extends WidgetType {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-bullet';
    el.textContent = '•';
    return el;
  }
  eq() {
    return true;
  }
}

class Checkbox extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: Checkbox) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span');
    el.className = `cm-task-box${this.checked ? ' cm-task-box-checked' : ''}`;
    el.setAttribute('role', 'checkbox');
    el.setAttribute('aria-checked', String(this.checked));
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const at = view.posAtDOM(el);
      // The widget stands for `[ ]` / `[x]`: flip the character between the brackets.
      const mark = view.state.sliceDoc(at, at + 3);
      if (!/^\[[ xX]\]$/.test(mark)) return;
      view.dispatch({ changes: { from: at + 1, to: at + 2, insert: mark[1] === ' ' ? 'x' : ' ' }, userEvent: 'input.toggle' });
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

const BULLET = Decoration.replace({ widget: new Bullet() });
const HIDDEN = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });
const line = (cls: string) => Decoration.line({ class: cls });

const HEADING = /^(?:ATX|Setext)Heading(\d)$/;

interface Built {
  all: DecorationSet;
  atomic: DecorationSet;
}

function build(view: EditorView): Built {
  const { state } = view;
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const ranges = view.visibleRanges;
  if (ranges.length === 0) return { all: Decoration.none, atomic: Decoration.none };
  const from = ranges[0].from;
  const to = ranges[ranges.length - 1].to;

  // A read-only view has no caret to reveal anything.
  const editable = state.facet(EditorView.editable);
  const touches = (a: number, b: number) => editable && state.selection.ranges.some((r) => r.from <= b && r.to >= a);
  const hide = (a: number, b: number, deco: Decoration = HIDDEN) => {
    // A replaced range may not contain a line break when it comes from a plugin.
    if (a >= b || doc.sliceString(a, b).includes('\n')) return;
    out.push(deco.range(a, b));
    atomic.push(deco.range(a, b));
  };
  const lineClass = (a: number, b: number, cls: string) => {
    const first = doc.lineAt(Math.max(a, from)).number;
    const last = doc.lineAt(Math.min(b, to)).number;
    for (let n = first; n <= last; n++) out.push(line(cls).range(doc.line(n).from));
  };
  const marks = (node: SyntaxNode, name: string, show: boolean) => {
    for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name && !show) hide(c.from, c.to);
  };
  const insTags: { from: number; to: number; open: boolean }[] = [];

  syntaxTree(state).iterate({
    from,
    to,
    enter(n) {
      const name = n.name;
      const heading = HEADING.exec(name);
      if (heading) {
        lineClass(n.from, n.to, `cm-heading cm-heading-${heading[1]}`);
        const show = touches(n.from, n.to);
        for (let c = n.node.firstChild; c; c = c.nextSibling) {
          if (c.name !== 'HeaderMark' || show) continue;
          if (name.startsWith('Setext')) {
            hide(c.from, c.to);
            out.push(line('cm-hidden-line').range(doc.lineAt(c.from).from));
          } else {
            let end = c.to;
            while (end < doc.length && /[ \t]/.test(doc.sliceString(end, end + 1))) end++;
            hide(c.from, end);
          }
        }
        return;
      }
      switch (name) {
        case 'StrongEmphasis':
        case 'Emphasis':
        case 'Strikethrough':
        case 'InlineCode': {
          const cls = { StrongEmphasis: 'cm-strong', Emphasis: 'cm-em', Strikethrough: 'cm-strike', InlineCode: 'cm-code' }[name];
          out.push(mark(cls).range(n.from, n.to));
          const markName = { StrongEmphasis: 'EmphasisMark', Emphasis: 'EmphasisMark', Strikethrough: 'StrikethroughMark', InlineCode: 'CodeMark' }[name];
          marks(n.node, markName, touches(n.from, n.to));
          return;
        }
        case 'Image':
          return false; // out of scope: shown as source
        case 'Link': {
          const kids: SyntaxNode[] = [];
          for (let c = n.node.firstChild; c; c = c.nextSibling) kids.push(c);
          const url = kids.find((c) => c.name === 'URL');
          const lm = kids.filter((c) => c.name === 'LinkMark');
          // Comment-thread markers and reference links stay as source.
          if (!url || lm.length < 2 || parseCommentMarkerFragment(doc.sliceString(url.from, url.to)) !== undefined) return false;
          out.push(Decoration.mark({ class: 'cm-link', attributes: { 'data-href': doc.sliceString(url.from, url.to) } }).range(lm[0].to, lm[1].from));
          if (!touches(n.from, n.to)) {
            hide(n.from, lm[0].to);
            hide(lm[1].from, n.to);
          }
          return;
        }
        case 'HTMLTag': {
          const tag = doc.sliceString(n.from, n.to).toLowerCase();
          if (tag === '<ins>') insTags.push({ from: n.from, to: n.to, open: true });
          else if (tag === '</ins>') insTags.push({ from: n.from, to: n.to, open: false });
          return;
        }
        case 'Blockquote':
          lineClass(n.from, n.to, 'cm-quote');
          return;
        case 'QuoteMark': {
          const l = doc.lineAt(n.from);
          if (touches(l.from, l.to)) return;
          let end = n.to;
          if (doc.sliceString(end, end + 1) === ' ') end++;
          hide(n.from, end);
          return;
        }
        case 'HorizontalRule':
          lineClass(n.from, n.to, 'cm-hr');
          if (!touches(n.from, n.to)) hide(n.from, n.to);
          return;
        case 'FencedCode': {
          lineClass(n.from, n.to, 'cm-codeblock');
          const first = doc.lineAt(n.from);
          if (first.from >= from) out.push(line('cm-code-first').range(first.from));
          const fences: SyntaxNode[] = [];
          for (let c = n.node.firstChild; c; c = c.nextSibling) if (c.name === 'CodeMark' || c.name === 'CodeInfo') fences.push(c);
          const closing = n.node.lastChild?.name === 'CodeMark' && n.node.getChildren('CodeMark').length > 1;
          const last = doc.lineAt(n.to);
          if (closing && last.to <= to) out.push(line('cm-code-last').range(last.from));
          if (!touches(n.from, n.to)) {
            for (const f of fences) {
              hide(f.from, f.to);
              out.push(line('cm-hidden-line').range(doc.lineAt(f.from).from));
            }
          }
          return false;
        }
        case 'CodeBlock':
          lineClass(n.from, n.to, 'cm-codeblock');
          return false;
        case 'ListMark': {
          const item = n.node.parent;
          const task = item?.getChild('Task');
          const l = doc.lineAt(n.from);
          const near = touches(l.from, l.to);
          const bullet = /^[-*+]$/.test(doc.sliceString(n.from, n.to));
          if (task) {
            if (!near) hide(n.from, Math.min(task.from, n.to + 1));
          } else if (bullet && !near) hide(n.from, n.to, BULLET);
          else if (!bullet) out.push(mark('cm-list-number').range(n.from, n.to));
          return;
        }
        case 'TaskMarker': {
          const checked = doc.sliceString(n.from, n.to) !== '[ ]';
          hide(n.from, n.to, Decoration.replace({ widget: new Checkbox(checked) }));
          if (checked && n.node.parent) out.push(mark('cm-task-done').range(n.to, n.node.parent.to));
          return;
        }
      }
    },
  });

  // `<ins>…</ins>` pairs are underlined.
  const open: { from: number; to: number }[] = [];
  for (const t of insTags) {
    if (t.open) open.push(t);
    else {
      const o = open.pop();
      if (!o) continue;
      out.push(mark('cm-ins').range(o.from, t.to));
      if (!touches(o.from, t.to)) {
        hide(o.from, o.to);
        hide(t.from, t.to);
      }
    }
  }

  return { all: Decoration.set(out, true), atomic: RangeSet.of(atomic, true) };
}

const plugin = ViewPlugin.fromClass(
  class {
    built: Built;
    constructor(view: EditorView) {
      this.built = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) this.built = build(u.view);
    }
  },
  {
    decorations: (v) => v.built.all,
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.built.atomic ?? Decoration.none),
  },
);

/** Opens an http(s)/mailto link on Ctrl/Cmd+click; the address is the hidden part of `[label](address)`. */
function linkClicks(open: (href: string) => void): Extension {
  return EditorView.domEventHandlers({
    click(e) {
      if (!(e.ctrlKey || e.metaKey) || !(e.target instanceof HTMLElement)) return false;
      const href = e.target.closest<HTMLElement>('.cm-link')?.dataset.href;
      if (href === undefined || !/^(https?:|mailto:)/i.test(href)) return false;
      e.preventDefault();
      open(href);
      return true;
    },
  });
}

export function livePreview(open: (href: string) => void): Extension {
  return [plugin, linkClicks(open)];
}
