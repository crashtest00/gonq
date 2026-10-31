/** The shell's two placeholder screens as navigator Screen values: splashScreen (no top bar) and documentsScreen (title "Documents", with the Folder navigator button and the ⋯ menu in its top bar). */
import { createElement, Fragment } from 'react';
import type { Screen } from '../shell/StackNavigator';
import { DocumentsHome } from './DocumentsHome';
import { FolderButton } from './FolderSheet';
import { MoreMenu } from './MoreMenu';
import { Splash } from './Splash';

export const splashScreen: Screen = { key: 'splash', title: null, render: () => createElement(Splash) };
export const documentsScreen: Screen = { key: 'documents', title: 'Documents', render: () => createElement(DocumentsHome), actions: () => createElement(Fragment, null, createElement(FolderButton), createElement(MoreMenu)) };
