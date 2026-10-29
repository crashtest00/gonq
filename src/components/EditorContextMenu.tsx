/** The editor's right-click menu: a plain popup whose items come from the command registry (commands with a contextMenu placement; see App.tsx). */
import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** The key shown at the right of the item. */
  shortcut?: string;
  /** Draws a divider above the item. */
  divider?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/** The editor's right-click menu: a plain popup at the pointer, closed by Escape, an outside click or a pick. */
export function EditorContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const move = (e: React.KeyboardEvent, step: number) => {
    e.preventDefault();
    const all = Array.from(ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled)'));
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + step + all.length) % all.length]?.focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Editor"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') move(e, 1);
        else if (e.key === 'ArrowUp') move(e, -1);
      }}
      style={{ position: 'fixed', left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - items.length * 30 - 16) }}
      className="z-50 min-w-[180px] rounded-control border border-border bg-surface p-1 text-[13px] text-foreground shadow-[var(--shadow-md)]"
    >
      {items.map((item) => (
        <div key={item.label}>
          {item.divider && <div role="separator" className="my-1 h-px bg-border" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            {...(item.shortcut === undefined ? {} : { 'aria-keyshortcuts': item.shortcut.replace(/Ctrl/i, 'Control') })}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className="block w-full cursor-default select-none rounded-sm px-2 py-1 text-left outline-none hover:bg-background focus-visible:bg-background disabled:pointer-events-none disabled:text-muted-foreground"
          >
            {item.label}
            {item.shortcut !== undefined && <span aria-hidden="true" className="float-right ml-6 text-muted-foreground">{item.shortcut}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}
