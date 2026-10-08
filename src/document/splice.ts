/** Replaces text[from, to) and nothing else, so the rest of the file stays byte-for-byte as it was. */
export function splice(text: string, from: number, to: number, insert: string): string {
  return text.slice(0, from) + insert + text.slice(to);
}

export function detectEol(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** A textarea only holds \n; these convert a slice of the file to and from that. */
export function toEditable(slice: string): string {
  return slice.replace(/\r\n/g, '\n');
}

export function fromEditable(value: string, eol: '\r\n' | '\n'): string {
  return eol === '\n' ? value : value.replace(/\n/g, eol);
}
