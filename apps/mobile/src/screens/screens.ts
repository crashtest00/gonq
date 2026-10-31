/** The shell's two placeholder screens as navigator Screen values: splashScreen (no top bar) and documentsScreen (title "Documents", with the ⋯ menu in its top bar). */
import { createElement } from 'react';
import type { Screen } from '../shell/StackNavigator';
import { DocumentsHome } from './DocumentsHome';
import { MoreMenu } from './MoreMenu';
import { Splash } from './Splash';

export const splashScreen: Screen = { key: 'splash', title: null, render: () => createElement(Splash) };
export const documentsScreen: Screen = { key: 'documents', title: 'Documents', render: () => createElement(DocumentsHome), actions: () => createElement(MoreMenu) };
