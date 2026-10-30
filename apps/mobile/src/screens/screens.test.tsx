/** Covers the placeholder screens: the splash shows the real logo asset only, then the empty Documents home appears. */
import { screen } from '@testing-library/react';
import { renderMobileApp } from '../testing/renderMobileApp';

it('starts on the splash with the logo and no top bar, tagline or wordmark text', async () => {
  const { container } = await renderMobileApp({ splash: true });
  const img = screen.getByRole('img', { name: 'Gonq logo' });
  expect(img).toHaveAttribute('src', expect.stringContaining('gonq-logo-OUTLINE.svg'));
  expect(screen.queryByRole('banner')).toBeNull();
  expect(container.textContent).toBe('');
});

it('moves on to the empty Documents home', async () => {
  await renderMobileApp();
  expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
  expect(screen.getByText('Recent documents')).toBeInTheDocument();
  expect(screen.getByText('No recent documents.')).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Gonq logo' })).toBeNull();
});
