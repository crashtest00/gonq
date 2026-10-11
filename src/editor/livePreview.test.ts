import { EditorView } from '@codemirror/view';
import { createEditorState, modeCompartment, modeExtension } from './extensions';
import { applyFormat } from '../components/formatting';

/** A live-preview editor over `text` with the caret at `caret`; returns what is shown. */
function show(text: string, caret = text.length) {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({ state: createEditorState(text, false), parent });
  view.dispatch({ selection: { anchor: caret } });
  const shown = () => view.contentDOM.textContent ?? '';
  const q = (sel: string) => Array.from(view.contentDOM.querySelectorAll(sel));
  return { view, shown, q, move: (to: number) => view.dispatch({ selection: { anchor: to } }), done: () => (view.destroy(), parent.remove()) };
}

describe('syntax is hidden until the caret touches the construct', () => {
  test.each([
    ['bold', 'a **b** c', '.cm-strong', 'b', '**b**'],
    ['italic', 'a *b* c', '.cm-em', 'b', '*b*'],
    ['strikethrough', 'a ~~b~~ c', '.cm-strike', 'b', '~~b~~'],
    ['underline', 'a <ins>b</ins> c', '.cm-ins', 'b', '<ins>b</ins>'],
    ['inline code', 'a `b` c', '.cm-code', 'b', '`b`'],
    ['link', 'a [b](https://x.test) c', '.cm-link', 'b', '[b](https://x.test)'],
  ])('%s', (_name, text, selector, label, source) => {
    const e = show(text + '\nnext', text.length + 3);
    expect(e.shown()).toContain(`a ${label} c`);
    expect(e.q(selector).map((n) => n.textContent)).toContain(label);
    e.move(text.indexOf(source) + 1);
    expect(e.shown()).toContain(`a ${source} c`);
    e.done();
  });

  test('a selection touching the construct shows it too', () => {
    const e = show('a **b** c\nnext', 0);
    e.view.dispatch({ selection: { anchor: 0, head: 5 } });
    expect(e.shown()).toContain('**b**');
    e.done();
  });

  test('nested emphasis: each level is styled; stars of both show while the caret is inside', () => {
    const e = show('x ***both*** y\nz', 15);
    expect(e.shown()).toContain('x both y');
    expect(e.q('.cm-strong').length).toBeGreaterThan(0);
    expect(e.q('.cm-em').length).toBeGreaterThan(0);
    e.move(7);
    expect(e.shown()).toContain('***both***');
    e.done();
  });

  test('formatting that spans lines stays styled on every line and keeps its source', () => {
    const e = show('**one\ntwo** end', 15);
    expect(e.q('.cm-strong').map((n) => n.textContent).join('|')).toContain('one');
    expect(e.view.state.doc.toString()).toBe('**one\ntwo** end');
    e.done();
  });
});

