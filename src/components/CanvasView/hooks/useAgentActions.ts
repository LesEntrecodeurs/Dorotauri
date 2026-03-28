import { useState, useCallback } from 'react';
import type { AgentCharacter, Agent } from '@/types/electron';

interface CreateAgentConfig {
  skills: string[];
  worktree?: { enabled: boolean; branchName: string };
  character?: AgentCharacter;
  name?: string;
  skipPermissions?: boolean;
}

interface UseAgentActionsProps {
  stopAgent: (id: string) => void;
  startAgent: (id: string, prompt: string, options?: { model?: string }) => Promise<void>;
  createAgent: (config: CreateAgentConfig) => Promise<Agent>;
  setTerminalAgentId: (id: string | null) => void;
}

export function useAgentActions({
  stopAgent,
  startAgent,
  createAgent,
  setTerminalAgentId,
}: UseAgentActionsProps) {
  const [showCreateAgentModal, setShowCreateAgentModal] = useState(false);
  const [createAgentProjectPath, setCreateAgentProjectPath] = useState<string | null>(null);

  const handleToggleAgent = useCallback(async (agentId: string, isRunning: boolean) => {
    if (isRunning) {
      stopAgent(agentId);
    } else {
      try {
        await startAgent(agentId, 'Hello');
        setTerminalAgentId(agentId);
      } catch (error) {
        console.error('Failed to start agent:', error);
      }
    }
  }, [stopAgent, startAgent, setTerminalAgentId]);

  const handleStartAgent = useCallback(async (agentId: string, prompt: string) => {
    try {
      await startAgent(agentId, prompt);
    } catch (error) {
      console.error('Failed to start agent:', error);
    }
  }, [startAgent]);

  const handleStopAgent = useCallback((agentId: string) => {
    stopAgent(agentId);
  }, [stopAgent]);

  const handleAddAgentToProject = useCallback((projectPath: string) => {
    setCreateAgentProjectPath(projectPath);
    setShowCreateAgentModal(true);
  }, []);

  const handleCreateAgent = useCallback(async (
    skills: string[],
    prompt: string,
    model?: string,
    worktree?: { enabled: boolean; branchName: string },
    character?: AgentCharacter,
    name?: string,
    skipPermissions?: boolean,
    _provider?: import('@/types/electron').AgentProvider,
    _localModel?: string,
    _obsidianVaultPaths?: string[],
  ) => {
    try {
      const agent = await createAgent({ skills, worktree, character, name, skipPermissions });
      setShowCreateAgentModal(false);
      setCreateAgentProjectPath(null);

      if (prompt) {
        setTimeout(async () => {
          await startAgent(agent.id, prompt, { model });
          setTerminalAgentId(agent.id);
        }, 600);
      }
    } catch (error) {
      console.error('Failed to create agent:', error);
    }
  }, [createAgent, startAgent, setTerminalAgentId]);

  const closeCreateAgentModal = useCallback(() => {
    setShowCreateAgentModal(false);
    setCreateAgentProjectPath(null);
  }, []);

  return {
    showCreateAgentModal,
    createAgentProjectPath,
    handleToggleAgent,
    handleStartAgent,
    handleStopAgent,
    handleAddAgentToProject,
    handleCreateAgent,
    closeCreateAgentModal,
  };
}
