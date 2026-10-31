/**
 * The mobile read-only banner (M-22), the counterpart of the desktop ReadOnlyBanner: at the top of the editor screen on a
 * GitHub tab whose branch has an open pull request it says which one (openPullMessage, the same words Commit and Save
 * refuse with) and links to it as "Open PR" through openExternal, with a 44px hit area. Exports ReadOnlyBanner.
 */
import { openPullMessage } from '@gonq/editor/features/github/openPulls';
import { openExternal } from '@gonq/editor/platform/external';
import type { OpenPull } from '@gonq/editor/platform/github';
import { useNotices } from '../shell/notices';

export function ReadOnlyBanner({ pull }: { pull: OpenPull }) {
  const { setError } = useNotices();
  return (
    <div role="status" data-testid="read-only-banner" className="m-readonly">
      <span>{openPullMessage(pull)}</span>
      <a
        href={pull.url}
        target="_blank"
        rel="noopener noreferrer"
        className="m-tap"
        onClick={(e) => {
          e.preventDefault();
          openExternal(pull.url).catch((err) => setError(err instanceof Error ? err.message : String(err)));
        }}
      >
        Open PR
      </a>
    </div>
  );
}
