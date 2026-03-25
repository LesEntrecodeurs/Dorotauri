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

**Rapid tab switch guard:** The attach is async (dynamic import). Use a generation counter: increment on each tab switch, check the counter after the import resolves. If it changed, abort the attach — the user already switched away.

**WebGL context loss handling:**
- Listen for `webglcontextlost` on the terminal's canvas element
- On loss: dispose the WebGL addon, let xterm fall back to DOM
- No automatic retry (avoids failure loops)

**Scope of WebGL attachment:** WebGL is attached to the primary terminal views (TerminalsView, MosaicTerminalView, agent terminal, quick terminal). Ephemeral terminals (InstallTerminalModal, SkillInstallTerminal, tray terminal) use DOM rendering — they are short-lived and don't benefit from GPU acceleration.

### Files changed

- `src/lib/terminal.ts` — new `attachWebGLRenderer(term)` and `disposeWebGLRenderer(term)` utilities
- `src/components/TerminalsView/hooks/useMultiTerminal.ts` — call attach/dispose on tab visibility change
- `src/hooks/useAgentTerminal.ts` — attach on init
- `src/components/AgentTerminalDialog/useQuickTerminal.ts` — attach on init
- `src/components/MosaicTerminalView/TerminalTile.tsx` — attach on init
- `package.json` — add `xterm-addon-webgl@^0.16.0` dependency

### Risks

- WebKit on Linux may not support WebGL2 → fallback handles this
- Multiple terminals with many unique styled characters can cause texture atlas thrashing → unlikely with Claude Code output
- Rapid tab switching can cause stale async attaches → generation counter guard

## 2. Smart Ctrl+C (Copy vs SIGINT)

### Goal

Ctrl+C copies selected text to clipboard when text is selected. When nothing is selected, it sends SIGINT (`\x03`) to the PTY as before. Also add Ctrl+V paste support for cross-platform consistency.

### Design

**Single unified key handler.** xterm v5 supports only one `attachCustomKeyEventHandler` at a time — calling it again silently replaces the previous handler. All custom key logic (Shift+Enter, Ctrl+C, Ctrl+V) must live in one handler function. Refactor the existing `attachShiftEnterHandler` into a unified `attachKeyHandler(term)` that handles all cases.

**Ctrl+C (async fire-and-forget):**
1. Check `ev.ctrlKey && ev.key === 'c' && ev.type === 'keydown'`
2. If `term.hasSelection()`: return `false` immediately (prevent SIGINT), then async: `navigator.clipboard.writeText(term.getSelection()).then(() => term.clearSelection())`
3. If no selection: return `true` (let xterm send `\x03` to PTY)

The clipboard write is async but the handler returns synchronously. `clearSelection()` happens in the `.then()` callback — selection only clears on successful copy.

**Ctrl+V (async fire-and-forget):**
1. Check `ev.ctrlKey && ev.key === 'v' && ev.type === 'keydown'`
2. Return `false` immediately (prevent default)
3. Async: `navigator.clipboard.readText().then(text => term.paste(text))`

`term.paste()` is used instead of direct PTY write because it triggers the existing `onData` handler, which already has DA-response filtering and correct PTY routing.

**macOS:** Cmd+C/V is handled natively by the WebView. The handler only checks `ctrlKey`, not `metaKey` — Cmd shortcuts pass through unchanged.

### Files changed

- `src/lib/terminal.ts` — refactor `attachShiftEnterHandler` into unified `attachKeyHandler(term)` containing Shift+Enter, Ctrl+C, Ctrl+V logic. Update all call sites.

### Risks

- `navigator.clipboard` requires secure context (HTTPS or localhost) → Tauri localhost is fine
- Clipboard API may prompt for permission on first use → standard browser behavior, acceptable

## 3. Flow Control (Backpressure)

### Goal

Prevent browser crashes when a PTY produces massive output (e.g., `cat` on a large file) by implementing watermark-based flow control between the Rust PTY reader and xterm.js.

### Design

