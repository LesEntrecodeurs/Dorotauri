import { useEffect, useState, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@/hooks/useTauri';
import { useAgentEvents } from '@/hooks/useAgentWebSocket';
import type { Agent, AgentEvent, AgentCharacter, AgentProvider, AgentTickItem } from '@/types/electron';

// Re-export isTauri as isElectron for backward compatibility with consuming components
export const isElectron = isTauri;

// Hook for agent management via Tauri invoke
export function useElectronAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch all agents
  const fetchAgents = useCallback(async () => {
    if (!isTauri()) {
      setIsLoading(false);
      return;
    }

    try {
      const rawList = await invoke<Agent[]>('agent_list');
      // Normalize: ensure processState is set from state for backward compat
      const list = rawList.map(a => ({ ...a, processState: a.processState ?? a.state ?? 'inactive' } as Agent));
      // Only update state if data has actually changed to prevent unnecessary re-renders
      setAgents(prev => {
        // Quick length check first
        if (prev.length !== list.length) return list;
        // Compare each agent's key fields
        const hasChanged = list.some((agent, i) => {
          const prevAgent = prev[i];
          return (
            prevAgent.id !== agent.id ||
            prevAgent.processState !== agent.processState ||
            prevAgent.lastActivity !== agent.lastActivity
          );
        });
        return hasChanged ? list : prev;
      });
    } catch {
      // Rust commands not implemented yet — return empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Create a new agent
  const createAgent = useCallback(async (config: {
    cwd?: string;
    skills?: string[];
    worktree?: { enabled: boolean; branchName: string };
    character?: AgentCharacter;
    name?: string;
    secondaryPaths?: string[];
    skipPermissions?: boolean;
    provider?: AgentProvider;
    localModel?: string;
    obsidianVaultPaths?: string[];
    tabId?: string;
  }) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }
    try {
      const agent = await invoke<Agent>('agent_create', { config });
      setAgents(prev => [...prev, agent]);
      return agent;
    } catch (err) {
      throw err;
    }
  }, []);

  // Update an agent
  const updateAgent = useCallback(async (params: {
    id: string;
    [key: string]: unknown;
  }) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }
    try {
      const result = await invoke<{ success: boolean; error?: string; agent?: Agent }>('agent_update', { params });
      if (result.success && result.agent) {
        setAgents(prev => prev.map(a => a.id === params.id ? result.agent! : a));
      }
      return result;
    } catch (err) {
      throw err;
    }
  }, []);

  // Start an agent
  const startAgent = useCallback(async (
    id: string,
    prompt: string,
    options?: { model?: string; resume?: boolean; provider?: AgentProvider; localModel?: string }
  ) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }
    try {
      await invoke('agent_start', { id, prompt, options });
      await fetchAgents();
    } catch (err) {
      throw err;
    }
  }, [fetchAgents]);

  // Stop an agent
  const stopAgent = useCallback(async (id: string) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }
    try {
      await invoke('agent_stop', { id });
      await fetchAgents();
    } catch (err) {
      throw err;
    }
  }, [fetchAgents]);

  // Remove an agent
  const removeAgent = useCallback(async (id: string) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }
    try {
      await invoke('agent_remove', { id });
      setAgents(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      throw err;
    }
  }, []);

  // Send input to an agent
  const sendInput = useCallback(async (id: string, input: string) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }
    try {
      await invoke('agent_send_input', { id, input });
    } catch (err) {
      throw err;
    }
  }, []);

  // Set an agent to dormant state
  const setDormant = useCallback(async (id: string) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }
    await invoke('agent_set_dormant', { id });
    fetchAgents();
  }, [fetchAgents]);

  // Reanimate a dormant agent
  const reanimateAgent = useCallback(async (id: string): Promise<Agent> => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }
    const agent = await invoke<Agent>('agent_reanimate', { id });
    fetchAgents();
    return agent;
  }, [fetchAgents]);

  // Update the business state of an agent
  const updateBusinessState = useCallback(async (id: string, businessState: string) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }
    await invoke('agent_update_business_state', { id, businessState });
  }, []);

  // Subscribe to real-time WebSocket events for instant agent state updates
  useAgentEvents((event) => {
    switch (event.type) {
      case 'state_changed':
        setAgents(prev => prev.map(a =>
          a.id === event.agent_id
            ? { ...a, state: event.new as Agent['state'], processState: event.new as Agent['state'] }
            : a
        ));
        break;
      case 'created':
        // Refresh full list to get the new agent's complete data
        fetchAgents();
        break;
      case 'removed':
        setAgents(prev => prev.filter(a => a.id !== event.agent_id));
        break;
      case 'status_line_updated':
        setAgents(prev => prev.map(a =>
          a.id === event.agent_id
            ? { ...a, statusLine: event.line }
            : a
        ));
        break;
    }
  });

  // Subscribe to Tauri agent events (kept as fallback for non-WebSocket consumers)
  useEffect(() => {
    if (!isTauri()) return;

    const unlistenFns: (() => void)[] = [];

    // Output events are handled directly by xterm.js terminals.
    listen<AgentEvent>('agent:output', () => {}).then(fn => unlistenFns.push(fn));

    listen<AgentEvent>('agent:error', () => {}).then(fn => unlistenFns.push(fn));

    listen<AgentEvent>('agent:complete', () => {
      fetchAgents();
    }).then(fn => unlistenFns.push(fn));

    listen<{ agentId: string }>('agent:removed', (event) => {
      const { agentId } = event.payload;
      setAgents(prev => prev.filter(a => a.id !== agentId));
    }).then(fn => unlistenFns.push(fn));

    listen<Record<string, unknown>>('agent:status', (event) => {
      const e = event.payload;
      // The payload may be a full Agent struct (has `id`) or a minimal object (has `agentId`)
      const agentId = (e.agentId ?? e.id) as string | undefined;
      if (!agentId) return;
      setAgents(prev => prev.map(a => {
        if (a.id !== agentId) return a;
        const updates: Partial<Agent> = {};
        if (e.processState) updates.processState = e.processState as Agent['processState'];
        if (e.lastActivity) updates.lastActivity = e.lastActivity as string;
        else updates.lastActivity = new Date().toISOString();
        if (e.ptyId !== undefined) updates.ptyId = e.ptyId as string;
        return { ...a, ...updates };
      }));
    }).then(fn => unlistenFns.push(fn));

    // Also subscribe to agents:tick for reliable live status updates
    listen<AgentTickItem[]>('agents:tick', (event) => {
      const tickAgents = event.payload;
      setAgents(prev => {
        // When an agent was removed, filter it out of local state
        if (prev.length > tickAgents.length) {
          const tickIds = new Set(tickAgents.map(t => t.id));
          const filtered = prev.filter(a => tickIds.has(a.id));
          // Also apply status updates
          return filtered.map(a => {
            const tick = tickAgents.find(t => t.id === a.id);
            if (tick && a.processState !== tick.processState) {
              return { ...a, processState: tick.processState as Agent['processState'], lastActivity: tick.lastActivity };
            }
            return a;
          });
        }
        // When an agent was added externally, do a full refresh
        if (prev.length < tickAgents.length) {
          fetchAgents();
          return prev;
        }
        const hasStatusChange = tickAgents.some(t => {
          const existing = prev.find(a => a.id === t.id);
          return existing && existing.processState !== t.processState;
        });
        if (!hasStatusChange) return prev;
        return prev.map(a => {
          const tick = tickAgents.find(t => t.id === a.id);
          if (tick && a.processState !== tick.processState) {
            return { ...a, processState: tick.processState as Agent['processState'], lastActivity: tick.lastActivity };
          }
          return a;
        });
      });
    }).then(fn => unlistenFns.push(fn));

    const cwdUnlisten = listen('agent:cwd-changed', (event: any) => {
      const { agentId, cwd } = event.payload;
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, cwd } : a));
    });
    cwdUnlisten.then(fn => unlistenFns.push(fn));

    return () => {
      unlistenFns.forEach(fn => fn());
    };
  }, [fetchAgents]);

  // Initial fetch
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return {
    agents,
    isLoading,
    isElectron: isTauri(),
    createAgent,
    updateAgent,
    startAgent,
    stopAgent,
    removeAgent,
    sendInput,
    setDormant,
    reanimateAgent,
    updateBusinessState,
    refresh: fetchAgents,
  };
}

