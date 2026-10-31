/** tabLabels: the label of each open tab, with just enough of the folder path (local) or the branch (GitHub) to tell same-named tabs apart; shared by the desktop and mobile tab strips. */
import type { TabInfo } from '../document/useDocument';
import { isLocalPath, localDisplayPath } from '../platform/local';

function segments(path: string): string[] {
  return path.split(/[\\/]/).filter((s) => s !== '');
}

/**
 * Tab labels: the file name, with just enough of the folder path in front of it to tell
 * apart tabs that share a name (`notes/todo.md` vs `work/todo.md`).
 */
export function tabLabels(tabs: Pick<TabInfo, 'name' | 'path' | 'github'>[]): string[] {
  return tabs.map((tab, i) => {
    // A GitHub file is its name; the same name from another path or branch also gets its branch.
    if (tab.github !== undefined) {
      const same = tabs.some((o, j) => j !== i && o.github !== undefined && o.name === tab.name && o.path !== tab.path);
      return same ? `${tab.name} (${tab.github.branch})` : tab.name;
    }
    const twins = tabs.filter((o, j) => j !== i && o.name === tab.name && o.path !== tab.path);
    if (tab.path === null || twins.length === 0) return tab.name;
    // A local:// path is shown as the folder's name and the names under it, never its tree URI.
    const shown = (p: string) => (isLocalPath(p) ? localDisplayPath(p) : p);
    const mine = segments(shown(tab.path));
    for (let depth = 2; depth <= mine.length; depth++) {
      const label = mine.slice(-depth).join('/');
      const clash = twins.some((o) => o.path !== null && segments(shown(o.path)).slice(-depth).join('/') === label);
      if (!clash) return label;
    }
    return mine.join('/');
  });
}
