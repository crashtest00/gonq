import { useEffect, useRef, useState } from 'react';
import { DEFAULT_AUTHOR, MAX_AUTHOR_CHARS, authorNameProblem } from '../platform/settings';

const button =
  'h-8 rounded-control border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function PreferencesDialog({
  authorName,
  onSave,
  onClose,
}: {
  authorName: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(authorName);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const problem = authorNameProblem(value);
  const submit = async () => {
    if (problem !== null || saving) return;
    setSaving(true);
    try {
      await onSave(value);
      onClose();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        className="w-[380px] max-w-[90vw] rounded-container border border-border bg-surface p-5 [box-shadow:var(--shadow-dialog)]"
      >
        <h2 id="preferences-title" className="m-0 mb-3 text-[15px] font-semibold">
          Preferences
        </h2>
        <label htmlFor="preferences-author" className="mb-1 block text-[13px] font-semibold">
          Author name
        </label>
        <input
          id="preferences-author"
          ref={input}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setFailure(null);
          }}
          placeholder={DEFAULT_AUTHOR}
          maxLength={MAX_AUTHOR_CHARS + 20}
          aria-invalid={problem !== null}
          aria-describedby="preferences-author-hint"
          className="h-8 w-full rounded-control border border-border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p id="preferences-author-hint" role={problem || failure ? 'alert' : undefined} className={`m-0 mt-1 mb-5 text-[12px] ${problem || failure ? 'text-destructive' : 'text-muted-foreground'}`}>
          {problem ?? failure ?? `Written on the comments and replies you add.`}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`${button} border-border bg-transparent`}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={problem !== null || saving}
            className={`${button} border-primary bg-primary text-primary-foreground disabled:opacity-50`}
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
