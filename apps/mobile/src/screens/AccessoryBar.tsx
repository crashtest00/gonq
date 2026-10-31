/**
 * <AccessoryBar/>: the keyboard accessory toolbar of the editor screen ("Editing"): Undo, Redo and the same formats
 * as the desktop EditToolbar (FORMATS), each running its registry command (format.* , edit.undo, edit.redo) against the
 * editor. Pointer-down is cancelled so focus stays in the editor and the keyboard stays open. The row scrolls
 * sideways with edge fades as the cue (.m-accessory), every button is an .m-tap (44x44).
 */
import { Redo2, Undo2, type LucideIcon } from 'lucide-react';
import type { RefObject } from 'react';
import type { EditorHandle } from '@gonq/editor/editor/MarkdownEditor';
import { FORMATS } from '@gonq/editor/editor/formatTools';
import { runFileCommand } from '../shell/documents';

const items: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'edit.undo', label: 'Undo', icon: Undo2 },
  { id: 'edit.redo', label: 'Redo', icon: Redo2 },
  ...FORMATS.map((f) => ({ id: f.format === 'table' ? 'format.table.insert' : `format.${f.format}`, label: f.label, icon: f.icon })),
];

export function AccessoryBar({ editor, canUndo, canRedo }: { editor: RefObject<EditorHandle>; canUndo: boolean; canRedo: boolean }) {
  return (
    <div role="toolbar" aria-label="Editing" className="m-hscroll m-accessory" onPointerDown={(e) => e.preventDefault()}>
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
    </div>
  );
}
