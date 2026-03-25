# xterm.js Terminal Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Dorothy's xterm.js terminals with WebGL rendering, smart Ctrl+C/V clipboard, and PTY flow control.

**Architecture:** Three independent features, each committed separately. Feature 2 (keyboard) refactors `terminal.ts` which Features 1 and 3 build on. Feature 3 introduces a `TerminalWriteManager` that centralizes `agent:output` listening and adds backpressure. Rust backend gets `pty_pause`/`pty_resume` commands.

**Tech Stack:** xterm.js v5.3.0, xterm-addon-webgl ^0.16.0, React 19, Tauri v2, Rust (portable-pty)

**Spec:** `docs/superpowers/specs/2026-03-25-xterm-improvements-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/terminal.ts` | Modify | Unified key handler (Shift+Enter, Ctrl+C, Ctrl+V), WebGL attach/dispose utilities |
| `src/lib/terminal-write.ts` | Create | `TerminalWriteManager` — centralized `agent:output` listener with flow control |
| `src/hooks/useAgentTerminal.ts` | Modify | Use unified key handler, use TerminalWriteManager, attach WebGL |
| `src/components/TerminalsView/hooks/useMultiTerminal.ts` | Modify | Use unified key handler, use TerminalWriteManager, attach WebGL with tab lifecycle |
| `src/components/MosaicTerminalView/TerminalTile.tsx` | Modify | Use unified key handler, use TerminalWriteManager, attach WebGL |
| `src/components/AgentTerminalDialog/useQuickTerminal.ts` | Modify | Use unified key handler, use TerminalWriteManager, attach WebGL |
| `src-tauri/src/pty.rs` | Modify | Add `paused: AtomicBool` to `PtyHandle`, check in reader loop |
| `src-tauri/src/commands/pty.rs` | Modify | Add `pty_pause` and `pty_resume` commands |
| `src-tauri/src/lib.rs` | Modify | Register `pty_pause` and `pty_resume` |
| `package.json` | Modify | Add `xterm-addon-webgl` dependency |

---

## Task 1: Unified Key Handler (Ctrl+C/V + Shift+Enter)

**Files:**
- Modify: `src/lib/terminal.ts`

- [ ] **Step 1: Refactor `attachShiftEnterHandler` into `attachKeyHandler`**

Replace the entire `attachShiftEnterHandler` function with a unified handler that covers Shift+Enter, Ctrl+C, and Ctrl+V. The `sendFn` parameter is kept for Shift+Enter's PTY write.

```typescript
import type { Terminal } from 'xterm';

/**
 * Strip Ink/ANSI cursor movement sequences that break during output replay.
 */
export function stripCursorSequences(data: string): string {
  return data
    .replace(/\x1b\[\d*[ABCDEFGH]/g, '')
    .replace(/\x1b\[\d*;\d*[Hf]/g, '')
    .replace(/\x1b\[\d*K/g, '')
    .replace(/\x1b\[\d*J/g, '')
    .replace(/\x1b\[?[su78]/g, '')
    .replace(/\x1b\[\?25[lh]/g, '')
    .replace(/\x1b\[\?1049[hl]/g, '');
}

/**
 * Attach unified keyboard handler to a terminal.
 *
 * - Shift+Enter → insert newline (ESC+CR) instead of submitting
 * - Ctrl+C → copy selection to clipboard if text selected, else send SIGINT
 * - Ctrl+V → paste from clipboard into terminal
 *
 * xterm v5 only supports one attachCustomKeyEventHandler at a time.
 * All custom key logic MUST live here.
 *
 * @param term    - The xterm Terminal instance
 * @param sendFn  - Callback that forwards data to the PTY/agent (used for Shift+Enter)
 */
export function attachKeyHandler(
  term: Terminal,
  sendFn: (data: string) => void,
): void {
  term.attachCustomKeyEventHandler((event) => {
    // Shift+Enter: insert newline
    if (event.key === 'Enter' && event.shiftKey && event.type === 'keydown') {
      sendFn('\x1b\r');
      return false;
    }

    // Only handle keydown for Ctrl shortcuts (ignore keyup to avoid double-fire)
    if (event.type !== 'keydown' || !event.ctrlKey) return true;

    // Ctrl+C: copy if selection exists, else let SIGINT through
    if (event.key === 'c') {
      if (term.hasSelection()) {
        const text = term.getSelection();
        navigator.clipboard.writeText(text).then(() => {
          term.clearSelection();
        });
        return false; // prevent SIGINT
      }
      return true; // no selection → send \x03 to PTY
    }

    // Ctrl+V: paste from clipboard
    if (event.key === 'v') {
      navigator.clipboard.readText().then((text) => {
        if (text) term.paste(text);
      });
      return false; // prevent default
    }

    return true;
  });
}

/**
 * @deprecated Use attachKeyHandler instead
 */
export const attachShiftEnterHandler = attachKeyHandler;
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build 2>&1 | head -30`
Expected: No TypeScript errors (the deprecated alias keeps existing call sites working)

