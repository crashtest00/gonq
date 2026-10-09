import { parseCommentMarkers } from '../comment-threads';

export interface Repaired {
  value: string;
  /** Where the caret belongs after the edit. */
  caret: number;
}

/**
 * Turns a raw textarea edit (`prev` → `next`) into one that never splits a thread
 * marker. The edit is recovered as "replace prev[a, b) with the inserted text";
 * then, per marker:
 * - an edit lying inside the marker is moved to just after it (a deletion there
 *   becomes a no-op, typing lands after the marker);
 * - an edit reaching part-way into the marker stops at its edge;
 * - an edit covering the whole marker removes it whole.
 * Returns null when the edit already leaves every marker intact.
 */
export function keepMarkersWhole(prev: string, next: string): Repaired | null {
  let p = 0;
  const max = Math.min(prev.length, next.length);
  while (p < max && prev[p] === next[p]) p++;
  let s = 0;
  while (s < max - p && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
  let a = p;
  let b = prev.length - s;
  const inserted = next.slice(p, next.length - s);

  const markers = [...parseCommentMarkers(prev).values()].flat();
  let changed = false;
  for (const m of markers) {
    const atEdge = a === b && (a === m.from || a === m.to);
    if (a >= m.from && b <= m.to && !atEdge) {
      a = b = m.to;
      changed = true;
      continue;
    }
    if (a > m.from && a < m.to) {
      a = m.to;
      changed = true;
    }
    if (b > m.from && b < m.to) {
      b = m.from;
      changed = true;
    }
  }
  if (!changed) return null;
  return { value: prev.slice(0, a) + inserted + prev.slice(b), caret: a + inserted.length };
}
