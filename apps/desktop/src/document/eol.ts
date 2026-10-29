/**
 * The editor holds the file's text with every line break as `\n`. The file's own breaks are put
 * back on save: an untouched file is written exactly as it was read, an edited one with its
 * dominant ending (CRLF if it had any) throughout.
 */
export type Eol = '\r\n' | '\n';

export function detectEol(text: string): Eol {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** The text to write for `text` (editor form), given the file as it was last read or saved. */
export function toFileText(text: string, original: string): string {
  if (text === normalizeEol(original)) return original;
  return detectEol(original) === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}
