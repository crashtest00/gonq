/** renderApp: opens a document in a tab, saves it, and opens a queue of documents in turn. */
import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { docText } from '@gonq/editor/testing/editor';
import { lastSaved, menu, openDocument, renderApp, testDoc } from './renderApp';

vi.setConfig({ testTimeout: 30000 });

test('opens the document in a tab and saves it to its own path', async () => {
  const { user, saveDocument } = renderApp({ docs: testDoc('# Title\n\nbody\n') });
  await openDocument(user);
  expect(screen.getByRole('tab')).toHaveTextContent('a.md');
  expect(docText()).toBe('# Title\n\nbody\n');
  await menu(user, 'File', /^Save(?! As)/);
  await waitFor(() => expect(saveDocument).toHaveBeenCalled());
  expect(lastSaved(saveDocument)).toBe('# Title\n\nbody\n');
});

test('a queue of documents opens one per File > Open…', async () => {
  const { user } = renderApp({ docs: [testDoc('one', '/x/one.md'), testDoc('two', '/x/two.md')] });
  await openDocument(user);
  await openDocument(user);
  await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
  expect(docText()).toBe('two');
});
