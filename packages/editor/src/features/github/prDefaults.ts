/**
 * Scripted (no LLM) default title and body for a new pull request: `defaultPrTitle(branch)` and
 * `defaultPrBody({ source, target, files })`, plus the `PrFile` input type. Pure functions, no GitHub
 * calls and nothing about comment threads.
 *
 * Title: the branch name with one leading "gonq/" removed ("gonq/gonq/x" -> "gonq/x", "feature/x"
 * unchanged). A branch that is empty or only "gonq/" falls back to the branch as given (so "" -> "").
 *
 * Body template (blocks separated by one blank line):
 *
 *     Merging <source> into <target>
 *
 *     <N> file(s) changed, +<A> −<D>         ("1 file changed", otherwise "files"; real minus sign U+2212)
 *
 *     - <status>: <name> (+<a> −<d>)         one per file; renamed: "- renamed: <old> → <new> (+a −d)"
 *     …and <M> more files                    only when the list was cut
 *
 *     Opened from Gonq
 *
 * Totals always cover every file. The list shows at most 200 files and is cut further so the whole body
 * stays under 60,000 characters (GitHub allows 65,536). Counts are grouped ("12,345"); negative or
 * non-finite counts print as 0. File names and branch names are markdown-escaped so they cannot make
 * links, formatting or @mentions, and over-long ones are shortened with "…".
 *
 * The compare result type is not in the codebase yet, so `PrFile` mirrors the fields of GitHub's compare
 * `files[]` entries (filename, status, additions, deletions, previous_filename).
 */

export interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  previous_filename?: string;
}

export const MAX_FILES = 200;
export const MAX_BODY = 60_000;
const MAX_NAME = 500;
const MAX_BRANCH = 250;
const FOOTER = 'Opened from Gonq';
const PREFIX = 'gonq/';

export function defaultPrTitle(branch: string): string {
  if (!branch.startsWith(PREFIX)) return branch;
  const rest = branch.slice(PREFIX.length);
  return rest === '' ? branch : rest;
}

const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const count = (n: number): string => (Number.isFinite(n) && n > 0 ? num.format(n) : '0');

/** Backslash-escape markdown/mention/autolink triggers; collapse line breaks; shorten long text. */
function escapeMd(text: string, max: number): string {
  let s = text.replace(/[\r\n\u2028\u2029]+/g, ' ');
  if (s.length > max) s = `${s.slice(0, max)}…`;
  return s.replace(/[\\`*_{}[\]()#+!|<>~&:@$]/g, '\\$&').replace(/www\./gi, (m) => `${m.slice(0, 3)}\\.`);
}

function fileLine(f: PrFile): string {
  const status = escapeMd(f.status || 'modified', 20);
  const name =
    f.status === 'renamed' && f.previous_filename
      ? `${escapeMd(f.previous_filename, MAX_NAME)} → ${escapeMd(f.filename, MAX_NAME)}`
      : escapeMd(f.filename, MAX_NAME);
  return `- ${status}: ${name} (+${count(f.additions)} −${count(f.deletions)})`;
}

export function defaultPrBody({ source, target, files }: { source: string; target: string; files: PrFile[] }): string {
  const adds = files.reduce((n, f) => n + (Number.isFinite(f.additions) && f.additions > 0 ? f.additions : 0), 0);
  const dels = files.reduce((n, f) => n + (Number.isFinite(f.deletions) && f.deletions > 0 ? f.deletions : 0), 0);
  const head = `Merging ${escapeMd(source, MAX_BRANCH)} into ${escapeMd(target, MAX_BRANCH)}`;
  const totals = `${files.length} ${files.length === 1 ? 'file' : 'files'} changed, +${count(adds)} −${count(dels)}`;
  const moreLine = (m: number): string => `…and ${m} more ${m === 1 ? 'file' : 'files'}`;
  const join = (lines: string[], more: number): string => {
    const list = [...lines, ...(more > 0 ? [moreLine(more)] : [])].join('\n');
    return [head, totals, ...(list ? [list] : []), FOOTER].join('\n\n');
  };

  const lines: string[] = [];
  const limit = Math.min(files.length, MAX_FILES);
  for (let i = 0; i < limit; i++) {
    const line = fileLine(files[i]);
    lines.push(line);
    if (join(lines, files.length - lines.length).length > MAX_BODY) {
      lines.pop();
      break;
    }
  }
  return join(lines, files.length - lines.length);
}
