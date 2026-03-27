import { useState, useEffect, useRef, useCallback } from 'react';

const WS_BASE = 'ws://localhost:31415';

// WebSocket event types (matching Rust AgentEvent)
interface AgentCreatedEvent {
  type: 'created';
  agent_id: string;
  parent_id?: string;
  tab_id: string;
}

interface AgentStateChangedEvent {
  type: 'state_changed';
  agent_id: string;
  old: string;
  new: string;
}

interface AgentRemovedEvent {
  type: 'removed';
  agent_id: string;
}

interface AgentStatusLineUpdatedEvent {
  type: 'status_line_updated';
  agent_id: string;
  line: string;
}

type AgentWsEvent =
  | AgentCreatedEvent
  | AgentStateChangedEvent
  | AgentRemovedEvent
  | AgentStatusLineUpdatedEvent;

/**
 * Subscribe to the global agent event stream via WebSocket.
 * Returns events that the consumer can react to.
 */
export function useAgentEvents(onEvent?: (event: AgentWsEvent) => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/ws/events`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 2s
      setTimeout(() => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
      }, 2000);
    };
    ws.onmessage = (msg) => {
      try {
        const event: AgentWsEvent = JSON.parse(msg.data);
        onEventRef.current?.(event);
      } catch {
        // ignore malformed messages
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  return { connected };
}

/**
 * Duplex WebSocket connection to a specific agent's PTY.
 * Returns:
 * - write(data): send input to the PTY
 * - resize(cols, rows): resize the PTY
 * - onData callback is called with raw output bytes
 */
export function useAgentPtyWebSocket(
  agentId: string | null,
  onData: (data: Uint8Array) => void,
) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  useEffect(() => {
    if (!agentId) return;

    const ws = new WebSocket(`${WS_BASE}/ws/pty/${agentId}`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (msg) => {
      if (msg.data instanceof ArrayBuffer) {
        onDataRef.current(new Uint8Array(msg.data));
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [agentId]);

  const write = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  return { connected, write, resize };
}
