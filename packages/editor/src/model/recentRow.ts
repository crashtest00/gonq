/**
 * What a recent-documents row shows, shared by the desktop sidebar and the mobile Documents home: basename (the file
 * name of a local, ssh:// or github:// path), relativeTime ("just now", "5 min ago", "3 h ago", "2 d ago", else the
 * date), githubDetail ("owner/repo @ branch" for a GitHub path, else null) and localDetail
 * ("Notes/sub" for a file in a picked folder, "Folder" for a folder root, else null; never a storage path).
 */
import { parseGithubPath } from '../platform/github';
import { isLocalFolderRoot, isLocalPath, localDisplayPath, localFileName, parseLocalPath, localTreeName } from '../platform/local';

export function basename(path: string): string {
  const gh = parseGithubPath(path);
  if (gh !== null) return gh.path.split('/').pop() || `${gh.owner}/${gh.repo}`;
  // A local:// path is a tree URI plus names: show the file's name, or the folder's name for a root.
  if (isLocalPath(path)) {
    const h = parseLocalPath(path);
    return h === null ? path : localFileName(path) || localTreeName(h.tree);
  }
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

/** "Folder" for a local:// folder root, else the folder name and relative folder of a local:// file ("Notes/sub"); null for a document saved outside a folder and for any other path. */
export function localDetail(path: string): string | null {
  if (!isLocalPath(path)) return null;
  if (isLocalFolderRoot(path)) return 'Folder';
  const parent = localDisplayPath(path).split('/').slice(0, -1).join('/');
  return parent === '' ? null : parent;
}
