/** The shell's two placeholder screens as navigator Screen values: splashScreen (no top bar) and documentsScreen (the Gonq home: the logo in the top bar, with ☰ and the Folder navigator button in its top bar). */
import { createElement, Fragment } from 'react';
import type { Screen } from '../shell/StackNavigator';
import { DocumentsHome } from './DocumentsHome';
import { FolderButton } from './FolderSheet';
import { MenuDrawer } from './MenuDrawer';
import { Splash } from './Splash';

export const splashScreen: Screen = { key: 'splash', title: null, render: () => createElement(Splash) };
export const documentsScreen: Screen = { key: 'documents', title: 'Gonq', logo: true, leading: () => createElement(MenuDrawer), render: () => createElement(DocumentsHome), actions: () => createElement(Fragment, null, createElement(FolderButton)) };