- [ ] **Step 3: Commit**

```bash
git add src/lib/terminal.ts
git commit -m "feat(terminal): unified key handler with Ctrl+C copy and Ctrl+V paste"
```

---

## Task 2: Update Call Sites to Use `attachKeyHandler`

**Files:**
- Modify: `src/hooks/useAgentTerminal.ts` (line 7 import, line 127 call)
- Modify: `src/components/TerminalsView/hooks/useMultiTerminal.ts` (line 13 import, line 203 call)
- Modify: `src/components/AgentTerminalDialog/useQuickTerminal.ts` (line 8 import, line 101 call)

- [ ] **Step 1: Update imports and calls in all three files**

In each file, change:
```typescript
// Old
import { attachShiftEnterHandler } from '@/lib/terminal';
// ...
attachShiftEnterHandler(term, (data) => { ... });
```
To:
```typescript
// New
import { attachKeyHandler } from '@/lib/terminal';
// ...
attachKeyHandler(term, (data) => { ... });
```

Files and lines:
- `src/hooks/useAgentTerminal.ts`: import line 7, call line 127
- `src/components/TerminalsView/hooks/useMultiTerminal.ts`: import line 13, call line 203
- `src/components/AgentTerminalDialog/useQuickTerminal.ts`: import line 8, call line 101

- [ ] **Step 2: Add `attachKeyHandler` to `TerminalTile.tsx`**

`TerminalTile.tsx` currently has NO key handler (no Shift+Enter, no copy/paste). Add it after `term.open(container)`:

In `src/components/MosaicTerminalView/TerminalTile.tsx`, add import at top:
```typescript
import { attachKeyHandler } from '@/lib/terminal';
```

Then after `term.open(container)` (around line 74), before the `if (!isTauri())` check, add:
```typescript
      attachKeyHandler(term, (data) => {
        if (ptyId && isTauri()) {
          invoke('pty_write', { ptyId, data }).catch(() => {});
        }
      });
```

Note: `ptyId` is declared later in the function. Move the `attachKeyHandler` call to after `ptyId` is resolved (after line 110), just before the `term.onData()` call (line 123).

- [ ] **Step 3: Remove deprecated alias from terminal.ts**

Once all call sites are updated, remove the deprecated alias from `src/lib/terminal.ts`:
```typescript
// DELETE this line:
export const attachShiftEnterHandler = attachKeyHandler;
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build 2>&1 | head -30`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAgentTerminal.ts src/components/TerminalsView/hooks/useMultiTerminal.ts src/components/AgentTerminalDialog/useQuickTerminal.ts src/components/MosaicTerminalView/TerminalTile.tsx src/lib/terminal.ts
git commit -m "refactor(terminal): migrate all call sites to unified attachKeyHandler"
```

---

## Task 3: Add WebGL Renderer Utilities

**Files:**
- Modify: `src/lib/terminal.ts` — add `attachWebGL` and `disposeWebGL`
- Modify: `package.json` — add `xterm-addon-webgl`

- [ ] **Step 1: Install xterm-addon-webgl**

Run: `npm install xterm-addon-webgl@^0.16.0`

- [ ] **Step 2: Add WebGL utilities to `terminal.ts`**

Append to `src/lib/terminal.ts`:

```typescript
// ---------------------------------------------------------------------------
// WebGL Renderer — attach/dispose with context loss fallback
// ---------------------------------------------------------------------------

