/** Web and Tauri entry point (index.html): applies the saved theme before first paint, then renders <App/>, as apps/desktop/src/main.tsx does. */
import { startMobile } from './start';
import './styles.css';

void startMobile(document.getElementById('root')!);
