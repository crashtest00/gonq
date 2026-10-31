/**
 * <TableBar/>: the touch equivalent of the desktop TableToolbar. It replaces the AccessoryBar while the caret is in a
 * table: a pinned "Formatting toolbar" button back, then every TOOLS entry (editor/tableTools, same order and labels
 * as desktop) in an HScroll, each running editor.tableAction. Disabled state and the pressed alignment come from the
 * TableTarget. Pointer-down is cancelled so the cell keeps the focus; if focus does leave for outside the editor and
 * the bar, the table is released (editor.releaseTable), as desktop's toolbar does.
 */
import { ChevronLeft } from 'lucide-react';
import type { RefObject } from 'react';
import type { EditorHandle } from '@gonq/editor/editor/MarkdownEditor';
import { TOOLS } from '@gonq/editor/editor/tableTools';
import type { TableTarget } from '@gonq/editor/editor/tables';
import { HScroll } from '../shell/HScroll';

const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

export function TableBar({ editor, target, onFormat }: { editor: RefObject<EditorHandle>; target: TableTarget; onFormat: () => void }) {
  return (
    <div
      role="toolbar"
      aria-label="Table"
      data-table-toolbar
      className="m-accessory"
      onPointerDown={keepFocus}
      onBlur={(e) => {
        const to = e.relatedTarget as Element | null;
        if (!to || (!e.currentTarget.contains(to) && !to.closest('.cm-editor'))) editor.current?.releaseTable();
      }}
    >
      <button type="button" className="m-tap m-pinned" aria-label="Formatting toolbar" onPointerDown={keepFocus} onClick={onFormat}>
        <ChevronLeft size={16} aria-hidden />
        Format
      </button>
      <span role="separator" aria-orientation="vertical" className="m-sep" />
      <HScroll label="Table actions" className="m-accessory-scroll">
        {TOOLS.map(({ op, label, icon, divider }) => (
          <span key={op} className="contents">
            {divider && <span role="separator" aria-orientation="vertical" className="m-sep" />}
            <button
              type="button"
              className="m-tap"
              aria-label={label}
              data-op={op}
              disabled={target.disabled.includes(op)}
              aria-pressed={op === 'left' || op === 'center' || op === 'right' ? target.align === op : undefined}
              onPointerDown={keepFocus}
              onClick={() => editor.current?.tableAction(op)}
            >
              {icon}
            </button>
          </span>
        ))}
      </HScroll>
    </div>
  );
}
