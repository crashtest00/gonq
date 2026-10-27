/** settings.ts pane widths: the exact invoke() payloads sent to the get_pane_widths / set_pane_width commands (pinned on the Rust side by pane_width_ipc_tests.rs). */
import { vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('./files', () => ({ isTauri: () => true }));

import { getPaneWidths, setPaneWidth } from './settings';

beforeEach(() => invoke.mockReset());

describe('desktop pane widths', () => {
  it.each(['navigator', 'outline', 'comments'] as const)('sends {pane, width} for %s', async (pane) => {
    invoke.mockResolvedValue({});
    await setPaneWidth(pane, 300);
    expect(invoke).toHaveBeenCalledWith('set_pane_width', { pane, width: 300 });
  });
  it.each(['navigator', 'outline', 'comments'] as const)('sends a null width to clear %s', async (pane) => {
    invoke.mockResolvedValue({});
    await setPaneWidth(pane, null);
    expect(invoke).toHaveBeenCalledWith('set_pane_width', { pane, width: null });
  });
  it('reads get_pane_widths with no arguments and drops null panes', async () => {
    invoke.mockResolvedValue({ navigator: 260, outline: null, comments: 500 });
    expect(await getPaneWidths()).toEqual({ navigator: 260, comments: 500 });
    expect(invoke).toHaveBeenCalledWith('get_pane_widths');
  });
});
