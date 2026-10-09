import { useEffect, useRef } from 'react';

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

const button =
  'h-8 rounded-control border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function UnsavedChangesDialog({ name, onChoose }: { name: string; onChoose: (choice: UnsavedChoice) => void }) {
  const saveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => saveRef.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChoose('cancel');
        }}
        className="w-[380px] rounded-container border border-border bg-surface p-5 [box-shadow:var(--shadow-dialog)]"
      >
        <h2 id="unsaved-title" className="m-0 mb-2 text-[15px] font-semibold">
          Save changes to {name}?
        </h2>
        <p className="m-0 mb-5 text-[13px] text-muted-foreground">Your changes will be lost if you don&rsquo;t save them.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onChoose('cancel')} className={`${button} border-border bg-transparent`}>
            Cancel
          </button>
          <button type="button" onClick={() => onChoose('discard')} className={`${button} border-destructive bg-transparent text-destructive`}>
            Don&rsquo;t save
          </button>
          <button
            type="button"
            ref={saveRef}
            onClick={() => onChoose('save')}
            className={`${button} border-primary bg-primary text-primary-foreground`}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
