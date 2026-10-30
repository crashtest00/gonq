// Minimal stand-ins for node:assert (no @types/node in this project), backed
// by Vitest's expect so test.cjs's assertions port with unchanged semantics.
export function strictEqual (actual: unknown, expected: unknown, message?: string): void {
  expect(actual, message).toBe(expected)
}

export function notStrictEqual (actual: unknown, expected: unknown, message?: string): void {
  expect(actual, message).not.toBe(expected)
}

export function deepStrictEqual (actual: unknown, expected: unknown, message?: string): void {
  expect(actual, message).toStrictEqual(expected)
}

export function ok (value: unknown, message?: string): void {
  expect(Boolean(value), message).toBe(true)
}

export function throws (fn: () => unknown, pattern: RegExp, message?: string): void {
  expect(fn, message).toThrow(pattern)
}
