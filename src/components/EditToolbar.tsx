import { Bold, Italic, Link, List, ListChecks, ListOrdered, Redo2, Strikethrough, Table, Underline, Undo2, type LucideIcon } from 'lucide-react';
import { applyFormat, type Format } from './formatting';

const button =
  'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-control border-0 bg-transparent p-0 text-foreground hover:bg-surface disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-50';

const FORMATS: { format: Format; label: string; icon: LucideIcon; effect?: string; divider?: boolean }[] = [
  { format: 'bold', effect: 'font-bold', label: 'Bold', icon: Bold, divider: true },
  { format: 'italic', effect: 'italic', label: 'Italic', icon: Italic },
  { format: 'underline', effect: 'underline', label: 'Underline', icon: Underline },
  { format: 'strike', effect: 'line-through', label: 'Strikethrough', icon: Strikethrough },
  { format: 'link', label: 'Insert link', icon: Link, divider: true },
  { format: 'bullet', label: 'Bullet list', icon: List },
  { format: 'numbered', label: 'Numbered list', icon: ListOrdered },
  { format: 'task', label: 'Checkbox list', icon: ListChecks },
  { format: 'table', label: 'Insert table', icon: Table },
];

/** Applies a format to the text being edited: in place in the document, or in the Markdown field that has focus. */
function formatActiveField(format: Format) {
  const el = document.activeElement;
  const article = document.querySelector<HTMLElement>('[data-testid="markdown-view"][contenteditable="true"]');
  const field = el instanceof HTMLTextAreaElement && el.hasAttribute('data-block-editor') ? el : null;
  if (!field && !article) return;
  let url = '';
  if (format === 'link') {
    // Ask for the address; cancelling (or an empty answer) changes nothing.
    const answer = window.prompt('Link URL', 'https://')?.trim();
    if (!answer || !(field ?? article)!.isConnected) return;
    url = answer;
  }
  if (!field) {
    article!.dispatchEvent(new CustomEvent('gonq-format', { detail: { format, url } }));
    return;
  }
  const el2 = field;
  const next = applyFormat(format, el2.value, el2.selectionStart, el2.selectionEnd, url);
  if (next.value !== el2.value) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el2, next.value);
    el2.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el2.setSelectionRange(next.start, next.end);
}

export function EditToolbar({
  editing,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  /** A block is open for editing, so formats have a field to act on. */
  editing: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <>
      <div role="toolbar" aria-label="Editing" className="flex h-[42px] shrink-0 items-center overflow-x-auto px-3">
        {/* Auto margins centre the group when it fits and collapse to zero when it overflows, so it scrolls from the left edge. */}
        <div className="mx-auto flex shrink-0 items-center gap-1">
        <button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo} className={button}>
          <Undo2 size={16} aria-hidden />
        </button>
        <button type="button" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={onRedo} className={button}>
          <Redo2 size={16} aria-hidden />
        </button>
        {FORMATS.map(({ format, label, icon: Icon, effect, divider }) => (
          <span key={format} className="contents">
            {divider && <span role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px shrink-0 bg-border" />}
            <button
              type="button"
              aria-label={label}
              title={label}
              disabled={!editing}
              // Keep focus (and the selection) in the field being formatted.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => formatActiveField(format)}
              className={`${button} ${effect ?? ''}`}
            >
              <Icon size={16} aria-hidden />
            </button>
          </span>
        ))}
        </div>
      </div>
      <div className="h-px shrink-0 bg-border" />
    </>
  );
}