// Hook for skill management via Tauri invoke
export function useElectronSkills() {
  const [installedSkillsByProvider, setInstalledSkillsByProvider] = useState<Record<string, string[]>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Flat list derived from all providers (backward compat)
  const installedSkills = useMemo(() => {
    const all = new Set<string>();
    for (const skills of Object.values(installedSkillsByProvider)) {
      for (const s of skills) all.add(s);
    }
    return Array.from(all);
  }, [installedSkillsByProvider]);

  const isSkillInstalledOn = useCallback((name: string, provider: string): boolean => {
    const skills = installedSkillsByProvider[provider];
    if (!skills) return false;
    return skills.some(s => s.toLowerCase() === name.toLowerCase());
  }, [installedSkillsByProvider]);

  const fetchInstalledSkills = useCallback(async () => {
    if (!isTauri()) {
      setIsLoading(false);
      return;
    }

    try {
      const byProvider = await invoke<Record<string, string[]>>('skill_list_installed_all');
      setInstalledSkillsByProvider(byProvider);
    } catch {
      // Rust commands not implemented yet — return empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  const installSkill = useCallback(async (repo: string) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }
    try {
      const result = await invoke<{ success: boolean; output?: string; message?: string }>('skill_install', { repo });
      await fetchInstalledSkills();
      return result;
    } catch (err) {
      throw err;
    }
  }, [fetchInstalledSkills]);

  const linkToProvider = useCallback(async (skillName: string, providerId: string) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }
    try {
      return await invoke<{ success: boolean; error?: string }>('skill_link_to_provider', { skillName, providerId });
    } catch (err) {
      throw err;
    }
  }, []);

  useEffect(() => {
    fetchInstalledSkills();
  }, [fetchInstalledSkills]);

  return {
    installedSkills,
    installedSkillsByProvider,
    isSkillInstalledOn,
    isLoading,
    isElectron: isTauri(),
    installSkill,
    linkToProvider,
    refresh: fetchInstalledSkills,
  };
}

