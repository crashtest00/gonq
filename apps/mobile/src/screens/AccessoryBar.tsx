/**
 * <AccessoryBar/>: the keyboard accessory toolbar of the editor screen ("Editing"): Undo, Redo and the same formats
 * as the desktop EditToolbar (FORMATS), each running its registry command (format.* , edit.undo, edit.redo) against the
 * editor. Pointer-down is cancelled so focus stays in the editor and the keyboard stays open. The row scrolls
 * sideways with edge fades as the cue (HScroll), every button is an .m-tap (44x44). While the caret is in a table
 * (`table` is the editor's TableTarget) a pinned "Table" button swaps this bar for the TableBar, whose "Formatting
 * toolbar" button swaps back; leaving the table brings this bar back by itself.
 */
import { Redo2, Table2, Undo2, type LucideIcon } from 'lucide-react';
import { useState, type RefObject } from 'react';
import type { TableTarget } from '@gonq/editor/editor/tables';
import type { EditorHandle } from '@gonq/editor/editor/MarkdownEditor';
import { FORMATS } from '@gonq/editor/editor/formatTools';
import { runFileCommand } from '../shell/documents';
import { HScroll } from '../shell/HScroll';
import { TableBar } from './TableBar';

const items: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'edit.undo', label: 'Undo', icon: Undo2 },
  { id: 'edit.redo', label: 'Redo', icon: Redo2 },
  ...FORMATS.map((f) => ({ id: f.format === 'table' ? 'format.table.insert' : `format.${f.format}`, label: f.label, icon: f.icon })),
];

export function AccessoryBar({
  editor,
  canUndo,
  canRedo,
  table = null,
}: {
  editor: RefObject<EditorHandle>;
  canUndo: boolean;
  canRedo: boolean;
  table?: TableTarget | null;
}) {
  const [tableMode, setTableMode] = useState(false);
  if (table !== null && tableMode) return <TableBar editor={editor} target={table} onFormat={() => setTableMode(false)} />;
  return (
    <div role="toolbar" aria-label="Editing" className="m-accessory" onPointerDown={(e) => e.preventDefault()}>
      <HScroll label="Formatting actions" className="m-accessory-scroll">
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className="m-tap"
            aria-label={label}
            disabled={(id === 'edit.undo' && !canUndo) || (id === 'edit.redo' && !canRedo)}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => runFileCommand(id, { editor })}
          >
            <Icon size={20} aria-hidden />
          </button>
        ))}
      </HScroll>
      {table !== null && (
        <button type="button" className="m-tap m-pinned" aria-label="Table" onPointerDown={(e) => e.preventDefault()} onClick={() => setTableMode(true)}>
          <Table2 size={18} aria-hidden />
          Table
        </button>
      )}
    </div>
  );
}
