import { render, screen, waitFor } from '@testing-library/react';
import { MarkdownView, viewText } from './MarkdownView';
import type { FileAccess, OpenedDocument } from '../platform/files';

const THREAD = `<!--
@thread c20260910143022a3f9c1
@status open
@anchor holds through Q3

[User | 2026-09-10T14:30:22+02:00]
Where does this number come from?
-->`;

const TEXT = `# Heading one

## Heading two

Some *emphasis*, **strong**, ~~gone~~, a [link](https://example.com) and \`inline\`.

- bullet a
- bullet b

1. first
2. second

- [x] done task
- [ ] open task

> quoted

\`\`\`ts
const x = 1;
\`\`\`

| a | b |
| - | - |
| 1 | 2 |

The estimate holds [💬](#md-thread-c20260910143022a3f9c1) and is fixed [✅](#md-thread-c20260910143022a3f9c2).

<!-- an ordinary comment -->

![Timeline](img/figure-1.png)

${THREAD}
`;

const doc = (text: string): OpenedDocument => ({ name: 'a.md', path: '/d/a.md', text });
const files = (image: string | null): FileAccess => ({ pickDocument: async () => null, loadImage: async () => image });

test('renders every GFM block type', async () => {
  const { container } = render(<MarkdownView doc={doc(TEXT)} files={files(null)} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Heading one' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Heading two' })).toBeInTheDocument();
  expect(container.querySelector('em')).toHaveTextContent('emphasis');
  expect(container.querySelector('strong')).toHaveTextContent('strong');
  expect(container.querySelector('del')).toHaveTextContent('gone');
  expect(screen.getByRole('link', { name: 'link' })).toHaveAttribute('href', 'https://example.com');
  expect(container.querySelectorAll('ul:not(.contains-task-list) > li')).toHaveLength(2);
  expect(container.querySelectorAll('ol > li')).toHaveLength(2);
  const boxes = screen.getAllByRole('checkbox');
  expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, false]);
  expect(container.querySelector('blockquote')).toHaveTextContent('quoted');
  expect(container.querySelector('p code')).toHaveTextContent('inline');
  expect(container.querySelector('pre code')).toHaveTextContent('const x = 1;');
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'a' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('figure-placeholder')).toBeInTheDocument());
});

test('thread markers show as literal glyphs and thread blocks and comments are hidden', () => {
  const { container } = render(<MarkdownView doc={doc(TEXT)} files={files(null)} />);
  const markers = container.querySelectorAll('.gonq-marker');
  expect(Array.from(markers).map((m) => m.textContent)).toEqual(['💬', '✅']);
  expect(container.querySelector('.gonq-marker svg, .gonq-marker img')).toBeNull();
  expect(container.querySelector('a[href^="#md-thread-"]')).toBeNull();
  expect(container).not.toHaveTextContent('Where does this number come from');
  expect(container).not.toHaveTextContent('@thread');
  expect(container).not.toHaveTextContent('ordinary comment');
});

test('viewText cuts thread blocks but the document text is not touched', () => {
  const before = TEXT;
  const view = viewText(before);
  expect(view).not.toContain('@thread');
  expect(view).toContain('[💬](#md-thread-c20260910143022a3f9c1)');
  expect(before).toBe(TEXT);
  expect(before).toContain(THREAD);
});

test('a missing image shows the placeholder with its file name', async () => {
  render(<MarkdownView doc={doc('![Timeline](img/figure-1.png)')} files={files(null)} />);
  const placeholder = await screen.findByTestId('figure-placeholder');
  expect(placeholder).toHaveTextContent('figure-1.png');
  expect(screen.getByText('Timeline')).toBeInTheDocument();
});

test('a loadable image renders', async () => {
  URL.revokeObjectURL = vi.fn();
  render(<MarkdownView doc={doc('![Timeline](a.png)')} files={files('blob:x')} />);
  expect(await screen.findByRole('img', { name: 'Timeline' })).toHaveAttribute('src', 'blob:x');
});

test('a document without headings renders', () => {
  render(<MarkdownView doc={doc('just a paragraph')} files={files(null)} />);
  expect(screen.getByText('just a paragraph')).toBeInTheDocument();
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
});
