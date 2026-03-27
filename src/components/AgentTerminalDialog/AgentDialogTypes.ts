import type { Agent } from '@/types/electron';

export type PanelType = 'code' | 'git' | 'terminal' | 'context' | 'settings';

export interface AgentTerminalDialogProps {
  agent: Agent | null;
  open: boolean;
  onClose: () => void;
  onStart: (agentId: string, prompt: string) => void;
  onStop: (agentId: string) => void;
  projects?: { path: string; name: string }[];
  agents?: Agent[];
  onBrowseFolder?: () => Promise<string | null>;
  onAgentUpdated?: (agent: Agent) => void;
  onUpdateAgent?: (params: {
    id: string;
    skills?: string[];
    secondaryPaths?: string[] | null;
    skipPermissions?: boolean;
  }) => Promise<{ success: boolean; error?: string; agent?: Agent }>;
  initialPanel?: PanelType;
  skipHistoricalOutput?: boolean;
  /** Called when a sub-agent is spawned by the current agent so the parent can auto-open its terminal */
  onSubAgentCreated?: (subAgentId: string) => void;
}

export function isSuperAgent(agent: { name?: string; role?: { type: string } } | null): boolean {
  if (!agent) return false;
  if ((agent as any).role?.type === 'super') return true;
  const name = agent.name?.toLowerCase() || '';
  return name.includes('super agent') || name.includes('orchestrator');
}

export function isAgentSuperRole(agent: { role?: { type: string } }): boolean {
  return agent.role?.type === 'super';
}
