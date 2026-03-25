
import { useState, useCallback, useMemo, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Tab, Agent } from '../../../types/electron.d';
import type { LayoutPreset } from '../types';
import { deleteTabLayouts } from './useGridLayoutStorage';

const MAX_TABS = 6;

interface UseTabManagerOptions {
  agents: Agent[];
}

export function useTabManager({ agents }: UseTabManagerOptions) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Load tabs from backend on mount
  useEffect(() => {
    invoke<Tab[]>('tab_list').then(loadedTabs => {
      setTabs(loadedTabs);
      if (loadedTabs.length > 0) {
        setActiveTabId(prev => prev ?? loadedTabs[0].id);
      }
    }).catch(err => {
      console.error('[useTabManager] Failed to load tabs:', err);
    });
  }, []);

  // Derive agents for the active tab from Agent.tabId
  const activeTabAgents = useMemo(
    () => agents.filter(a => a.tabId === activeTabId),
    [agents, activeTabId]
  );

  // --- Tab CRUD ---

  const createTab = useCallback(async (name: string): Promise<Tab> => {
    const tab = await invoke<Tab>('tab_create', { name: name || `Tab ${tabs.length + 1}` });
    setTabs(prev => {
      if (prev.length >= MAX_TABS) return prev;
      return [...prev, tab];
    });
    setActiveTabId(tab.id);
    return tab;
  }, [tabs.length]);

  const deleteTab = useCallback(async (id: string): Promise<void> => {
    deleteTabLayouts(id);
    await invoke('tab_delete', { id });
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id);
      const remaining = prev.filter(t => t.id !== id);
      setActiveTabId(current => {
        if (current !== id) return current;
        if (remaining.length === 0) return null;
        const nextIdx = Math.min(idx, remaining.length - 1);
        return remaining[nextIdx].id;
      });
      return remaining;
    });
  }, []);

  const renameTab = useCallback(async (id: string, name: string): Promise<void> => {
    await invoke('tab_update', { id, name });
    setTabs(prev => prev.map(t => t.id === id ? { ...t, name } : t));
  }, []);

  const updateLayout = useCallback(async (id: string, layout: LayoutPreset): Promise<void> => {
    await invoke('tab_update', { id, layout });
    setTabs(prev => prev.map(t => t.id === id ? { ...t, layout } : t));
  }, []);

  const reorderTabs = useCallback(async (tabIds: string[]): Promise<void> => {
    await invoke('tab_reorder', { tabIds });
    setTabs(prev => tabIds.map(id => prev.find(t => t.id === id)!).filter(Boolean));
  }, []);

  // Move agent to tab — updates the agent's tabId via agent_update
  const moveAgentToTab = useCallback(async (agentId: string, tabId: string): Promise<void> => {
    await invoke('agent_update', { id: agentId, tabId });
  }, []);

  // Create a new tab and move an agent into it
  const createTabAndMoveAgent = useCallback(async (agentId: string): Promise<void> => {
    if (tabs.length >= MAX_TABS) return;
    const newTab = await invoke<Tab>('tab_create', { name: `Tab ${tabs.length + 1}` });
    setTabs(prev => [...prev, newTab]);
    await invoke('agent_update', { id: agentId, tabId: newTab.id });
  }, [tabs.length]);

  // --- Derived values ---

  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeTabId) ?? null,
    [tabs, activeTabId]
  );

  const canCreateTab = tabs.length < MAX_TABS;

  return {
    // Tab state
    tabs,
    activeTabId,
    setActiveTabId,
    activeTab,
    activeTabAgents,

    // Tab CRUD
    createTab,
    deleteTab,
    renameTab,
    updateLayout,
    reorderTabs,

    // Agent ↔ tab membership
    moveAgentToTab,
    createTabAndMoveAgent,

    // Guards
    canCreateTab,
  };
}
