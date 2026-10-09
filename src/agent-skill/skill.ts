import skillText from './SKILL.md?raw';

/** The agent skill bundled with Gonq: shown under Help and offered for copying or saving. */
export const AGENT_SKILL: string = skillText;
export const AGENT_SKILL_FILENAME = 'SKILL.md';

/** The skill without its YAML front matter: what the Agent skill view renders. Copy and Save keep the full text. */
export const AGENT_SKILL_BODY: string = AGENT_SKILL.replace(/^---\n[\s\S]*?\n---\n+/, '');