// Track WebGL addon per terminal instance (WeakMap avoids memory leaks)
const webglAddons = new WeakMap<Terminal, import('xterm-addon-webgl').WebglAddon>();

/**
 * Attach WebGL renderer to a terminal for GPU-accelerated rendering.
 * Falls back silently to DOM renderer if WebGL2 is unavailable or context is lost.
 *
 * @param term - The xterm Terminal instance (must already be opened)
 * @returns true if WebGL was attached, false if it fell back to DOM
 */
export async function attachWebGL(term: Terminal): Promise<boolean> {
  // Don't double-attach
  if (webglAddons.has(term)) return true;

  try {
    const { WebglAddon } = await import('xterm-addon-webgl');
    const addon = new WebglAddon();

    // On context loss, dispose and fall back to DOM renderer
    addon.onContextLoss(() => {
      disposeWebGL(term);
    });

    term.loadAddon(addon);
    webglAddons.set(term, addon);
    return true;
  } catch {
    // WebGL2 not available — DOM renderer stays active
    return false;
  }
}

/**
 * Dispose the WebGL renderer addon. Terminal falls back to DOM renderer.
 * Safe to call even if WebGL was never attached.
 */
export function disposeWebGL(term: Terminal): void {
  const addon = webglAddons.get(term);
  if (addon) {
    try { addon.dispose(); } catch {}
    webglAddons.delete(term);
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/terminal.ts package.json package-lock.json
git commit -m "feat(terminal): add WebGL renderer utilities with context loss fallback"
```

---

## Task 4: Attach WebGL in Terminal Consumers

**Files:**
- Modify: `src/hooks/useAgentTerminal.ts`
- Modify: `src/components/TerminalsView/hooks/useMultiTerminal.ts`
- Modify: `src/components/AgentTerminalDialog/useQuickTerminal.ts`
- Modify: `src/components/MosaicTerminalView/TerminalTile.tsx`

- [ ] **Step 1: useAgentTerminal — attach WebGL after `term.open()`**

In `src/hooks/useAgentTerminal.ts`, add import:
```typescript
import { attachKeyHandler, attachWebGL, disposeWebGL } from '@/lib/terminal';
```

After `term.open(container)` (line 97), add:
```typescript
      // Attach WebGL renderer (falls back to DOM silently)
      attachWebGL(term);
```

In the cleanup function (around line 233), before `xtermRef.current.dispose()`, add:
```typescript
        disposeWebGL(xtermRef.current);
```

- [ ] **Step 2: useMultiTerminal — attach WebGL after `term.open()` with tab-aware lifecycle**

In `src/components/TerminalsView/hooks/useMultiTerminal.ts`, add import:
```typescript
import { attachKeyHandler, attachWebGL, disposeWebGL } from '@/lib/terminal';
```

After `term.open(container)` (line 158), add:
```typescript
      // Attach WebGL renderer (falls back to DOM silently)
      attachWebGL(term);
```

In the `unregisterContainer` function (around line 266), before `entry.terminal.dispose()`, add:
```typescript
        disposeWebGL(entry.terminal);
```

In the global cleanup (around line 421), before `entry.terminal.dispose()`, add:
```typescript
          disposeWebGL(entry.terminal);
```

- [ ] **Step 3: useQuickTerminal — attach WebGL after `term.open()`**

In `src/components/AgentTerminalDialog/useQuickTerminal.ts`, add import:
```typescript
import { attachKeyHandler, attachWebGL, disposeWebGL } from '@/lib/terminal';
```

After `term.open(quickTerminalRef.current)` (line 73), add:
```typescript
        attachWebGL(term);
```

In the cleanup (line 134), before dispose:
```typescript
        disposeWebGL(quickXtermRef.current);
```

And in the dialog close effect (line 146), before dispose:
```typescript
        disposeWebGL(quickXtermRef.current);
```

- [ ] **Step 4: TerminalTile — attach WebGL after `term.open()`**

In `src/components/MosaicTerminalView/TerminalTile.tsx`, add import:
```typescript
import { attachKeyHandler, attachWebGL, disposeWebGL } from '@/lib/terminal';
```

After `term.open(container)` (line 74), add:
```typescript
      attachWebGL(term);
```

In the cleanup (line 143), before `term.dispose()`, add:
```typescript
        disposeWebGL(term);
```

- [ ] **Step 5: Verify build**

Run: `npm run build 2>&1 | head -30`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useAgentTerminal.ts src/components/TerminalsView/hooks/useMultiTerminal.ts src/components/AgentTerminalDialog/useQuickTerminal.ts src/components/MosaicTerminalView/TerminalTile.tsx
git commit -m "feat(terminal): attach WebGL renderer in all terminal consumers"
```

---

## Task 5: Rust Backend — Add `pty_pause` and `pty_resume`

**Files:**
- Modify: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/commands/pty.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `paused` flag to `PtyHandle`**

In `src-tauri/src/pty.rs`, add `AtomicBool` import:
```rust
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
```

Add `paused` field to `PtyHandle`:
```rust
pub struct PtyHandle {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send>,
    pub agent_id: String,
    pub child_pid: Option<u32>,
    pub paused: Arc<AtomicBool>,
}
```

- [ ] **Step 2: Update `spawn()` to use `paused` flag in reader thread**

In the `spawn` method, create the flag and clone it for the reader thread:

```rust
        let paused = Arc::new(AtomicBool::new(false));
        let paused_clone = Arc::clone(&paused);
```

Update the reader thread to check `paused` after each successful read:

```rust
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        // Flow control: wait while paused (max 500 iterations = 5s safety)
                        let mut wait_count = 0;
                        while paused_clone.load(Ordering::Relaxed) && wait_count < 500 {
                            thread::sleep(std::time::Duration::from_millis(10));
                            wait_count += 1;
                        }
                        // Auto-resume after safety timeout
                        if wait_count >= 500 {
                            paused_clone.store(false, Ordering::Relaxed);
                        }

                        let event = PtyOutputEvent {
                            agent_id: agent_id_owned.clone(),
                            pty_id: pty_id_owned.clone(),
                            data: buf[..n].to_vec(),
                        };
                        if handle.emit("agent:output", event).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
```

Update the `PtyHandle` construction:
```rust
        let pty_handle = PtyHandle {
            master: pair.master,
            writer,
            child,
            agent_id: agent_id.to_string(),
            child_pid,
            paused,
        };
```

- [ ] **Step 3: Add `pause` and `resume` methods to `PtyManager`**

In `src-tauri/src/pty.rs`, add after the `kill` method:

```rust
    /// Pause PTY output emission (flow control from frontend).
    pub fn pause(&self, pty_id: &str) -> Result<(), String> {
        let handles = self.handles.lock().unwrap();
        let handle = handles
            .get(pty_id)
            .ok_or_else(|| format!("pty not found: {pty_id}"))?;
        handle.paused.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Resume PTY output emission.
    pub fn resume(&self, pty_id: &str) -> Result<(), String> {
        let handles = self.handles.lock().unwrap();
        let handle = handles
            .get(pty_id)
            .ok_or_else(|| format!("pty not found: {pty_id}"))?;
        handle.paused.store(false, Ordering::Relaxed);
        Ok(())
    }
```

- [ ] **Step 4: Add IPC commands**

In `src-tauri/src/commands/pty.rs`, add:

```rust
#[tauri::command]
pub fn pty_pause(pty_manager: State<'_, Arc<PtyManager>>, pty_id: String) -> Result<(), String> {
    pty_manager.pause(&pty_id)
}

#[tauri::command]
pub fn pty_resume(pty_manager: State<'_, Arc<PtyManager>>, pty_id: String) -> Result<(), String> {
    pty_manager.resume(&pty_id)
}
```

- [ ] **Step 5: Register commands in `lib.rs`**

In `src-tauri/src/lib.rs`, add to the `invoke_handler` block after `commands::pty::pty_lookup`:

```rust
            commands::pty::pty_pause,
            commands::pty::pty_resume,
```

- [ ] **Step 6: Verify Rust build**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/pty.rs src-tauri/src/commands/pty.rs src-tauri/src/lib.rs
git commit -m "feat(pty): add pause/resume flow control commands with 5s safety timeout"
```

---

## Task 6: Create TerminalWriteManager

**Files:**
- Create: `src/lib/terminal-write.ts`

- [ ] **Step 1: Create the TerminalWriteManager module**

```typescript
import type { Terminal } from 'xterm';
import { invoke } from '@tauri-apps/api/core';

const HIGH_WATERMARK = 500 * 1024; // 500KB
const LOW_WATERMARK = 100 * 1024;  // 100KB

interface Subscription {
  term: Terminal;
  ptyId: string;
  pendingBytes: number;
  paused: boolean;
}

/**
 * Centralized terminal output writer with flow control.
 *
 * Instead of each hook listening to 'agent:output' independently,
 * consumers subscribe via subscribe(key, term, ptyId) and this manager
 * routes output + applies watermark-based backpressure.
 */
class TerminalWriteManagerImpl {
  private subs = new Map<string, Subscription>();

  /**
   * Subscribe a terminal to receive PTY output for the given key.
   * The key is typically agentId or ptyId — whatever the event payload uses to identify the stream.
   *
   * @param key    - Routing key (matched against agent_id and pty_id in events)
   * @param term   - xterm Terminal instance to write data to
   * @param ptyId  - PTY identifier for pause/resume commands
   */
  subscribe(key: string, term: Terminal, ptyId: string): void {
    this.subs.set(key, { term, ptyId, pendingBytes: 0, paused: false });
  }

  /**
   * Unsubscribe and clean up. If the PTY was paused, resume it.
   */
  unsubscribe(key: string): void {
    const sub = this.subs.get(key);
    if (sub?.paused) {
      invoke('pty_resume', { ptyId: sub.ptyId }).catch(() => {});
    }
    this.subs.delete(key);
  }

  /**
   * Write PTY output bytes to the subscribed terminal with flow control.
   * Called by the global agent:output listener.
   */
  write(key: string, data: Uint8Array): void {
    const sub = this.subs.get(key);
    if (!sub) return;

    const size = data.byteLength;
    sub.pendingBytes += size;

    sub.term.write(data, () => {
      sub.pendingBytes -= size;

      // Resume if we dropped below low watermark
      if (sub.paused && sub.pendingBytes <= LOW_WATERMARK) {
        sub.paused = false;
        invoke('pty_resume', { ptyId: sub.ptyId }).catch(() => {});
      }
    });

    // Pause if we exceeded high watermark
    if (!sub.paused && sub.pendingBytes >= HIGH_WATERMARK) {
      sub.paused = true;
      invoke('pty_pause', { ptyId: sub.ptyId }).catch(() => {});
    }
  }

  /**
   * Check if a key has an active subscription.
   */
  has(key: string): boolean {
    return this.subs.has(key);
  }
}

export const TerminalWriteManager = new TerminalWriteManagerImpl();
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | head -30`
Expected: No errors (module is created but not yet imported anywhere)

- [ ] **Step 3: Commit**

```bash
git add src/lib/terminal-write.ts
git commit -m "feat(terminal): add TerminalWriteManager with watermark-based flow control"
```

---

## Task 7: Migrate `useMultiTerminal` to TerminalWriteManager

**Files:**
- Modify: `src/components/TerminalsView/hooks/useMultiTerminal.ts`

- [ ] **Step 1: Replace the `agent:output` listener with TerminalWriteManager**

Add import:
```typescript
import { TerminalWriteManager } from '@/lib/terminal-write';
```

In `initTerminal`, after the terminal is fully set up and `onTerminalReadyRef.current?.(agentId)` is called (line 235), subscribe:
```typescript
      // Subscribe to PTY output via centralized write manager (flow control)
      TerminalWriteManager.subscribe(agentId, term, agentId);
```

In `unregisterContainer` (around line 262), before dispose, unsubscribe:
```typescript
    TerminalWriteManager.unsubscribe(agentId);
```

In the global cleanup effect (around line 417), before dispose:
```typescript
          TerminalWriteManager.unsubscribe(agentId);
```
(where `agentId` comes from the `forEach` — use the map key)

Replace the `agent:output` listener effect (lines 393-414). The `agent:output` listener stays but routes through the manager:

```typescript
  // Single global onOutput listener that dispatches to correct terminal
  useEffect(() => {
    if (!isTauri()) return;

    let unsubOutput: (() => void) | undefined;
    let unsubError: (() => void) | undefined;

    listen<{ agent_id: string; pty_id: string; data: number[] }>('agent:output', (event) => {
      const { agent_id, data } = event.payload;
      const bytes = new Uint8Array(data);
      // Route through TerminalWriteManager for flow control
      if (TerminalWriteManager.has(agent_id)) {
        TerminalWriteManager.write(agent_id, bytes);
      } else {
        // Fallback: direct write for terminals not yet subscribed
        writeToTerminal(agent_id, bytes);
      }
    }).then(fn => { unsubOutput = fn; });

    listen<{ agentId: string; data: string }>('agent:error', (event) => {
      const e = event.payload;
      writeToTerminal(e.agentId, `\x1b[31m${e.data}\x1b[0m`);
    }).then(fn => { unsubError = fn; });

    return () => {
      unsubOutput?.();
      unsubError?.();
    };
  }, [writeToTerminal]);
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/TerminalsView/hooks/useMultiTerminal.ts
git commit -m "feat(terminal): migrate useMultiTerminal to TerminalWriteManager"
```

---

## Task 8: Migrate `useAgentTerminal` to TerminalWriteManager

**Files:**
- Modify: `src/hooks/useAgentTerminal.ts`

- [ ] **Step 1: Replace `agent:output` listener with TerminalWriteManager**

Add import:
```typescript
import { TerminalWriteManager } from '@/lib/terminal-write';
```

In `initTerminal`, after `onReadyRef.current?.(selectedAgentId)` (line 180), subscribe:
```typescript
      TerminalWriteManager.subscribe(selectedAgentId, term, selectedAgentId);
```

In the cleanup (line 227), before dispose:
```typescript
      if (selectedAgentId) TerminalWriteManager.unsubscribe(selectedAgentId);
```

Replace the `agent:output` listener effect (lines 243-262):
```typescript
  // Listen for agent output events — route through TerminalWriteManager
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    listen<{ agent_id: string; pty_id: string; data: number[] }>('agent:output', (event) => {
      const { agent_id, data } = event.payload;
      if (agent_id === selectedAgentIdRef.current) {
        const bytes = new Uint8Array(data);
        if (TerminalWriteManager.has(agent_id)) {
          TerminalWriteManager.write(agent_id, bytes);
        } else if (xtermRef.current) {
          xtermRef.current.write(bytes);
        }
      }
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAgentTerminal.ts
git commit -m "feat(terminal): migrate useAgentTerminal to TerminalWriteManager"
```

---

## Task 9: Migrate `TerminalTile` and `useQuickTerminal` to TerminalWriteManager

**Files:**
- Modify: `src/components/MosaicTerminalView/TerminalTile.tsx`
- Modify: `src/components/AgentTerminalDialog/useQuickTerminal.ts`

- [ ] **Step 1: Migrate TerminalTile**

Add import:
```typescript
import { TerminalWriteManager } from '@/lib/terminal-write';
```

After the PTY is resolved and `ptyId` is known (around line 110), replace the `agent:output` listener (lines 116-120):

```typescript
      // Subscribe to flow-controlled output
      TerminalWriteManager.subscribe(ptyId, term, ptyId);

      // Listen for PTY output and route through manager
      let unsubOutput: (() => void) | undefined;
      listen<{ agent_id: string; pty_id: string; data: number[] }>('agent:output', (event) => {
        if ((event.payload.agent_id === ptyId || event.payload.pty_id === ptyId) && !disposed) {
          TerminalWriteManager.write(ptyId, new Uint8Array(event.payload.data));
        }
      }).then(fn => { unsubOutput = fn; });
```

In cleanup (line 142), add before `term.dispose()`:
```typescript
        TerminalWriteManager.unsubscribe(ptyId);
```

And add `unsubOutput?.()` to cleanup if not already there.

- [ ] **Step 2: Migrate useQuickTerminal**

Add import:
```typescript
import { TerminalWriteManager } from '@/lib/terminal-write';
```

In the `agent:output` listener effect (lines 156-173), replace the `term.write` call:

```typescript
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    listen<{ agent_id: string; pty_id: string; data: number[] }>('agent:output', (event) => {
      if (!agentId) return;
      const existing = persistentTerminals.get(agentId);
      if (!existing || event.payload.pty_id !== existing.ptyId) return;

      const bytes = new Uint8Array(event.payload.data);
      existing.outputBuffer.push(bytes);
      if (existing.outputBuffer.length > 1000) existing.outputBuffer.shift();

      // Route through flow control if subscribed, else direct write
      if (TerminalWriteManager.has(existing.ptyId)) {
        TerminalWriteManager.write(existing.ptyId, bytes);
      } else {
        quickXtermRef.current?.write(bytes);
      }
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [agentId]);
```

After `setQuickTerminalReady(true)` (lines 91, 97), subscribe:
```typescript
          TerminalWriteManager.subscribe(existing.ptyId, term, existing.ptyId);
```
and:
```typescript
            TerminalWriteManager.subscribe(ptyId, term, ptyId);
```

In `closeQuickTerminal` (line 175), add before PTY kill:
```typescript
      if (existing) TerminalWriteManager.unsubscribe(existing.ptyId);
```

In the dialog close effect (line 144), add:
```typescript
      if (agentId) {
        const existing = persistentTerminals.get(agentId);
        if (existing) TerminalWriteManager.unsubscribe(existing.ptyId);
      }
```

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/MosaicTerminalView/TerminalTile.tsx src/components/AgentTerminalDialog/useQuickTerminal.ts
git commit -m "feat(terminal): migrate TerminalTile and useQuickTerminal to TerminalWriteManager"
```

---

## Task 10: Manual Verification

- [ ] **Step 1: Full build check**

Run: `npm run tauri:build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 2: Manual test checklist**

Launch the app with `npm run tauri:dev` and verify:

1. **WebGL**: Open a terminal — text should render sharply. Open DevTools console, look for WebGL context creation logs. No errors.
2. **Ctrl+C copy**: Select text in terminal, press Ctrl+C → text copied to clipboard. Verify with Ctrl+V in another app.
3. **Ctrl+C SIGINT**: Without selection, press Ctrl+C → running process receives SIGINT (e.g., start `sleep 100`, Ctrl+C should kill it).
4. **Ctrl+V paste**: Copy text from elsewhere, press Ctrl+V in terminal → text appears.
5. **Shift+Enter**: Still inserts newline, not submit.
6. **Tab switch**: Switch between tabs → terminals re-render correctly, no blank screens, no data loss.
7. **Flow control**: Run `cat /dev/urandom | base64 | head -c 5000000` in a terminal → should not crash the browser. Output streams smoothly.
8. **Multiple terminals**: Open 4+ terminals in one tab → all render correctly.

- [ ] **Step 3: Commit any fixes if needed**
