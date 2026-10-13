import { useEffect, useRef, useState } from 'react';
import { AGENT_SKILL, AGENT_SKILL_BODY, AGENT_SKILL_FILENAME } from '../agent-skill/skill';
import { copyText } from '../platform/clipboard';
import { MarkdownPreview } from '../editor/MarkdownPreview';
import type { FileAccess } from '../platform/files';

const button =
  'h-8 rounded-control border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function AgentSkillDialog({ files, onClose }: { files: FileAccess; onClose: () => void }) {
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);

  const copy = async () => {
    try {
      await copyText(AGENT_SKILL);
      setStatus({ text: 'Copied to the clipboard.', error: false });
    } catch (e) {
      setStatus({ text: `Could not copy: ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
  };
  const saveAs = async () => {
    try {
      const saved = await files.saveDocumentAs({ name: AGENT_SKILL_FILENAME, text: AGENT_SKILL });
      if (saved !== null) setStatus({ text: `Saved ${saved.name}.`, error: false });
    } catch (e) {
      setStatus({ text: `Could not save: ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-skill-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        className="flex max-h-[85vh] w-[640px] max-w-[90vw] flex-col rounded-container border border-border bg-surface p-5 [box-shadow:var(--shadow-dialog)]"
      >
        <h2 id="agent-skill-title" className="m-0 mb-1 text-[15px] font-semibold">
          Agent skill
        </h2>
        <p className="m-0 mb-3 text-[12px] text-muted-foreground">
          Give this to an AI agent so it can read and join comment threads in your Markdown files.
        </p>
        <div
          tabIndex={0}
          role="region"
          aria-label="SKILL.md"
          className="mb-3 min-h-0 flex-1 overflow-auto rounded-control border border-border bg-background px-4 py-2"
        >
          <MarkdownPreview text={AGENT_SKILL_BODY} />
        </div>
        <p role={status?.error ? 'alert' : 'status'} className={`m-0 mb-3 min-h-4 text-[12px] ${status?.error ? 'text-destructive' : 'text-muted-foreground'}`}>
          {status?.text}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => void copy()} className={`${button} border-border bg-transparent`}>
            Copy
          </button>
          <button type="button" onClick={() => void saveAs()} className={`${button} border-border bg-transparent`}>
            Save as…
          </button>
          <button ref={close} type="button" onClick={onClose} className={`${button} border-primary bg-primary text-primary-foreground`}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
