import { useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/hooks/useTauri';
import type { Agent, AgentCharacter } from '@/types/electron';
import { ORCHESTRATOR_PROMPT } from '@/components/AgentList/constants';

interface Project {
  path: string;
  name: string;
}

interface UseSuperAgentProps {
  agents: Agent[];
  projects: Project[];
  createAgent: (params: {
    cwd: string;
    skills: string[];
    character?: AgentCharacter;
    name?: string;
    skipPermissions?: boolean;
  }) => Promise<Agent>;
  startAgent: (id: string, prompt: string) => Promise<void>;
  onAgentCreated?: (agentId: string) => void;
}

export function useSuperAgent({
  agents,
  projects,
  createAgent,
  startAgent,
  onAgentCreated,
}: UseSuperAgentProps) {
  const [isCreatingSuperAgent, setIsCreatingSuperAgent] = useState(false);

  const superAgent = useMemo(() => {
    return agents.find(a =>
      a.name?.toLowerCase().includes('super agent') ||
      a.name?.toLowerCase().includes('orchestrator')
    ) || null;
  }, [agents]);

  const handleSuperAgentClick = useCallback(async () => {
    // If super agent exists
    if (superAgent) {
      // If inactive, restart it with the orchestrator prompt
      if (superAgent.processState === 'inactive' || superAgent.processState === 'completed' || superAgent.processState === 'error') {
        await startAgent(superAgent.id, ORCHESTRATOR_PROMPT);
      }
      onAgentCreated?.(superAgent.id);
      return;
    }

    // Check if orchestrator is configured
    if (!isTauri()) {
      console.error('Tauri API not available');
      return;
    }

    try {
      const status = await invoke<{ configured: boolean; error?: string }>('orchestrator_get_status');

      // If not configured, set it up first
      if (!status.configured) {
        try {
          const setupResult = await invoke<{ success: boolean; error?: string }>('orchestrator_setup');
          if (!setupResult.success) {
            console.error('Failed to setup orchestrator:', setupResult.error);
            return;
          }
        } catch (err) {
          console.error('Failed to setup orchestrator:', err);
          return;
        }
      }
    } catch {
      // Rust commands not implemented yet — skip orchestrator check
    }

    // Create a new super agent
    setIsCreatingSuperAgent(true);
    try {
      // Use the first project path or a default
      const cwd = projects[0]?.path || '/tmp';

      const agent = await createAgent({
        cwd,
        skills: [],
        character: 'wizard',
        name: 'Super Agent (Orchestrator)',
        skipPermissions: true,
      });

      onAgentCreated?.(agent.id);

      // Start with orchestrator instructions
      setTimeout(async () => {
        await startAgent(agent.id, ORCHESTRATOR_PROMPT);
      }, 600);
    } catch (error) {
      console.error('Failed to create super agent:', error);
    } finally {
      setIsCreatingSuperAgent(false);
    }
  }, [superAgent, projects, createAgent, startAgent, onAgentCreated]);

  return {
    superAgent,
    isCreatingSuperAgent,
    handleSuperAgentClick,
  };
}
