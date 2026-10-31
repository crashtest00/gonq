/**
 * The mobile Agent skill screen (M-29), reached from the ⋯ menu's Help > Agent skill…: the explanatory line, the
 * bundled SKILL.md body (front matter stripped) in a scrollable read-only MarkdownPreview, a status line, and Copy,
 * Save as… and Close. Copy and Save use the full text with front matter. Save as… goes through the platform
 * files seam and shows "Could not save: …" when it fails (no Android local-folder save until M-14's outcome).
 * Exports agentSkillScreen.
 */
import { createElement, useState } from 'react';
import { AGENT_SKILL, AGENT_SKILL_BODY, AGENT_SKILL_FILENAME } from '@gonq/editor/agent-skill/skill';
import { MarkdownPreview } from '@gonq/editor/editor/MarkdownPreview';
import { copyText } from '@gonq/editor/platform/clipboard';
import { files } from '@gonq/editor/platform/files';
import { useNavigator, type Screen } from '../shell/StackNavigator';
import { HScroll } from '../shell/HScroll';

const outline = { border: '1px solid var(--border)' } as const;

export function AgentSkillScreen() {
  const { pop } = useNavigator();
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);

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
    <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p style={{ margin: 0, color: 'var(--muted-foreground)' }}>
        Give this to an AI agent so it can read and join comment threads in your Markdown files.
      </p>
      <div
        tabIndex={0}
        role="region"
        aria-label="SKILL.md"
        style={{ ...outline, maxHeight: '50vh', overflow: 'auto', borderRadius: 'var(--radius-control)', background: 'var(--background)', padding: '0 var(--space-3)' }}
      >
        <MarkdownPreview text={AGENT_SKILL_BODY} />
      </div>
      <p role={status?.error ? 'alert' : 'status'} style={{ margin: 0, minHeight: '1.2em', fontSize: 12, color: status?.error ? 'var(--destructive)' : 'var(--muted-foreground)' }}>
        {status?.text}
      </p>
      <HScroll label="Agent skill actions">
        <button type="button" className="m-tap" style={outline} onClick={() => void copy()}>
          Copy
        </button>
        <button type="button" className="m-tap" style={outline} onClick={() => void saveAs()}>
          Save as…
        </button>
        <button type="button" className="m-tap m-tap-primary" onClick={pop}>
          Close
        </button>
      </HScroll>
    </div>
  );
}

export const agentSkillScreen: Screen = { key: 'agent-skill', title: 'Agent skill', render: () => createElement(AgentSkillScreen) };
