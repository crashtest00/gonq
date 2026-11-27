const A = 'c20260910143022a3f9c1';
const B = 'c20260910143055b7d2e4';
const block = (id: string, status: string, msg: string) => `<!--\n@thread ${id}\n@status ${status}\n\n[User | 2026-09-10T14:30:22+02:00]\n${msg}\n-->\n`;
export const DOC = [
  '# Marker states', '',
  `Plain paragraph with [💬](#md-thread-${A}) an open thread and [💬](#md-thread-${B}) another one.`, '',
  `1. First numbered item with [💬](#md-thread-${A}) a duplicate-id marker`, '2. Second item', '',
  `Resolved here [✅](#md-thread-${B}) too.`, '',
  block(A, 'open', 'First thread question?'), block(B, 'open', 'Second thread question?'),
].join('\n');
