/**
 * The table toolbar row under EditToolbar, shown while the editor reports a table target: insert/delete
 * row/column, alignment, delete table. Exports TOOLS, mirrored by MenuBar's Table sub-menu.
 */
import { AlignCenter, AlignLeft, AlignRight, BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, Columns3, Minus, Rows3, Trash2, type LucideIcon } from 'lucide-react';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { TableOp, TableTarget } from '../editor/tables';

const button =
  'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-control border-0 bg-transparent p-0 text-foreground hover:bg-surface disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-50 aria-pressed:bg-border';

const minus = (icon: LucideIcon): ReactNode => {
  const Icon = icon;
  return (
    <>
      <Minus size={10} aria-hidden />
      <Icon size={15} aria-hidden />
    </>
  );
};

export const TOOLS: { op: TableOp; label: string; icon: ReactNode; divider?: boolean }[] = [
  { op: 'rowAbove', label: 'Insert row above', icon: <BetweenHorizontalStart size={16} aria-hidden /> },
  { op: 'rowBelow', label: 'Insert row below', icon: <BetweenHorizontalEnd size={16} aria-hidden /> },
  { op: 'colLeft', label: 'Insert column left', icon: <BetweenVerticalStart size={16} aria-hidden /> },
  { op: 'colRight', label: 'Insert column right', icon: <BetweenVerticalEnd size={16} aria-hidden /> },
  { op: 'left', label: 'Align column left', icon: <AlignLeft size={16} aria-hidden />, divider: true },
  { op: 'center', label: 'Align column center', icon: <AlignCenter size={16} aria-hidden /> },
  { op: 'right', label: 'Align column right', icon: <AlignRight size={16} aria-hidden /> },
  { op: 'delRow', label: 'Delete row', icon: minus(Rows3), divider: true },
  { op: 'delCol', label: 'Delete column', icon: minus(Columns3) },
  { op: 'delTable', label: 'Delete table', icon: <Trash2 size={16} aria-hidden /> },
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
          {TOOLS.map(({ op, label, icon, divider }) => (
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
                {icon}
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="h-px shrink-0 bg-border" />
    </>
  );
}
