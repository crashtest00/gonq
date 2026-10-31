/**
 * What a recent-documents row shows, shared by the desktop sidebar and the mobile Documents home: basename (the file
 * name of a local, ssh:// or github:// path), relativeTime ("just now", "5 min ago", "3 h ago", "2 d ago", else the
 * date) and githubDetail ("owner/repo @ branch" for a GitHub path, else null).
 */
import { parseGithubPath } from '../platform/github';

export function basename(path: string): string {
  const gh = parseGithubPath(path);
  if (gh !== null) return gh.path.split('/').pop() || `${gh.owner}/${gh.repo}`;
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", else the date. */
export function relativeTime(then: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(then).toLocaleDateString();
}

/** "owner/repo @ branch" for a github:// path; null for any other. */
export function githubDetail(path: string): string | null {
  const gh = parseGithubPath(path);
  return gh === null ? null : `${gh.owner}/${gh.repo} @ ${gh.branch}`;
}
