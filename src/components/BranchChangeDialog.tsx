/** Warning shown before a branch change closes the active GitHub document that has unsaved changes. */
import { useEffect, useRef } from 'react';

const button =
  'h-8 rounded-control border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** `onChoose(true)` closes the document and changes branch; `onChoose(false)` cancels. */
export function BranchChangeDialog({ name, onChoose }: { name: string; onChoose: (close: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-change-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChoose(false);
        }}
        className="w-[380px] rounded-container border border-border bg-surface p-5 [box-shadow:var(--shadow-dialog)]"
      >
        <h2 id="branch-change-title" className="m-0 mb-2 text-[15px] font-semibold">
          Change branch?
        </h2>
        <p className="m-0 mb-5 text-[13px] text-muted-foreground">
          Changing branches will close {name}, and any uncommitted changes will be permanently lost.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" ref={cancelRef} onClick={() => onChoose(false)} className={`${button} border-border bg-transparent`}>
            Cancel
          </button>
          <button type="button" onClick={() => onChoose(true)} className={`${button} border-destructive bg-transparent text-destructive`}>
            Close document
          </button>
        </div>
      </div>
    </div>
  );
}
