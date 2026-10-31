/** Vitest setup for the mobile app: the shared jest-dom matchers and jsdom Range stubs from @gonq/editor, the __GONQ_APP__ global, and a no-op window-close guard (the document controller registers one; a test's bare __TAURI_INTERNALS__ has no window). */
import { vi } from 'vitest';
import '@gonq/editor/setupTests';

vi.mock('@gonq/editor/platform/lifecycle', () => ({ guardClose: () => () => {} }));
