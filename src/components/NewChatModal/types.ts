import type { AgentCharacter, AgentProvider } from '@/types/electron';
import type { ClaudeSkill } from '@/lib/claude-code';

export interface AgentPersonaValues {
  character: AgentCharacter;
  name: string;
}

export interface WorktreeConfig {
  enabled: boolean;
  branchName: string;
}

export interface EditAgentData {
  id: string;
  name?: string;
  character?: AgentCharacter;
  secondaryPaths?: string[];
  skills: string[];
  skipPermissions?: boolean;
  provider?: AgentProvider;
  localModel?: string;
  branchName?: string;
  obsidianVaultPaths?: string[];
}

export interface NewChatModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    skills: string[],
    prompt: string,
    model?: string,
    worktree?: WorktreeConfig,
    character?: AgentCharacter,
    name?: string,
    skipPermissions?: boolean,
    provider?: AgentProvider,
    localModel?: string,
    obsidianVaultPaths?: string[],
    isSuperAgent?: boolean,
    superAgentScope?: 'tab' | 'all',
  ) => void;
  onUpdate?: (id: string, updates: {
    skills?: string[];
    secondaryPaths?: string[] | null;
    skipPermissions?: boolean;
    name?: string;
    character?: AgentCharacter;
  }) => void;
  editAgent?: EditAgentData | null;
  installedSkills?: string[];
  allInstalledSkills?: ClaudeSkill[];
  onRefreshSkills?: () => void;
  initialStep?: number;
}
