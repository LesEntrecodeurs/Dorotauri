// Re-export agent types from the canonical source
export type { Agent, AgentCharacter, AgentProvider, ProcessState, Tab } from './electron.d';

export interface AgentEvent {
  type: 'output' | 'status' | 'error' | 'complete' | 'tool_use' | 'thinking' | 'init';
  agentId: string;
  data: string;
  timestamp: string;
  agent?: import('./electron.d').Agent;
}
