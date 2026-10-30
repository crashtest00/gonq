/** Covers the stack navigator: push, pop (never below the root), replace and reset. */
import { screen } from '@testing-library/react';
import { renderInShell } from '../testing/renderMobileApp';
import { useNavigator, type Screen } from './StackNavigator';

const mk = (key: string): Screen => ({ key, title: key, render: () => <Controls name={key} /> });
function Controls({ name }: { name: string }) {
  const nav = useNavigator();
  return (
    <>
      <p>depth {nav.stack.length} at {name}</p>
      <button onClick={() => nav.push(mk('p'))}>push</button>
      <button onClick={() => nav.pop()}>pop</button>
      <button onClick={() => nav.replace(mk('r'))}>replace</button>
      <button onClick={() => nav.reset(mk('z'))}>reset</button>
    </>
  );
}

it('pushes, pops, replaces and resets, and never pops the root', async () => {
  const { user } = renderInShell(mk('root'));
  await user.click(screen.getByText('pop'));
  expect(screen.getByText('depth 1 at root')).toBeInTheDocument();
  await user.click(screen.getByText('push'));
  expect(screen.getByText('depth 2 at p')).toBeInTheDocument();
  await user.click(screen.getByText('replace'));
  expect(screen.getByText('depth 2 at r')).toBeInTheDocument();
  await user.click(screen.getByText('pop'));
  expect(screen.getByText('depth 1 at root')).toBeInTheDocument();
  await user.click(screen.getByText('push'));
  await user.click(screen.getByText('reset'));
  expect(screen.getByText('depth 1 at z')).toBeInTheDocument();
});
