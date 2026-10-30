/**
 * Pane sizing rules and the usePaneWidths hook: defaults, min/max per pane, and the widths shown. The stored
 * width (platform/settings.ts) changes only through commit(); the displayed width is the stored (or default)
 * one clamped to the pane's limits and to the window, without ever writing the clamp back.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPaneWidths, setPaneWidth, type PaneName, type PaneWidths } from '@gonq/editor/platform/settings';

export const PANE_DEFAULT: Record<PaneName, number> = { navigator: 240, outline: 240, comments: 340 };
export const PANE_MIN: Record<PaneName, number> = { navigator: 160, outline: 160, comments: 240 };
export const PANE_MAX: Record<PaneName, number> = { navigator: 480, outline: 480, comments: 640 };
/** The room the editor keeps when the window allows it. */
export const EDITOR_MIN = 360;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The widest `pane` may be given `otherWidth` px taken by the other open pane in a window `windowWidth` wide (never below its min). */
export function maxWidthFor(pane: PaneName, windowWidth: number, otherWidth: number): number {
  return Math.max(PANE_MIN[pane], Math.min(PANE_MAX[pane], windowWidth - otherWidth - EDITOR_MIN));
}

/** What to show for a pane: stored (or default) width within its limits. */
export function displayWidth(pane: PaneName, stored: number | undefined, windowWidth: number, otherWidth: number): number {
  return clamp(stored ?? PANE_DEFAULT[pane], PANE_MIN[pane], maxWidthFor(pane, windowWidth, otherWidth));
}

export interface PaneLayout {
  /** Displayed width of each pane, `other` being the open pane beside it (0 when none). */
  widthOf: (pane: PaneName, otherOpen: PaneName | null) => number;
  maxOf: (pane: PaneName, otherOpen: PaneName | null) => number;
  /** Saves the user's width (null = back to the default). */
  commit: (pane: PaneName, width: number | null) => void;
}

export function usePaneWidths(): PaneLayout {
  const [stored, setStored] = useState<PaneWidths>({});
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  // Set once the user resizes, so a late-arriving load cannot overwrite their change.
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    void getPaneWidths().then((w) => live && setStored((cur) => (touched.current ? cur : w)));
    return () => {
      live = false;
    };
    // Loaded once at start.
  }, []);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const otherWidth = useCallback(
    (other: PaneName | null) => (other === null ? 0 : clamp(stored[other] ?? PANE_DEFAULT[other], PANE_MIN[other], PANE_MAX[other])),
    [stored],
  );
  const widthOf = useCallback(
    (pane: PaneName, other: PaneName | null) => displayWidth(pane, stored[pane], windowWidth, otherWidth(other)),
    [stored, windowWidth, otherWidth],
  );
  const maxOf = useCallback((pane: PaneName, other: PaneName | null) => maxWidthFor(pane, windowWidth, otherWidth(other)), [windowWidth, otherWidth]);
  const commit = useCallback((pane: PaneName, width: number | null) => {
    touched.current = true;
    setStored((cur) => {
      const next = { ...cur };
      if (width === null) delete next[pane];
      else next[pane] = width;
      return next;
    });
    void setPaneWidth(pane, width).catch(() => {});
  }, []);

  return { widthOf, maxOf, commit };
}
