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
