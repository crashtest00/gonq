# Resizable side panes

The folder navigator, outline and comments panes can be resized. Each has a drag handle on the edge it shares
with the editor (right edge for navigator and outline, left edge for comments).

| Action | Result |
| --- | --- |
| Drag the handle (mouse, touch, pen) | Resizes; the editor takes the rest. Stops at the limits. |
| Left / Right arrow (handle focused) | Moves the edge 16 px (Shift: 64 px) |
| Home / End | Minimum / maximum width |
| Enter, or double-click | Back to the default |
| Escape while dragging | Cancels the drag |

Defaults / minimum / maximum: navigator 240 / 160 / 480 px, outline 240 / 160 / 480 px, comments 340 / 240 / 640 px.
The editor keeps at least 360 px when the window allows it; in a smaller window the displayed width is
clamped, but the saved width is never overwritten by that. Widths are saved only when the user resizes
(`packages/editor/src/platform/settings.ts`: settings.json via `get_pane_widths` / `set_pane_width` on desktop, localStorage
`gonq.paneWidths` in the browser) and are kept across closing a pane and restarting.

## Why not react-resizable-panels

Considered (shadcn's `resizable`). Not used: it owns the whole row as one group with percentage-based sizes,
so a window resize changes pane pixel widths and rewrites the saved layout, panes that mount and unmount
(only one left pane at a time) re-normalise the other panes, and the saved value must stay unchanged while the
displayed one is clamped. `ResizablePane.tsx` instead keeps pixel widths and follows the WAI-ARIA window
splitter pattern with pointer capture (no extra dependency, nothing new to verify in the Tauri webview beyond
standard pointer events; colours are theme tokens only).
