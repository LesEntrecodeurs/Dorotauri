

import { useState, useCallback, useMemo } from 'react';
import { Bot, Loader2, Search, ArrowUpDown, Moon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useElectronAgents, useElectronFS, useElectronSkills, isElectron } from '@/hooks/useElectron';
import { isTauri } from '@/hooks/useTauri';
import { useClaude } from '@/hooks/useClaude';
import { useAgentFiltering } from '@/hooks/useAgentFiltering';
import { useSuperAgent } from '@/hooks/useSuperAgent';
import type { AgentCharacter, AgentProvider } from '@/types/electron';
import NewChatModal from '@/components/NewChatModal';
import type { EditAgentData } from '@/components/NewChatModal/types';
import AgentTerminalDialog from '@/components/AgentTerminalDialog';
import DormantAgentsList from '@/components/DormantAgentsList';
import {
  DesktopRequiredMessage,
  AgentListHeader,
  ProjectFilterTabs,
  AgentManagementCard,
} from '@/components/AgentList';
import { STATUS_LABELS, STATUS_COLORS } from '@/components/AgentList/constants';

type SortBy = 'status' | 'activity' | 'name';

export default function AgentsPage() {
  const {
    agents,
    isLoading: agentsLoading,
    isElectron: hasElectron,
    createAgent,
    updateAgent,
    startAgent,
    stopAgent,
    removeAgent,
    reanimateAgent,
  } = useElectronAgents();
  const { projects, openFolderDialog } = useElectronFS();
  const { installedSkills, refresh: refreshSkills } = useElectronSkills();
  const { data: claudeData } = useClaude();

  // Local state
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [viewAgentId, setViewAgentId] = useState<string | null>(null);  // terminal dialog
  const [editAgentId, setEditAgentId] = useState<string | null>(null);  // edit dialog
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('status');


  // Custom hooks
  const { superAgent, isCreatingSuperAgent, handleSuperAgentClick } = useSuperAgent({
    agents,
    createAgent,
    startAgent,
    onAgentCreated: (id) => setEditAgentId(id),
  });

  const { filteredAgents, uniqueProjects } = useAgentFiltering({
    agents,
    projectFilter,
    statusFilter,
    searchQuery,
    sortBy,
  });

  const runningCount = agents.filter(a => a.processState === 'running' || a.processState === 'waiting').length;
  const dormantAgents = useMemo(() => agents.filter(a => a.processState === 'dormant'), [agents]);
  const [showDormant, setShowDormant] = useState(false);

  // Build edit agent data from editAgentId
  const editAgentData: EditAgentData | null = useMemo(() => {
    if (!editAgentId) return null;
    const agent = agents.find(a => a.id === editAgentId);
    if (!agent) return null;
    return {
      id: agent.id,
      name: agent.name,
      character: agent.character,
      secondaryPaths: agent.secondaryPaths,
      skills: agent.skills,
      skipPermissions: agent.skipPermissions,
      provider: agent.provider,
      localModel: agent.localModel,
      branchName: agent.branchName,
      obsidianVaultPaths: agent.obsidianVaultPaths,
    };
  }, [editAgentId, agents]);

  // Handlers
  const handleCreateAgent = useCallback(async (
    skills: string[],
    prompt: string,
    model?: string,
    worktree?: { enabled: boolean; branchName: string },
    character?: AgentCharacter,
    name?: string,
    skipPermissions?: boolean,
    provider?: AgentProvider,
    localModel?: string,
    obsidianVaultPaths?: string[],
  ) => {
    try {
      const agent = await createAgent({ skills, worktree, character, name, skipPermissions, provider, localModel, obsidianVaultPaths });
      if (prompt) {
        const options = { model: provider === 'local' ? undefined : model, provider, localModel };
        await startAgent(agent.id, prompt, options);
      }
      setShowNewChatModal(false);
    } catch (error) {
      console.error('Failed to create agent:', error);
    }
  }, [createAgent, startAgent]);

  const handleUpdateAgent = useCallback(async (id: string, updates: {
    skills?: string[];
    secondaryPaths?: string[] | null;
    skipPermissions?: boolean;
    name?: string;
    character?: AgentCharacter;
  }) => {
    try {
      await updateAgent({ id, ...updates });
      setEditAgentId(null);
    } catch (error) {
      console.error('Failed to update agent:', error);
    }
  }, [updateAgent]);

  const handleStartAgent = useCallback(async (agentId: string, prompt?: string) => {
    await startAgent(agentId, prompt || '');
  }, [startAgent]);

  const handleRemoveAgent = useCallback((agentId: string) => {
    removeAgent(agentId);
  }, [removeAgent]);

  const handleReanimateAgent = useCallback(async (agentId: string) => {
    try {
      await reanimateAgent(agentId);
    } catch (error) {
      console.error('Failed to reanimate agent:', error);
    }
  }, [reanimateAgent]);

  const handleDeleteDormantAgent = useCallback((agentId: string) => {
    removeAgent(agentId);
  }, [removeAgent]);

  const agentCountByProject = useCallback((path: string) => {
    return agents.filter(a => a.cwd === path).length;
  }, [agents]);

  const cycleSortBy = useCallback(() => {
    setSortBy(prev => {
      if (prev === 'status') return 'activity';
      if (prev === 'activity') return 'name';
      return 'status';
    });
  }, []);

  // Early returns
  if (!hasElectron && typeof window !== 'undefined') {
    return <DesktopRequiredMessage />;
  }

  if (agentsLoading && agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading agents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-7rem)] lg:h-[calc(100vh-3rem)] flex flex-col pt-4 lg:pt-6">
      <AgentListHeader
        superAgent={superAgent}
        isCreatingSuperAgent={isCreatingSuperAgent}
        onSuperAgentClick={handleSuperAgentClick}
        onNewAgentClick={() => setShowNewChatModal(true)}
      />

      <ProjectFilterTabs
        uniqueProjects={uniqueProjects}
        projectFilter={projectFilter}
        totalAgentCount={agents.length}
        agentCountByProject={agentCountByProject}
        onFilterChange={setProjectFilter}
      />

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {/* Status tabs */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setStatusFilter(null)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${
              !statusFilter ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All
            <span className={`px-1 py-px text-[10px] ${!statusFilter ? 'bg-background/20' : 'bg-muted'}`}>
              {agents.length}
            </span>
          </button>
          {Object.entries(STATUS_LABELS).map(([key, label]) => {
            const count = agents.filter(a => a.processState === key).length;
            const colors = STATUS_COLORS[key as keyof typeof STATUS_COLORS];
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(statusFilter === key ? null : key)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors capitalize ${
                  statusFilter === key ? `${colors.bg} ${colors.text}` : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
                {count > 0 && (
                  <span className={`px-1 py-px text-[10px] ${statusFilter === key ? 'bg-background/20' : colors.bg} ${statusFilter !== key ? colors.text : ''}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search agents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>

        {/* Sort toggle */}
        <button
          onClick={cycleSortBy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border bg-card hover:bg-accent/50 transition-colors"
          title={`Sort by: ${sortBy}`}
        >
          <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-muted-foreground capitalize">{sortBy}</span>
        </button>

        {/* Count summary */}
        <div className="text-xs text-muted-foreground ml-auto hidden sm:flex items-center gap-3">
          <span>{agents.length} total</span>
          <span className="text-primary">{runningCount} active</span>
        </div>
      </div>

      {/* Agent Grid */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredAgents.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pb-4">
            {filteredAgents.map((agent) => (
              <AgentManagementCard
                key={agent.id}
                agent={agent}
                onClick={() => {
                  if (isTauri()) {
                    invoke('window_popout', { agentId: agent.id }).catch(console.error);
                  }
                }}
                onEdit={() => setEditAgentId(agent.id)}
                onStart={() => handleStartAgent(agent.id)}
                onStop={() => stopAgent(agent.id)}
                onRemove={() => handleRemoveAgent(agent.id)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20">
            <Bot className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground text-sm mb-2">
              {agents.length === 0 ? 'No agents yet' : 'No agents match your filters'}
            </p>
            {agents.length === 0 ? (
              <button
                onClick={() => setShowNewChatModal(true)}
                className="text-primary text-sm hover:underline"
              >
                Create your first agent
              </button>
            ) : (
              <button
                onClick={() => { setProjectFilter(null); setStatusFilter(null); setSearchQuery(''); }}
                className="text-primary text-sm hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Dormant Agents Section */}
      {dormantAgents.length > 0 && (
        <div className="border-t border-border/40 pt-3 mt-1">
          <button
            onClick={() => setShowDormant(!showDormant)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
          >
            <Moon className="w-3.5 h-3.5" />
            <span>Dormant agents</span>
            <span className="text-[10px] bg-zinc-500/20 text-zinc-400 px-1.5 py-0.5 rounded-full">
              {dormantAgents.length}
            </span>
            <span className="text-xs">{showDormant ? '\u25B4' : '\u25BE'}</span>
          </button>
          {showDormant && (
            <DormantAgentsList
              agents={dormantAgents}
              onReanimate={handleReanimateAgent}
              onDelete={handleDeleteDormantAgent}
            />
          )}
        </div>
      )}

      {/* Create Modal */}
      <NewChatModal
        open={showNewChatModal}
        onClose={() => setShowNewChatModal(false)}
        onSubmit={handleCreateAgent}
        installedSkills={installedSkills}
        allInstalledSkills={claudeData?.skills || []}
        onRefreshSkills={refreshSkills}
      />

      {/* Edit Modal — reuses NewChatModal pre-filled with agent data */}
      <NewChatModal
        open={!!editAgentId}
        onClose={() => setEditAgentId(null)}
        onSubmit={handleCreateAgent}
        onUpdate={handleUpdateAgent}
        editAgent={editAgentData}
        installedSkills={installedSkills}
        allInstalledSkills={claudeData?.skills || []}
        onRefreshSkills={refreshSkills}
        initialStep={1}
      />

      {/* Terminal Dialog — click card body to view */}
      <AgentTerminalDialog
        agent={viewAgentId ? agents.find(a => a.id === viewAgentId) || null : null}
        open={!!viewAgentId}
        onClose={() => setViewAgentId(null)}
        onStart={(id, prompt) => handleStartAgent(id, prompt)}
        onStop={stopAgent}
        projects={projects.map(p => ({ path: p.path, name: p.name }))}
        agents={agents}
        onBrowseFolder={isElectron() ? openFolderDialog : undefined}
      />
    </div>
  );
}
