import { ensureSyntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { createEditorState } from './extensions';

function open(text: string, caret = text.length) {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({ state: createEditorState(text, false), parent });
  view.dispatch({ selection: { anchor: caret } });
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  view.dispatch({ selection: { anchor: caret } }); // rebuild the decorations from the complete tree
  const q = (sel: string) => Array.from(view.contentDOM.querySelectorAll<HTMLElement>(sel));
  const depths = () => q('.cm-li').map((l) => l.style.getPropertyValue('--depth').trim());
  const key = (k: string, shiftKey = false) => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
  return { view, q, depths, key, doc: () => view.state.doc.toString(), done: () => (view.destroy(), parent.remove()) };
}

const names = (text: string) => {
  const out: string[] = [];
  const state = createEditorState(text, false);
  ensureSyntaxTree(state, state.doc.length, 5000)!.iterate({ enter: (n) => void (/^(Table$|Setext|Bullet|Ordered|Horizontal|Blockquote|ListItem)/.test(n.name) && out.push(n.name)) });
  return out;
};

describe('a list marker directly under a table', () => {
  const table = '| a | b |\n|---|---|\n| 1 | 2 |';
  test.each(['- ', '-', '* x', '+ x', '1. ', '1) x', '- x'])('%j after a table is a list, the table stays', (marker) => {
    const n = names(`${table}\n${marker}`);
    expect(n).toContain('Table');
    expect(n.some((x) => /List$/.test(x))).toBe(true);
    expect(n.some((x) => x.startsWith('Setext'))).toBe(false);
  });
  test('--- still underlines, and - - - is a rule', () => {
    expect(names(`${table}\n---`)).toEqual(['SetextHeading2']);
    expect(names(`${table}\n- - -`)).toEqual(['Table', 'HorizontalRule']);
  });
  test('inside a quote and inside a list item', () => {
    expect(names('> | a | b |\n> |---|---|\n> - x')).toEqual(['Blockquote', 'Table', 'BulletList', 'ListItem']);
    expect(names('- | a | b |\n  |---|---|\n  - x')).toEqual(['BulletList', 'ListItem', 'Table', 'BulletList', 'ListItem']);
  });
  test('two tables, table at the start and end of the document', () => {
    const n = names(`${table}\n- x\n\n${table}\n1. y`);
    expect(n.filter((x) => x === 'Table')).toHaveLength(2);
  });
  test('the table is still rendered and the source is untouched', () => {
    const text = `${table}\n- `;
    const e = open(text);
    expect(e.q('.cm-table')).toHaveLength(1);
    expect(e.doc()).toBe(text);
    e.done();
  });
  test('blank line between table and marker, and a plain paragraph, are unchanged', () => {
    expect(names(`${table}\n\n- x`)).toEqual(['Table', 'BulletList', 'ListItem']);
    expect(names('para\n- x')).toEqual(['BulletList', 'ListItem']);
  });
});

describe('list layout', () => {
  test('nesting depth steps by one, bullets and numbers mixed, task items included', () => {
    const e = open('- a\n  1. b\n     - [ ] c\n       - d', 0);
    expect(e.depths()).toEqual(['0', '1', '2', '3']);
    expect(e.q('.cm-li-first')).toHaveLength(4);
    e.done();
  });
  test('leading whitespace is replaced by the padding', () => {
    const e = open('- a\n  - b\n\nafter', 0);
    expect(e.view.contentDOM.textContent).not.toMatch(/\s{2}/);
    e.done();
  });
  test('wrapped continuation lines get the padding but no hanging indent', () => {
    const e = open('- first\n  second line of the item\n- next', 0);
    const lines = e.q('.cm-li');
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.classList.contains('cm-li-first'))).toEqual([true, false, true]);
    expect(lines.map((l) => l.style.getPropertyValue('--depth').trim())).toEqual(['0', '0', '0']);
    e.done();
  });
  test('bullet, number (1. and 10.) and task items share the marker box', () => {
    const e = open('- a\n\n1. b\n\n10. c\n\n- [ ] d');
    const boxes = e.q('.cm-list-box').map((b) => b.textContent);
    expect(boxes).toEqual(['•', '1. ', '10. ']);
    expect(e.q('.cm-task-box')).toHaveLength(1);
    e.done();
  });
  test.each([
    ['bullet', '- a\n- b', 4],
    ['numbered', '1. a\n2. b', 5],
    ['task', '- [ ] a\n- [ ] b', 8],
  ])('Tab indents a %s item one level, Shift+Tab outdents it', (_n, text, at) => {
    const e = open(text, at);
    expect(e.depths()).toEqual(['0', '0']);
    e.key('Tab');
    expect(e.depths()).toEqual(['0', '1']);
    e.key('Tab', true);
    expect(e.depths()).toEqual(['0', '0']);
    expect(e.doc()).toBe(text);
    e.done();
  });
  test('Tab on a lone item shows it one step in', () => {
    const e = open('- a', 3);
    e.key('Tab');
    expect(e.depths()).toEqual(['1']);
    e.done();
  });
  test.each([
    ['numbered', ['1. one', '1. two', '1. three', '1. four'], ['0', '1', '2', '3']],
    ['bullet', ['- one', '- two', '- three', '- four'], ['0', '1', '2', '3']],
    ['task', ['- [ ] one', '- [ ] two', '- [ ] three', '- [ ] four'], ['0', '1', '2', '3']],
    ['mixed bullet/numbered', ['- one', '1. two', '- three', '1. four'], ['0', '1', '2', '3']],
    ['mixed numbered/bullet', ['1. one', '- two', '1. three', '- four'], ['0', '1', '2', '3']],
    ['ten and up', ['10. one', '10. two', '10. three'], ['0', '1', '2']],
  ])('Tab nests %s lists three levels, the parse tree agrees, Shift+Tab walks back', (_n, lines, expected) => {
    const e = open(lines[0]);
    const levels: string[][] = [];
    lines.slice(1).forEach((l, i) => {
      e.view.dispatch({ changes: { from: e.view.state.doc.length, insert: `\n${l}` }, selection: { anchor: e.view.state.doc.length + l.length + 1 } });
      for (let t = 0; t <= i; t++) e.key('Tab');
      levels.push(e.depths());
    });
    expect(e.depths()).toEqual(expected);
    expect(e.q('.cm-li-first')).toHaveLength(lines.length); // every line is an item, none fell out as text
    expect(e.q('.cm-list-box').length + e.q('.cm-task-box').length).toBe(lines.length);
    // Shift+Tab on the last line steps it back out, one level per press.
    for (let d = lines.length - 1; d > 0; d--) {
      e.key('Tab', true);
      expect(e.depths()[lines.length - 1]).toBe(String(d - 1));
    }
    e.done();
  });
  test('Shift+Tab on a selection of several items outdents them all', () => {
    const e = open('- a\n    - b\n    - c', 0);
    e.view.dispatch({ selection: { anchor: 0, head: e.view.state.doc.length } });
    e.key('Tab', true);
    expect(e.depths()).toEqual(['0', '0', '0']);
    e.done();
  });
});