describe('block constructs', () => {
  test('headings: level classes, # hidden off the line and shown on it', () => {
    const e = show('# One\n\n### Three\n\ntext', 20);
    expect(e.q('.cm-heading-1').length).toBe(1);
    expect(e.q('.cm-heading-3').length).toBe(1);
    expect(e.shown()).toContain('One');
    expect(e.shown()).not.toContain('#');
    e.move(2);
    expect(e.shown()).toContain('# One');
    e.done();
  });

  test('block quote: line class, > hidden off the line', () => {
    const e = show('> quoted\n\ntext', 12);
    expect(e.q('.cm-quote')).toHaveLength(1);
    expect(e.shown()).not.toContain('>');
    e.move(3);
    expect(e.shown()).toContain('> quoted');
    e.done();
  });

  test('bullets become a bullet glyph, numbers stay, both keep their source text', () => {
    const e = show('- a\n- b\n\n1. c\n\ntext');
    expect(e.q('.cm-bullet')).toHaveLength(2);
    expect(e.q('.cm-list-number')).toHaveLength(1);
    expect(e.view.state.doc.toString()).toBe('- a\n- b\n\n1. c\n\ntext');
    e.move(1);
    expect(e.q('.cm-bullet')).toHaveLength(1);
    e.done();
  });

  test('horizontal rule is a rule line; its dashes show with the caret on it', () => {
    const e = show('a\n\n---\n\nb', 8);
    expect(e.q('.cm-hr')).toHaveLength(1);
    expect(e.shown()).not.toContain('---');
    e.move(4);
    expect(e.shown()).toContain('---');
    e.done();
  });

  test('code block: styled lines, fences hidden off the block and shown inside it', () => {
    const e = show('```js\ncode\n```\n\nafter', 20);
    expect(e.q('.cm-codeblock')).toHaveLength(3);
    expect(e.shown()).not.toContain('```');
    e.move(8);
    expect(e.shown()).toContain('```js');
    e.done();
  });

  test('task items: checkbox widget in place of [ ] / [x]; clicking toggles the text', () => {
    const e = show('- [ ] a\n- [x] b\n\ntext', 20);
    const boxes = e.q('.cm-task-box');
    expect(boxes.map((b) => b.classList.contains('cm-task-box-checked'))).toEqual([false, true]);
    expect(e.shown()).not.toContain('[');
    boxes[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(e.view.state.doc.toString()).toBe('- [x] a\n- [x] b\n\ntext');
    e.q('.cm-task-box')[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(e.view.state.doc.toString()).toBe('- [x] a\n- [ ] b\n\ntext');
    e.done();
  });
});

describe('what stays source', () => {
  test('comment-thread markers and images are not styled or hidden', () => {
    const text = 'a [💬](#md-thread-c20260910143022a3f9c1) b ![alt](pic.png)\n\n| h1 | h2 |\n| -- | -- |\n| c | d |\n\nend';
    const e = show(text, text.length);
    expect(e.shown()).toContain('[💬](#md-thread-c20260910143022a3f9c1)');
    expect(e.shown()).toContain('![alt](pic.png)');
    expect(e.q('.cm-link')).toHaveLength(0);
    e.done();
  });
});

test('the document text is never changed by the preview', () => {
  const text = '# T\n\n**b** *i* ~~s~~ `c` [l](u)\n\n- [ ] t\n> q\n\n---\n\n```\nx\n```\n';
  const e = show(text, 0);
  for (let i = 0; i < text.length; i += 7) e.move(i);
  expect(e.view.state.doc.toString()).toBe(text);
  e.done();
});

test('a large document builds decorations for the visible part only', () => {
  const text = Array.from({ length: 5000 }, (_, i) => `Line ${i} **bold**`).join('\n\n');
  const e = show(text, 0);
  const t0 = performance.now();
  e.move(text.length);
  expect(e.q('.cm-strong').length).toBeLessThan(2500);
  expect(performance.now() - t0).toBeLessThan(2000);
  e.done();
});

describe('tables', () => {
  const doc = 'before\n\n| h1 | h2 |\n| :-- | --: |\n| a | b |\n| c | |\n\nafter';
  test('render as a table with header, alignment and body rows; source is untouched', () => {
    const e = show(doc, 0);
    expect(e.q('table')).toHaveLength(1);
    expect(e.q('th').map((n) => n.textContent)).toEqual(['h1', 'h2']);
    expect(e.q('td').map((n) => n.textContent)).toEqual(['a', 'b', 'c', '']);
    expect((e.q('th')[1] as HTMLElement).style.textAlign).toBe('right');
    expect(e.shown()).not.toContain('| h1');
    expect(e.view.state.doc.toString()).toBe(doc);
    e.done();
  });

  test('editing a cell changes only that cell in the source', () => {
    const e = show(doc, 0);
    const td = e.q('td')[1] as HTMLElement;
    td.textContent = 'x | y';
    td.dispatchEvent(new FocusEvent('blur'));
    expect(e.view.state.doc.toString()).toBe(doc.replace('| a | b |', '| a | x \\| y |'));
    expect((e.q('td')[1] as HTMLElement).textContent).toBe('x | y');
    e.done();
  });

  test('an empty cell can be filled', () => {
    const e = show(doc, 0);
    const td = e.q('td')[3] as HTMLElement;
    td.textContent = 'z';
    td.dispatchEvent(new FocusEvent('blur'));
    expect(e.view.state.doc.toString()).toBe(doc.replace('| c | |', '| c | z|'));
    e.done();
  });

  test('Tab from the last cell appends a row', () => {
    const e = show(doc, 0);
    const td = e.q('td')[3] as HTMLElement;
    td.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(e.view.state.doc.toString()).toBe(doc.replace('| c | |', '| c | |\n| | |'));
    expect(e.q('tr')).toHaveLength(4);
    e.done();
  });

  describe('cell safety in unpadded tables', () => {
    const edit = (text: string, idx: number, value: string, kind = 'td') => {
      const e = show(text, 0);
      const td = e.q(kind)[idx] as HTMLElement;
      td.textContent = value;
      td.dispatchEvent(new FocusEvent('blur'));
      const out = { doc: e.view.state.doc.toString(), cells: e.q('th,td').map((n) => n.textContent) };
      e.done();
      return out;
    };
    test.each([
      ['header cell', '|a|b|\n|-|-|\n|1|2|', 0, 'a\\', 'th', ['a\\', 'b', '1', '2']],
      ['body cell', '|a|b|\n|-|-|\n|1|2|', 0, '1\\', 'td', ['a', 'b', '1\\', '2']],
      ['last body cell', '|a|b|\n|-|-|\n|1|2|', 1, '2\\', 'td', ['a', 'b', '1', '2\\']],
    ])('a trailing backslash in the %s keeps the cell boundaries', (_n, text, idx, value, kind, cells) => {
      const r = edit(text, idx, value, kind);
      expect(r.cells).toEqual(cells);
      expect(r.cells).toHaveLength(4);
    });

    test('a pipe typed in an unpadded cell is escaped', () => {
      const r = edit('|a|b|\n|-|-|\n|1|2|', 0, 'x|y');
      expect(r.doc).toBe('|a|b|\n|-|-|\n|x\\|y|2|');
      expect(r.cells).toEqual(['a', 'b', 'x|y', '2']);
    });

    test('pasting text with pipes and backslashes keeps one cell', () => {
      const e = show('|a|b|\n|-|-|\n|1|2|', 0);
      const td = e.q('td')[0] as HTMLElement;
      td.textContent = 'p|q\\r\\';
      td.dispatchEvent(new FocusEvent('blur'));
      expect(e.q('td').map((n) => n.textContent)).toEqual(['p|q\\r\\', '2']);
      e.done();
    });
  });

  describe('arrow keys', () => {
    const src = 'before\n\n| h | i |\n| - | - |\n| a | b |\n\nafter';
    const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    const run = (view: EditorView, k: string) => {
      const b = view.state.facet(EditorView.editable) && view.contentDOM;
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      b && b.dispatchEvent(ev);
    };

    test('ArrowDown from the line above enters the first cell', () => {
      const e = show(src, src.indexOf('\n\n| h') + 1);
      run(e.view, 'ArrowDown');
      expect(document.activeElement).toBe(e.q('th')[0]);
      e.done();
    });

    test('ArrowUp from the line below enters the last row', () => {
      const e = show(src, src.indexOf('\nafter'));
      run(e.view, 'ArrowUp');
      expect(document.activeElement).toBe(e.q('td')[0]);
      e.done();
    });

    test('arrows move between rows and out of the table', () => {
      const e = show(src, 0);
      const th = e.q('th')[1] as HTMLElement;
      const td = e.q('td')[1] as HTMLElement;
      th.focus();
      key(th, 'ArrowDown');
      expect(document.activeElement).toBe(td);
      key(td, 'ArrowUp');
      expect(document.activeElement).toBe(th);
      key(th, 'ArrowUp');
      expect(e.view.state.selection.main.head).toBe(src.indexOf('\n\n| h') + 1);
      key(td, 'ArrowDown');
      expect(e.view.state.selection.main.head).toBe(src.indexOf('\nafter'));
      e.done();
    });
  });

  test('Insert table produces a rendered, editable table', () => {
    const { value } = applyFormat('table', '', 0, 0);
    const e = show(value, 0);
    expect(e.q('th').map((n) => n.textContent)).toEqual(['Column 1', 'Column 2']);
    expect(e.q('td').map((n) => n.textContent)).toEqual(['Cell', 'Cell']);
    e.done();
  });

  test('Raw mode shows the table as source', () => {
    const e = show(doc, 0);
    e.view.dispatch({ effects: modeCompartment.reconfigure(modeExtension(true)) });
    expect(e.q('table')).toHaveLength(0);
    expect(e.shown()).toContain('| h1 | h2 |');
    e.done();
  });
});
