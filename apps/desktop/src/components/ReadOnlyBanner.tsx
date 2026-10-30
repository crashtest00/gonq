/**
 * The banner at the top of the pane on a read-only GitHub tab: says which pull request is open for the tab's
 * branch and links to it (Open PR). Theme tokens only. Its text is openPullMessage, the same words Commit and
 * Ctrl+S refuse with.
 */
import { openLink } from '@gonq/editor/editor/openLink';
import { openPullMessage } from '@gonq/editor/features/github/openPulls';
import type { OpenPull } from '@gonq/editor/platform/github';

export function ReadOnlyBanner({ pull }: { pull: OpenPull }) {
  return (
    <div role="status" data-testid="read-only-banner" className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted px-4 py-2 text-[13px] text-foreground">
      <span>{openPullMessage(pull)}</span>
      <a
        href={pull.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          openLink(pull.url);
        }}
        className="shrink-0 text-primary underline"
      >
        Open PR
      </a>
    </div>
  );
}
