# xterm.js Terminal Improvements

**Date:** 2026-03-25
**Status:** Approved

## Summary

Three targeted improvements to Dorothy's xterm.js terminal layer: WebGL rendering, smart Ctrl+C, and flow control. No package migration, no new addons beyond WebGL. Stays on `xterm` v5.3.0.

## 1. WebGL Renderer with Automatic Fallback

### Goal

Replace the default DOM renderer with WebGL for 5-45x faster rendering and sharper text via GPU texture atlases.

### Design

After `term.open(container)`, dynamically load `xterm-addon-webgl` and attach it. If WebGL2 is unavailable or context is lost, fall back silently to the DOM renderer.

**Tab-aware lifecycle:** Terminals survive tab switches (PTY + xterm instance stay alive). To avoid exhausting the browser's ~16 WebGL context limit:

- **Tab becomes active:** Load WebGL addon on each visible terminal
- **Tab becomes inactive:** Dispose WebGL addon (xterm falls back to DOM renderer automatically)
- The Terminal instance and its buffer (10,000 lines scrollback) remain in memory regardless — no data loss

Only terminals in the active tab hold WebGL contexts. With ~4 visible terminals per tab, this stays well within limits.

**WebGL context loss handling:**
- Listen for `webglcontextlost` on the terminal's canvas element
- On loss: dispose the WebGL addon, let xterm fall back to DOM
- No automatic retry (avoids failure loops)

### Files changed

- `src/lib/terminal.ts` — new `attachWebGLRenderer(term)` and `disposeWebGLRenderer(term)` utilities
- `src/components/TerminalsView/hooks/useMultiTerminal.ts` — call attach/dispose on tab visibility change
- `src/hooks/useAgentTerminal.ts` — attach on init
- `src/components/AgentTerminalDialog/useQuickTerminal.ts` — attach on init
- `src/components/MosaicTerminalView/TerminalTile.tsx` — attach on init
- `package.json` — add `xterm-addon-webgl` dependency

### Risks

- WebKit on Linux may not support WebGL2 → fallback handles this
- Multiple terminals with many unique styled characters can cause texture atlas thrashing → unlikely with Claude Code output

## 2. Smart Ctrl+C (Copy vs SIGINT)

### Goal

Ctrl+C copies selected text to clipboard when text is selected. When nothing is selected, it sends SIGINT (`\x03`) to the PTY as before. Also add Ctrl+V paste support for cross-platform consistency.

### Design

Add to `attachCustomKeyEventHandler` in `src/lib/terminal.ts`, alongside the existing Shift+Enter handler:

**Ctrl+C:**
1. Check `term.hasSelection()`
2. If selected: `navigator.clipboard.writeText(term.getSelection())`, then `term.clearSelection()`, return `false` (prevent default)
3. If not selected: return `true` (let xterm send `\x03` to PTY)

**Ctrl+V:**
1. Read clipboard via `navigator.clipboard.readText()`
2. Write to PTY via the `onData` callback or `term.paste(text)`
3. Return `false` (prevent default)

**macOS:** Cmd+C/V likely already handled by the browser/WebView natively. The handler checks for `ctrlKey` only — Cmd shortcuts pass through unchanged.

### Files changed

- `src/lib/terminal.ts` — extend `attachCustomKeyEventHandler` or add new `attachClipboardHandler(term)` function

### Risks

- `navigator.clipboard` requires secure context (HTTPS or localhost) → Tauri localhost is fine
- Clipboard API may prompt for permission on first use → standard browser behavior, acceptable

## 3. Flow Control (Backpressure)

### Goal

Prevent browser crashes when a PTY produces massive output (e.g., `cat` on a large file) by implementing watermark-based flow control between the Rust PTY reader and xterm.js.

### Design

**Frontend (per terminal):**
- Track `pendingBytes` counter
- On each `write(data, callback)`: increment `pendingBytes` by `data.length`
- In callback: decrement `pendingBytes` by the chunk size
- When `pendingBytes` exceeds HIGH watermark (500KB): `invoke('pty_pause', { ptyId })`
- When `pendingBytes` drops below LOW watermark (100KB): `invoke('pty_resume', { ptyId })`

**Backend (Rust, `pty.rs`):**
- Add `paused: AtomicBool` flag per PTY in PtyManager
- New IPC commands: `pty_pause(ptyId)` and `pty_resume(ptyId)` that toggle the flag
- Reader thread checks `paused` before each `read()` call
- When paused: `thread::sleep(Duration::from_millis(10))` then re-check
- OS PTY buffer absorbs data while paused (~64KB kernel buffer)

**Graceful behavior:** Under normal Claude Code usage, watermarks are never hit. Flow control is invisible. Only activates under extreme output volume.

### Files changed

- `src/lib/terminal.ts` — new `writeWithFlowControl(term, data, ptyId)` utility
- `src/hooks/useAgentTerminal.ts` — use flow-controlled write
- `src/components/TerminalsView/hooks/useMultiTerminal.ts` — use flow-controlled write
- `src/components/MosaicTerminalView/TerminalTile.tsx` — use flow-controlled write
- `src-tauri/src/pty.rs` — add `paused` flag, check in reader loop
- `src-tauri/src/commands/pty.rs` — add `pty_pause` and `pty_resume` commands
- `src-tauri/src/lib.rs` — register new commands

### Risks

- If pause is never followed by resume (bug), PTY output freezes → add safety timeout (5s) that auto-resumes
- 10ms sleep granularity means ~100 checks/sec per paused PTY → negligible CPU

## Out of Scope

- Package migration to `@xterm/xterm` scoped packages
- xterm.js v6 migration
- Search addon
- Web-links addon
- Unicode11 addon
- Cmd+Enter for newline (Shift+Enter is sufficient)
- Cursor blink optimization
