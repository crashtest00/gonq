/**
 * <RawSwitch/>: the top-bar Raw / Formatted control, named "Raw Markdown" (role switch, aria-checked = raw, as the
 * desktop RawSwitch) and drawn as two 44px segments. Tapping a segment selects it; activating the switch from the
 * keyboard flips it. It calls the document-wide setRaw and works on a read-only tab.
 */
import { useDocuments } from '../shell/documents';

export function RawSwitch() {
  const { session } = useDocuments();
  const { raw, setRaw } = session;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={raw}
      aria-label="Raw Markdown"
      title="Toggle raw markdown"
      className="m-raw"
      onClick={(e) => {
        const segment = e.target instanceof Element ? e.target.closest('[data-segment]')?.getAttribute('data-segment') : null;
        setRaw(segment ? segment === 'raw' : !raw);
      }}
    >
      <span data-segment="raw" data-active={raw}>Raw</span>
      <span data-segment="formatted" data-active={!raw}>Formatted</span>
    </button>
  );
}
