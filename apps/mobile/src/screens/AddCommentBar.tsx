/**
 * <AddCommentBar/>: the "Add Comment" button that slides in directly above the AccessoryBar while the editor's
 * selection is non-empty (the CommandHost's ctx.hasSelection, fed by CodeMirror's selection updates, so it follows the
 * OS long-press selection and its handles) and slides out when the selection collapses. The strip is in flow, so the
 * editor shrinks and the AccessoryBar stays below it, above the keyboard. Tapping runs ctx.addComment (the same path as
 * desktop); the button is disabled exactly when the command is (read-only PR, nothing commentable). Pointer-down is
 * cancelled so the selection and keyboard survive the tap. Any non-empty selection counts, hardware keyboard too.
 */
import { MessageSquarePlus } from 'lucide-react';
import { useCommandHost } from '../shell/commandContext';

export function AddCommentBar() {
  const { ctx } = useCommandHost();
  const shown = ctx.hasSelection;
  return (
    <div className="m-addcomment" data-visible={shown} aria-hidden={!shown}>
      <button
        type="button"
        className="m-tap m-addcomment-btn"
        disabled={!ctx.canAddComment}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => ctx.addComment()}
      >
        <MessageSquarePlus size={18} aria-hidden /> Add Comment
      </button>
    </div>
  );
}
