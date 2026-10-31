/**
 * useVisualViewport(onResize): while mounted, mirrors window.visualViewport's height into the --m-vvh CSS variable
 * (the shell's height, so the bottom of the screen stays above a virtual keyboard even where the WebView overlays it
 * instead of honouring interactive-widget=resizes-content) and calls onResize after each change so the editor can
 * keep its caret visible. Does nothing where visualViewport is missing.
 */
import { useEffect, useRef } from 'react';

export function useVisualViewport(onResize: () => void): void {
  const latest = useRef(onResize);
  latest.current = onResize;
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    const apply = () => {
      root.style.setProperty('--m-vvh', `${vv.height}px`);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => latest.current());
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      cancelAnimationFrame(frame);
      root.style.removeProperty('--m-vvh');
    };
  }, []);
}
