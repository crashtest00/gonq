import skillText from './SKILL.md?raw';

/** The agent skill bundled with Gonq: shown under Help and offered for copying or saving. */
export const AGENT_SKILL: string = skillText;
export const AGENT_SKILL_FILENAME = 'SKILL.md';

/** Drops a leading YAML front matter block (LF or CRLF line endings). */
export const stripFrontMatter = (text: string): string => text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)+/, '');

/** The skill without its YAML front matter: what the Agent skill view renders. Copy and Save keep the full text. */
export const AGENT_SKILL_BODY: string = stripFrontMatter(AGENT_SKILL);
