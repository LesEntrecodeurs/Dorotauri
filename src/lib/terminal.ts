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
