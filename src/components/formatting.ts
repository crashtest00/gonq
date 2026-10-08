/** Markdown edits for the formatting toolbar: pure functions from a field's text and selection to its new text and selection. */
export interface Edit {
  value: string;
  start: number;
  end: number;
}

export type Format = 'bold' | 'italic' | 'strike' | 'link' | 'bullet' | 'numbered' | 'task' | 'table';

const WRAPS: Record<'bold' | 'italic' | 'strike', string> = { bold: '**', italic: '*', strike: '~~' };

function wrap(value: string, start: number, end: number, mark: string): Edit {
  const m = mark.length;
  // Selection already wrapped (marks just outside it, or included in it): unwrap.
  if (value.slice(start - m, start) === mark && value.slice(end, end + m) === mark && start >= m) {
    return { value: value.slice(0, start - m) + value.slice(start, end) + value.slice(end + m), start: start - m, end: end - m };
  }
  const inner = value.slice(start, end);
  if (inner.length >= 2 * m && inner.startsWith(mark) && inner.endsWith(mark)) {
    const bare = inner.slice(m, inner.length - m);
    return { value: value.slice(0, start) + bare + value.slice(end), start, end: start + bare.length };
  }
  return { value: value.slice(0, start) + mark + inner + mark + value.slice(end), start: start + m, end: end + m };
}

const PREFIX = { bullet: /^([-*+]) /, numbered: /^\d+[.)] /, task: /^[-*+] \[[ xX]\] / } as const;

function lines(value: string, start: number, end: number, kind: 'bullet' | 'numbered' | 'task'): Edit {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const nl = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
  const to = nl < 0 ? value.length : nl;
  const rows = value.slice(from, to).split('\n');
  // A task line is also a bullet line, so check the more specific pattern first.
  const has = (r: string) => (kind === 'bullet' ? PREFIX.bullet.test(r) && !PREFIX.task.test(r) : PREFIX[kind].test(r));
  const content = rows.filter((r) => r.trim() !== '');
  const off = content.length > 0 && content.every(has);
  let n = 0;
  const out = rows.map((r) => {
    if (r.trim() === '') return r;
    const bare = r.replace(PREFIX.task, '').replace(PREFIX.bullet, '').replace(PREFIX.numbered, '');
    if (off) return bare;
    n++;
    return (kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${n}. `) + bare;
  });
  const text = out.join('\n');
  return { value: value.slice(0, from) + text + value.slice(to), start: from, end: from + text.length };
}

const TABLE = '| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |';

export function applyFormat(format: Format, value: string, start: number, end: number): Edit {
  switch (format) {
    case 'bold':
    case 'italic':
    case 'strike':
      return wrap(value, start, end, WRAPS[format]);
    case 'link': {
      const label = value.slice(start, end) || 'text';
      const url = 'https://';
      const head = value.slice(0, start) + `[${label}](`;
      return { value: head + url + ')' + value.slice(end), start: head.length, end: head.length + url.length };
    }
    case 'table': {
      // A table is its own block: separate it from text on the same line.
      const before = value.slice(0, end);
      const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const rest = value.slice(end);
      const trail = rest === '' || rest.startsWith('\n\n') ? '' : rest.startsWith('\n') ? '\n' : '\n\n';
      const at = before.length + lead.length;
      return { value: before + lead + TABLE + trail + rest, start: at + 2, end: at + 10 };
    }
    default:
      return lines(value, start, end, format);
  }
}