**Centralized output listener.** Currently, 8+ hooks/components independently listen to `agent:output` and call `term.write()`. Instead of patching each one, create a shared `TerminalWriteManager` module in `src/lib/terminal-write.ts` that:

- Registers as the single listener for a given `ptyId`
- Tracks `pendingBytes` per PTY
- Exposes `subscribe(ptyId, term)` and `unsubscribe(ptyId)` for consumers
- Applies flow control transparently — consumers don't need to know about watermarks

This centralizes flow control in one place and eliminates the multi-listener conflict (two views for the same PTY won't send competing pause/resume signals).

**Watermark logic (inside TerminalWriteManager):**
- On each `term.write(data, callback)`: increment `pendingBytes` by `data.byteLength` (Uint8Array only — UI writes like status messages and replayed string output bypass flow control)
- In callback: decrement `pendingBytes` by the chunk size
- When `pendingBytes` exceeds HIGH watermark (500KB): `invoke('pty_pause', { ptyId })`
- When `pendingBytes` drops below LOW watermark (100KB): `invoke('pty_resume', { ptyId })`

**Backend (Rust, `pty.rs`):**
- Add `paused: AtomicBool` inside `PtyHandle` (not a separate map) so cleanup is automatic when PTY is killed
- New IPC commands: `pty_pause(ptyId)` and `pty_resume(ptyId)` that toggle the flag
- Reader thread: after a successful `read()` returns data, check `paused` before emitting. If paused, `thread::sleep(10ms)` in a loop until resumed. One final chunk (up to 4096 bytes) is emitted before pause takes effect — this is acceptable.
- `pty_kill()` sets `paused = false` before cleanup — no orphaned state

**WebGL renderer interaction:** When a tab becomes inactive and WebGL is disposed, write callbacks may fire at different speeds (DOM renderer). The watermarks are robust to this — they track bytes processed regardless of renderer speed. A slight burst on re-activation is absorbed by the 500KB headroom.

### Files changed

- `src/lib/terminal-write.ts` — new `TerminalWriteManager` module (centralized listener + flow control)
- `src/hooks/useAgentTerminal.ts` — use `TerminalWriteManager.subscribe()`
- `src/components/TerminalsView/hooks/useMultiTerminal.ts` — use `TerminalWriteManager.subscribe()`
- `src/components/MosaicTerminalView/TerminalTile.tsx` — use `TerminalWriteManager.subscribe()`
- `src/components/AgentTerminalDialog/useQuickTerminal.ts` — use `TerminalWriteManager.subscribe()`
- `src/hooks/useTrayTerminal.ts` — use `TerminalWriteManager.subscribe()`
- All other `agent:output` listeners — migrate to `TerminalWriteManager`
- `src-tauri/src/pty.rs` — add `paused: AtomicBool` in `PtyHandle`, check in reader loop
- `src-tauri/src/commands/pty.rs` — add `pty_pause` and `pty_resume` commands
- `src-tauri/src/lib.rs` — register new commands

### Risks

- If pause is never followed by resume (bug), PTY output freezes → safety timeout: 5s auto-resume via `thread::sleep` loop with max iterations
- 10ms sleep granularity means ~100 checks/sec per paused PTY → negligible CPU. Could upgrade to `Condvar` later for zero-latency resume.
- Replayed output (historical agent.output) bypasses flow control intentionally — it's already in memory and written as strings, not Uint8Array

## Implementation Order

1. **Feature 2 (Ctrl+C/V)** — simplest, self-contained, refactors the key handler that Features 1 touches
2. **Feature 1 (WebGL)** — medium complexity, builds on the refactored terminal.ts
3. **Feature 3 (Flow Control)** — most complex, touches the most files, benefits from stable terminal.ts

## Out of Scope

- Package migration to `@xterm/xterm` scoped packages
- xterm.js v6 migration
- Search addon
- Web-links addon
- Unicode11 addon
- Cmd+Enter for newline (Shift+Enter is sufficient)
- Cursor blink optimization
- Right-click paste
