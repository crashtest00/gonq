/** Test helper for the ☰ menu drawer: openMenu(user, ...levels) taps ☰ and drills into the named menu and submenus ("View", "Theme"). */
import { screen } from '@testing-library/react';
import type { User } from './renderMobileApp';

export async function openMenu(user: User, ...levels: string[]) {
  await user.click(screen.getByRole('button', { name: 'Menu' }));
  for (const level of levels) await user.click(await screen.findByRole('menuitem', { name: level }));
}
