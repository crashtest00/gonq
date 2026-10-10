import { Bold, Italic, Link, List, ListChecks, ListOrdered, Redo2, Strikethrough, Table, Underline, Undo2, type LucideIcon } from 'lucide-react';
import type { Format } from './formatting';

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

/** The link address to write; cancelling (or an empty answer) changes nothing. */
function askUrl(): string | null {
  return window.prompt('Link URL', 'https://')?.trim() || null;
}

export function EditToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFormat,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Applies a format to the editor's selection. */
  onFormat: (format: Format, url?: string) => void;
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
              // Keep focus (and the selection) in the editor.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (format !== 'link') return onFormat(format);
                const url = askUrl();
                if (url !== null) onFormat(format, url);
              }}
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
