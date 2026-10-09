import type { OutlineItem } from './outline';

export function OutlineSidebar({ items, onJump }: { items: OutlineItem[]; onJump: (from: number) => void }) {
  return (
    <aside aria-label="Outline" className="flex w-[240px] shrink-0 overflow-hidden">
      <nav className="min-w-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Outline</div>
        {items.length === 0 ? (
          <p className="m-0 text-[13px] text-muted-foreground">No headings.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {items.map((item) => (
              <li key={item.from}>
                <button
                  type="button"
                  onClick={() => onJump(item.from)}
                  title={item.text}
                  style={{ paddingLeft: item.level === 1 ? 0 : 22 }}
                  className={`block w-full cursor-pointer truncate border-0 bg-transparent py-1 text-left hover:text-foreground ${
                    item.level === 1 ? 'text-[13px] font-semibold text-foreground' : 'text-[12.5px] text-muted-foreground'
                  }`}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div className="w-px shrink-0" style={{ background: 'var(--brass-hairline-v)' }} />
    </aside>
  );
}
