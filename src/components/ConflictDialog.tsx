import { useEffect, useRef } from 'react';

export type ConflictChoice = 'overwrite' | 'cancel';

const button =
  'h-8 rounded-control border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Shown when a remote save finds the server's copy changed (or deleted) since the tab read it. */
export function ConflictDialog({ name, deleted, onChoose }: { name: string; deleted: boolean; onChoose: (choice: ConflictChoice) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChoose('cancel');
        }}
        className="w-[380px] rounded-container border border-border bg-surface p-5 [box-shadow:var(--shadow-dialog)]"
      >
        <h2 id="conflict-title" className="m-0 mb-2 text-[15px] font-semibold">
          {deleted ? `${name} was deleted on the server since you opened it.` : `${name} changed on the server since you opened it.`}
        </h2>
        <p className="m-0 mb-5 text-[13px] text-muted-foreground">
          {deleted ? 'Overwrite writes your version back as a new file.' : 'Overwrite replaces the server’s version with yours.'} Cancel keeps your changes unsaved.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" ref={cancelRef} onClick={() => onChoose('cancel')} className={`${button} border-border bg-transparent`}>
            Cancel
          </button>
          <button type="button" onClick={() => onChoose('overwrite')} className={`${button} border-destructive bg-transparent text-destructive`}>
            Overwrite
          </button>
        </div>
      </div>
    </div>
  );
}
