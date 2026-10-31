/**
 * <TabStrip/>: the mobile counterpart of the desktop TabStrip.tsx, at the top of the editor screen. One tab per open
 * document (labels from model/tabLabels: "name (branch)" for same-named GitHub tabs, "folder/name" for local ones, a local tab's tooltip is the folder name and relative path, never a storage path), a
 * "●" titled "Unsaved changes" after the label of a dirty tab only, and a Close control on every tab; closing goes
 * through the shared closeTabById, so a dirty tab always asks first. The strip scrolls sideways with the edge fades of
 * .m-hscroll as its cue, the active tab is scrolled into view, and "+" (File > New through the registry) stays pinned
 * beside it. Tabs, Close and "+" all have a 44x44 hit area. There is no drag-to-reorder (desktop only).
 */
import { useEffect, useRef } from 'react';
import { tabLabels } from '@gonq/editor/model/tabLabels';
import { isLocalPath, localDisplayPath } from '@gonq/editor/platform/local';
import { runFileCommand, useDocuments } from '../shell/documents';

export function TabStrip() {
  const doc = useDocuments();
  const { tabs, activeId, activate } = doc.session;
  const labels = tabLabels(tabs);
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeId, tabs.length]);
  return (
    <div className="m-tabs">
      <div className="m-hscroll m-tabs-scroll" role="tablist" aria-label="Open documents">
        {tabs.map((tab, i) => {
          const active = tab.id === activeId;
          return (
            <div key={tab.id} ref={active ? activeRef : undefined} className="m-tab" data-active={active}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="m-tap m-tab-label"
                title={tab.github ? `${tab.github.owner}/${tab.github.repo} @ ${tab.github.branch}\n${tab.github.path}` : tab.path !== null && isLocalPath(tab.path) ? localDisplayPath(tab.path) : (tab.path ?? tab.name)}
                onClick={() => activate(tab.id)}
              >
                <span className="m-tab-name">{labels[i]}</span>
                {tab.dirty && (
                  <span aria-label="unsaved changes" title="Unsaved changes" className="m-dirty">
                    ●
                  </span>
                )}
              </button>
              <button type="button" className="m-tap" aria-label={`Close ${tab.name}`} title="Close tab" onClick={() => void doc.closeTabById(tab.id)}>
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="m-tap" aria-label="New tab" title="New tab" onClick={() => runFileCommand('file.new', { newFile: doc.newFile })}>
        ＋
      </button>
    </div>
  );
}
