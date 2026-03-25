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
  // Skip WebGL on Linux — WebKitGTK's WebGL2 is significantly slower than
  // macOS WebKit, causing UI lag with multiple terminal contexts.
  // The DOM/canvas renderer is performant enough for terminal rendering.
  if (/Linux/.test(navigator.platform)) return false;

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

