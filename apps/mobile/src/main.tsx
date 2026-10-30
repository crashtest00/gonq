/** Web and Tauri entry point (index.html): applies the saved theme before first paint, then renders <App/>, as apps/desktop/src/main.tsx does. */
import { startMobile } from './start';
import './styles.css';
import { mountSafSpike } from './safSpike';

void startMobile(document.getElementById('root')!);

if (import.meta.env.DEV || (window as any).__TAURI_INTERNALS__) mountSafSpike();
