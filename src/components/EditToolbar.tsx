import { Bold, Italic, Link, List, ListChecks, ListOrdered, Redo2, Strikethrough, Table, Underline, Undo2, type LucideIcon } from 'lucide-react';
import { applyFormat, type Format } from './formatting';

const button =
  'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-control border-0 bg-transparent p-0 text-foreground hover:bg-surface disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-50';

const FORMATS: { format: Format; label: string; icon: LucideIcon; divider?: boolean }[] = [
  { format: 'bold', label: 'Bold', icon: Bold, divider: true },
  { format: 'italic', label: 'Italic', icon: Italic },
  { format: 'underline', label: 'Underline', icon: Underline },
  { format: 'strike', label: 'Strikethrough', icon: Strikethrough },
  { format: 'link', label: 'Insert link', icon: Link, divider: true },
  { format: 'bullet', label: 'Bullet list', icon: List },
  { format: 'numbered', label: 'Numbered list', icon: ListOrdered },
  { format: 'task', label: 'Checkbox list', icon: ListChecks },
  { format: 'table', label: 'Insert table', icon: Table },
];

/** Applies a format to the Markdown field that has focus, through the same input path as typing. */
function formatActiveField(format: Format) {
  const el = document.activeElement;
  if (!(el instanceof HTMLTextAreaElement) || !el.hasAttribute('data-block-editor')) return;
  let url = '';
  if (format === 'link') {
    // Ask for the address; cancelling (or an empty answer) changes nothing.
    const answer = window.prompt('Link URL', 'https://')?.trim();
    if (!answer || !el.isConnected) return;
    url = answer;
  }
  const next = applyFormat(format, el.value, el.selectionStart, el.selectionEnd, url);
  if (next.value !== el.value) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, next.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.setSelectionRange(next.start, next.end);
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
      <div role="toolbar" aria-label="Editing" className="flex h-[42px] shrink-0 items-center gap-1 overflow-x-auto px-3">
        <button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo} className={button}>
          <Undo2 size={16} aria-hidden />
        </button>
        <button type="button" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={onRedo} className={button}>
          <Redo2 size={16} aria-hidden />
        </button>
        {FORMATS.map(({ format, label, icon: Icon, divider }) => (
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
              className={button}
            >
              <Icon size={16} aria-hidden />
            </button>
          </span>
        ))}
      </div>
      <div className="h-px shrink-0 bg-border" />
    </>
  );
}
