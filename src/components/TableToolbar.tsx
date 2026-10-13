import { useRef, type KeyboardEvent } from 'react';
import type { TableOp, TableTarget } from '../editor/tables';

const button =
  'flex h-[28px] min-w-[30px] shrink-0 items-center justify-center rounded-control border-0 bg-transparent px-1.5 text-[13px] text-foreground hover:bg-surface disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-50 aria-pressed:bg-border';

const TOOLS: { op: TableOp; label: string; text: string; divider?: boolean }[] = [
  { op: 'rowAbove', label: 'Insert row above', text: '↑▭' },
  { op: 'rowBelow', label: 'Insert row below', text: '↓▭' },
  { op: 'colLeft', label: 'Insert column left', text: '←▯' },
  { op: 'colRight', label: 'Insert column right', text: '→▯' },
  { op: 'left', label: 'Align column left', text: '⇤', divider: true },
  { op: 'center', label: 'Align column center', text: '↔' },
  { op: 'right', label: 'Align column right', text: '⇥' },
  { op: 'delRow', label: 'Delete row', text: '−▭', divider: true },
  { op: 'delCol', label: 'Delete column', text: '−▯' },
  { op: 'delTable', label: 'Delete table', text: '🗑' },
];

/**
 * The second toolbar row, shown while the caret is in a table. Buttons act on the focused cell and keep
 * the focus in it; the row is one tab stop with arrow-key navigation, Escape or Tab return to the cell.
 */
export function TableToolbar({
  target,
  onAction,
  onReturn,
  onLeave,
}: {
  target: TableTarget;
  onAction: (op: TableOp) => void;
  /** Puts the focus back in the cell. */
  onReturn: () => void;
  /** Focus left the row for somewhere other than the table. */
  onLeave: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const stop = useRef<TableOp>('rowAbove');

  const usable = () => Array.from(bar.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      onReturn();
      return;
    }
    const list = usable();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const n = list.length;
    list[e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n].focus();
  };

  return (
    <>
      <div
        ref={bar}
        role="toolbar"
        aria-label="Table"
        data-table-toolbar
        className="flex h-[36px] shrink-0 items-center overflow-x-auto px-3"
        onKeyDown={key}
        onFocus={(e) => {
          const op = (e.target as HTMLElement).dataset.op as TableOp | undefined;
          if (!op) return;
          stop.current = op;
          bar.current?.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.tabIndex = b.dataset.op === op ? 0 : -1));
        }}
        onBlur={(e) => {
          const to = e.relatedTarget as Element | null;
          if (!to || (!bar.current?.contains(to) && !to.closest('.cm-editor'))) onLeave();
        }}
      >
        <div className="mx-auto flex shrink-0 items-center gap-1">
          {TOOLS.map(({ op, label, text, divider }) => (
            <span key={op} className="contents">
              {divider && <span role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px shrink-0 bg-border" />}
              <button
                type="button"
                aria-label={label}
                title={label}
                data-op={op}
                disabled={target.disabled.includes(op)}
                aria-pressed={op === 'left' || op === 'center' || op === 'right' ? target.align === op : undefined}
                tabIndex={op === stop.current ? 0 : -1}
                // Keep focus (and the caret) in the cell while the button is pressed.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onAction(op)}
                className={button}
              >
                {text}
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="h-px shrink-0 bg-border" />
    </>
  );
}
