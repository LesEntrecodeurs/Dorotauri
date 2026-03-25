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
}

export function isSuperAgent(agent: { name?: string } | null): boolean {
  if (!agent) return false;
  const name = agent.name?.toLowerCase() || '';
  return name.includes('super agent') || name.includes('orchestrator');
}
