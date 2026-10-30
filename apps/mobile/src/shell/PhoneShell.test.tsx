/** Covers the phone shell: top bar title and Back, no top bar on the splash, the dismissible notice and error banners, 44px tap classes. */
import { act, screen } from '@testing-library/react';
import { renderInShell } from '../testing/renderMobileApp';
import { useNavigator, type Screen } from './StackNavigator';
import { useNotices } from './notices';

function Probe() {
  const n = useNotices();
  const nav = useNavigator();
  return (
    <>
      <button onClick={() => n.setNotice('Saved.')}>notice</button>
      <button onClick={() => n.setError('Boom.')}>error</button>
      <button onClick={() => nav.push({ key: 'b', title: 'Second', render: () => <p>second body</p> })}>push</button>
    </>
  );
}
const home: Screen = { key: 'a', title: 'First', render: () => <Probe /> };

it('shows the title without Back on the root screen, and Back after a push', async () => {
  const { user } = renderInShell(home);
  expect(screen.getByRole('heading', { name: 'First' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  await user.click(screen.getByText('push'));
  expect(screen.getByRole('heading', { name: 'Second' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('heading', { name: 'First' })).toBeInTheDocument();
});

it('has no top bar for a screen without a title', () => {
  renderInShell({ key: 's', title: null, render: () => <p>bare</p> });
  expect(screen.queryByRole('banner')).toBeNull();
  expect(screen.getByText('bare')).toBeInTheDocument();
});

it('shows a dismissible notice and a dismissible error', async () => {
  const { user } = renderInShell(home);
  await user.click(screen.getByText('notice'));
  expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  await user.click(screen.getByRole('button', { name: 'Dismiss notice' }));
  expect(screen.queryByRole('status')).toBeNull();
  await user.click(screen.getByText('error'));
  expect(screen.getByRole('alert')).toHaveTextContent('Boom.');
  await user.click(screen.getByRole('button', { name: 'Dismiss error' }));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('gives the shell buttons the 44px hit-area class', async () => {
  const { user } = renderInShell(home);
  await user.click(screen.getByText('push'));
  expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('m-tap');
  await act(async () => {});
});

it('registers no keydown handler on the document or window', () => {
  const spy = vi.spyOn(window, 'addEventListener');
  const dspy = vi.spyOn(document, 'addEventListener');
  renderInShell(home);
  const keys = [...spy.mock.calls, ...dspy.mock.calls].filter(([t]) => String(t).startsWith('key'));
  expect(keys).toEqual([]);
});
