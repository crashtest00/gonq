/** Footer bar with the document-wide Raw / Formatted switch: on the right is Formatted, on the left Raw. */
export function RawSwitch({ raw, onChange }: { raw: boolean; onChange: (raw: boolean) => void }) {
  const label = (active: boolean) =>
    `font-sans text-xs font-semibold ${active ? 'text-foreground' : 'text-muted-foreground'}`;
  return (
    <footer className="flex h-12 shrink-0 items-center justify-end gap-2.5 border-t border-border px-10">
      <span className={label(raw)}>Raw</span>
      <button
        type="button"
        role="switch"
        aria-checked={raw}
        aria-label="Raw Markdown"
        title="Toggle raw markdown"
        onClick={() => onChange(!raw)}
        className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full border-none p-0 transition-colors duration-[120ms] ease-in-out ${raw ? 'bg-border' : 'bg-primary'}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-[120ms] ease-in-out ${raw ? 'translate-x-0' : 'translate-x-4'}`}
        />
      </button>
      <span className={label(!raw)}>Formatted</span>
    </footer>
  );
}
