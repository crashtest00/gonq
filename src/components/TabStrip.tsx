export function TabStrip({ name }: { name: string | null }) {
  return (
    <>
      <div className="flex h-[46px] shrink-0 items-center overflow-x-auto px-3">
        {name !== null && (
          <div
            role="tab"
            aria-selected="true"
            title={name}
            className="flex h-[34px] max-w-[320px] items-center truncate bg-surface px-[22px] text-[13px] font-semibold text-foreground drop-shadow-[0_1px_2px_rgba(20,23,31,.06)]"
            style={{ clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 100%, 0 100%)' }}
          >
            <span className="truncate">{name}</span>
          </div>
        )}
      </div>
      <div className="h-[2px] shrink-0" style={{ background: 'var(--brass-hairline)' }} />
    </>
  );
}
