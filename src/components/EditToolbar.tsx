import { Redo2, Undo2 } from 'lucide-react';

const button =
  'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-control border-0 bg-transparent p-0 text-foreground hover:bg-surface disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-50';

export function EditToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
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
      </div>
      <div className="h-px shrink-0 bg-border" />
    </>
  );
}
