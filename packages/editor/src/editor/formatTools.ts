/**
 * FORMATS: the formatting actions (label, shortcut hint, icon) shared by the desktop EditToolbar and the Format menu
 * registered in features/format.
 */
import { Bold, Italic, Link, List, ListChecks, ListOrdered, Strikethrough, Table, Underline, type LucideIcon } from 'lucide-react';
import type { Format } from '../model/formatting';

export const FORMATS: { format: Format; label: string; shortcut?: string; icon: LucideIcon; effect?: string; divider?: boolean }[] = [
  { format: 'bold', effect: 'font-bold', label: 'Bold', shortcut: 'Ctrl+B', icon: Bold, divider: true },
  { format: 'italic', effect: 'italic', label: 'Italic', shortcut: 'Ctrl+I', icon: Italic },
  { format: 'underline', effect: 'underline', label: 'Underline', shortcut: 'Ctrl+U', icon: Underline },
  { format: 'strike', effect: 'line-through', label: 'Strikethrough', shortcut: 'Ctrl+Shift+X', icon: Strikethrough },
  { format: 'link', label: 'Insert link', shortcut: 'Ctrl+K', icon: Link, divider: true },
  { format: 'bullet', label: 'Bullet list', icon: List },
  { format: 'numbered', label: 'Numbered list', icon: ListOrdered },
  { format: 'task', label: 'Checkbox list', icon: ListChecks },
  { format: 'table', label: 'Insert table', icon: Table },
];