// Hook for file system operations via Tauri invoke
export function useElectronFS() {
  const [projects, setProjects] = useState<{ path: string; name: string; lastModified: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    if (!isTauri()) {
      setIsLoading(false);
      return;
    }

    try {
      const list = await invoke<{ path: string; name: string; lastModified: string }[]>('projects_list');
      setProjects(list);
    } catch {
      // Rust commands not implemented yet — return empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  const openFolderDialog = useCallback(async (): Promise<string | null> => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false });
    return selected as string | null;
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return {
    projects,
    isLoading,
    isElectron: isTauri(),
    openFolderDialog,
    refresh: fetchProjects,
  };
}

// Hook for shell operations via Tauri invoke
export function useElectronShell() {
  const openTerminal = useCallback(async (cwd: string, command?: string) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }
    try {
      return await invoke<{ success: boolean }>('shell_open_terminal', { cwd, command });
    } catch (err) {
      throw err;
    }
  }, []);

  const exec = useCallback(async (command: string, cwd?: string) => {
    if (!isTauri()) {
      throw new Error('Tauri API not available');
    }
    try {
      return await invoke<{ success: boolean; output?: string; error?: string; code?: number }>('shell_exec', { command, cwd });
    } catch (err) {
      throw err;
    }
  }, []);

  return {
    isElectron: isTauri(),
    openTerminal,
    exec,
  };
}
