

import { useState, useMemo, lazy, Suspense } from 'react';
import {
  Loader2,
  BarChart3,
  Bot,
  FolderKanban,
  MessageSquare,
  Zap,
  Activity,
  Sparkles,
  Users,
  TrendingUp,
  Clock,
  History,
  LayoutGrid,
  TerminalSquare,
} from 'lucide-react';
import { useClaude } from '@/hooks/useClaude';
import { useElectronAgents } from '@/hooks/useElectron';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import StatsCard from './StatsCard';

const CanvasView = lazy(() => import('@/components/CanvasView'));

const MosaicTerminalView = lazy(() => import('@/components/MosaicTerminalView'));

export default function Dashboard() {
  const { data, loading, error } = useClaude();
  const { agents } = useElectronAgents();
  const [viewMode, setViewMode] = useState<'canvas' | 'terminals' | 'stats'>('terminals');

  // Calculate stats
  const stats = data?.stats;
  const projects = data?.projects || [];
  const skills = data?.skills || [];
  const history = data?.history || [];
  const activeSessions = data?.activeSessions || [];

  // Get recent activity
  const recentActivity = useMemo(() => {
    if (!stats?.dailyActivity || stats.dailyActivity.length === 0) return null;
    const sorted = [...stats.dailyActivity].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    return sorted[0];
  }, [stats?.dailyActivity]);

  // Get recent tokens
  const recentTokens = useMemo(() => {
    if (!stats?.dailyModelTokens || stats.dailyModelTokens.length === 0) return 0;
    const sorted = [...stats.dailyModelTokens].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const tokensByModel = sorted[0]?.tokensByModel;
    if (!tokensByModel) return 0;
    return Object.values(tokensByModel).reduce((a, b) => a + b, 0);
  }, [stats?.dailyModelTokens]);

  // Token pricing per million tokens (MTok)
  const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number; cacheHitsPerMTok: number; cache5mWritePerMTok: number }> = {
    'claude-opus-4-5-20251101': { inputPerMTok: 5, outputPerMTok: 25, cacheHitsPerMTok: 0.50, cache5mWritePerMTok: 6.25 },
    'claude-opus-4-5': { inputPerMTok: 5, outputPerMTok: 25, cacheHitsPerMTok: 0.50, cache5mWritePerMTok: 6.25 },
    'claude-opus-4-1': { inputPerMTok: 15, outputPerMTok: 75, cacheHitsPerMTok: 1.50, cache5mWritePerMTok: 18.75 },
    'claude-opus-4': { inputPerMTok: 15, outputPerMTok: 75, cacheHitsPerMTok: 1.50, cache5mWritePerMTok: 18.75 },
    'claude-sonnet-4-5': { inputPerMTok: 3, outputPerMTok: 15, cacheHitsPerMTok: 0.30, cache5mWritePerMTok: 3.75 },
    'claude-sonnet-4': { inputPerMTok: 3, outputPerMTok: 15, cacheHitsPerMTok: 0.30, cache5mWritePerMTok: 3.75 },
    'claude-sonnet-3-7': { inputPerMTok: 3, outputPerMTok: 15, cacheHitsPerMTok: 0.30, cache5mWritePerMTok: 3.75 },
    'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5, cacheHitsPerMTok: 0.10, cache5mWritePerMTok: 1.25 },
    'claude-haiku-3-5': { inputPerMTok: 0.80, outputPerMTok: 4, cacheHitsPerMTok: 0.08, cache5mWritePerMTok: 1 },
    'claude-haiku-3': { inputPerMTok: 0.25, outputPerMTok: 1.25, cacheHitsPerMTok: 0.03, cache5mWritePerMTok: 0.30 },
  };

  // Get pricing for a model (with fallback)
  const getModelPricing = (modelId: string) => {
    if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId];
    const lowerModel = modelId.toLowerCase();
    if (lowerModel.includes('opus-4-5') || lowerModel.includes('opus-4.5')) return MODEL_PRICING['claude-opus-4-5'];
    if (lowerModel.includes('opus-4')) return MODEL_PRICING['claude-opus-4'];
    if (lowerModel.includes('sonnet-4-5') || lowerModel.includes('sonnet-4.5')) return MODEL_PRICING['claude-sonnet-4-5'];
    if (lowerModel.includes('sonnet-4') || lowerModel.includes('sonnet')) return MODEL_PRICING['claude-sonnet-4'];
    if (lowerModel.includes('haiku-4-5') || lowerModel.includes('haiku-4.5')) return MODEL_PRICING['claude-haiku-4-5'];
    if (lowerModel.includes('haiku-3-5') || lowerModel.includes('haiku-3.5')) return MODEL_PRICING['claude-haiku-3-5'];
    if (lowerModel.includes('haiku')) return MODEL_PRICING['claude-haiku-3'];
    return MODEL_PRICING['claude-sonnet-4']; // Default
  };

  // Calculate total cost using accurate pricing
  const totalCost = useMemo(() => {
    if (!stats?.modelUsage) return 0;
    try {
      let cost = 0;
      Object.entries(stats.modelUsage).forEach(([modelId, usage]) => {
        const pricing = getModelPricing(modelId);
        const u = usage as { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number };
        cost += ((u.inputTokens || 0) / 1_000_000) * pricing.inputPerMTok;
        cost += ((u.outputTokens || 0) / 1_000_000) * pricing.outputPerMTok;
        cost += ((u.cacheReadInputTokens || 0) / 1_000_000) * pricing.cacheHitsPerMTok;
        cost += ((u.cacheCreationInputTokens || 0) / 1_000_000) * pricing.cache5mWritePerMTok;
      });
      return cost;
    } catch {
      return 0;
    }
  }, [stats?.modelUsage]);

  // Process hourCounts for display
  const hourData = useMemo(() => {
    if (!stats?.hourCounts) return { hours: Array(24).fill(0), maxCount: 1 };

    const hours = Array.from({ length: 24 }, (_, i) => {
      const count = stats.hourCounts[i.toString()] || 0;
      return count;
    });
    const maxCount = Math.max(...hours, 1);

    return { hours, maxCount };
  }, [stats?.hourCounts]);

  // Get recent history entries
  const recentHistory = useMemo(() => {
    if (!history || history.length === 0) return [];

    // Sort by timestamp descending and take last 10
    return [...history]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);
  }, [history]);

  // Find agent for a project path
  const findAgentForProject = (projectPath: string) => {
    return agents.find(a => a.cwd === projectPath);
  };

  // Agent stats
  const runningAgents = agents.filter(a => a.processState === 'running').length;
  const idleAgents = agents.filter(a => a.processState === 'inactive').length;
  const waitingAgents = agents.filter(a => a.processState === 'waiting').length;

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Loading Claude Code data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center text-destructive">
          <p className="mb-2">Failed to load Claude Code data</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  const characterEmojis: Record<string, string> = {
    robot: '\u{1F916}',
    ninja: '\u{1F977}',
    wizard: '\u{1F9D9}',
    astronaut: '\u{1F468}\u200D\u{1F680}',
    knight: '\u2694\uFE0F',
    pirate: '\u{1F3F4}\u200D\u2620\uFE0F',
    alien: '\u{1F47D}',
    viking: '\u{1F6E1}\uFE0F',
    frog: '\u{1F438}',
  };

  return (
    <div className="space-y-4 lg:space-y-6 pt-4 lg:pt-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground text-xs lg:text-sm mt-1 hidden sm:block">
            Monitor your AI Agents in real-time
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
          {/* View Mode Toggle */}
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as typeof viewMode)}>
            <TabsList>
              <TabsTrigger value="terminals" className="gap-1.5 lg:gap-2 text-xs lg:text-sm">
                <TerminalSquare className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
                <span className="hidden sm:inline">Terminals</span>
                <span className="sm:hidden">Term</span>
              </TabsTrigger>
              <TabsTrigger value="canvas" className="gap-1.5 lg:gap-2 text-xs lg:text-sm">
                <LayoutGrid className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
                Board
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="text-right text-xs text-muted-foreground hidden sm:block">
            <div className="flex items-center gap-2 justify-end">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
              </span>
              <span>{activeSessions.length} active session{activeSessions.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="mt-0.5">
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Canvas View */}
      {viewMode === 'canvas' && (
        <Card
          className="overflow-hidden"
          style={{ height: 'calc(100vh - 200px)', minHeight: '400px' }}
        >
          <Suspense fallback={<div className="flex items-center justify-center h-full min-h-[600px] bg-card border border-border"><div className="text-center"><Loader2 className="w-8 h-8 animate-spin text-foreground mx-auto mb-4" /><p className="text-muted-foreground">Loading Board...</p></div></div>}>
            <CanvasView />
          </Suspense>
        </Card>
      )}

      {/* Terminals View (Mosaic) */}
      {viewMode === 'terminals' && (
        <Card
          className="overflow-hidden"
          style={{ height: 'calc(100vh - 130px)', minHeight: '400px' }}
        >
          <Suspense fallback={<div className="flex items-center justify-center h-full min-h-[600px] bg-card border border-border"><div className="text-center"><Loader2 className="w-8 h-8 animate-spin text-foreground mx-auto mb-4" /><p className="text-muted-foreground">Loading Terminals...</p></div></div>}>
            <MosaicTerminalView agents={agents} />
          </Suspense>
        </Card>
      )}

      {/* Statistics View */}
      {viewMode === 'stats' && (
        <>
          {/* Stats Grid - Row 1: Agents */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard
              title="Total Agents"
              value={agents.length}
              subtitle={`${runningAgents} running, ${idleAgents} idle`}
              icon={Bot}
              color="cyan"
            />
            <StatsCard
              title="Running"
              value={runningAgents}
              subtitle={waitingAgents > 0 ? `${waitingAgents} waiting for input` : 'All agents responsive'}
              icon={Activity}
              color="green"
            />
            <StatsCard
              title="Projects"
              value={projects.length}
              subtitle={`${skills.length} skills installed`}
              icon={FolderKanban}
              color="amber"
            />
            <StatsCard
              title="Skills"
              value={skills.length}
              subtitle={`${skills.filter(s => s.source === 'user').length} user, ${skills.filter(s => s.source === 'project').length} project, ${skills.filter(s => s.source === 'plugin').length} plugin`}
              icon={Sparkles}
              color="purple"
            />
          </div>

          {/* Stats Grid - Row 2: Usage */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard
              title="Recent Messages"
              value={recentActivity?.messageCount || 0}
              subtitle={`${recentActivity?.toolCallCount || 0} tool calls`}
              icon={MessageSquare}
              color="green"
            />
            <StatsCard
              title="Recent Tokens"
              value={`${(recentTokens / 1000).toFixed(0)}k`}
              subtitle={recentActivity?.date || 'No data'}
              icon={Zap}
              color="purple"
            />
            <StatsCard
              title="Total Sessions"
              value={stats?.totalSessions || 0}
              subtitle={`Since ${stats?.firstSessionDate ? new Date(stats.firstSessionDate).toLocaleDateString() : 'N/A'}`}
              icon={Users}
              color="cyan"
            />
            <StatsCard
              title="Total Cost"
              value={`$${totalCost.toFixed(2)}`}
              subtitle="All time usage"
              icon={TrendingUp}
              color="amber"
            />
          </div>

          {/* Model Usage */}
          {stats?.modelUsage && Object.keys(stats.modelUsage).length > 0 && (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Bot className="w-4 h-4 text-muted-foreground" />
                  Model Usage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(stats.modelUsage).map(([model, usage]) => {
                    const modelName = model.includes('opus') ? 'Opus 4.5' : model.includes('sonnet') ? 'Sonnet 4.5' : model;
                    const totalTokens = usage.inputTokens + usage.outputTokens;

                    return (
                      <div key={model} className="p-4 bg-secondary border border-border hover:border-primary/30 transition-all">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-foreground">
                            {modelName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ${usage.costUSD?.toFixed(2) || '0.00'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Input:</span>
                            <span className="ml-1 text-foreground">{(usage.inputTokens / 1000).toFixed(0)}k</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Output:</span>
                            <span className="ml-1 text-foreground">{(usage.outputTokens / 1000).toFixed(0)}k</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Cache Read:</span>
                            <span className="ml-1 text-foreground">{(usage.cacheReadInputTokens / 1000000).toFixed(1)}M</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Cache Create:</span>
                            <span className="ml-1 text-foreground">{(usage.cacheCreationInputTokens / 1000000).toFixed(1)}M</span>
                          </div>
                        </div>
                        <div className="mt-2 pt-2 border-t border-border text-xs text-muted-foreground">
                          Total: {(totalTokens / 1000000).toFixed(2)}M tokens
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Activity by Hour */}
          <Card>
            <CardHeader className="pb-3 px-4 pt-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                Activity by Hour
                <span className="text-xs text-muted-foreground font-normal ml-2">
                  (Total: {hourData.hours.reduce((a, b) => a + b, 0)} sessions)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex items-end gap-1 h-24">
                {hourData.hours.map((count, hour) => {
                  const height = (count / hourData.maxCount) * 100;

                  return (
                    <div key={hour} className="flex-1 flex flex-col items-center gap-1 group">
                      <div className="relative w-full flex justify-center">
                        {/* Tooltip on hover */}
                        <div className="absolute -top-6 opacity-0 group-hover:opacity-100 transition-opacity bg-popover border border-border px-1.5 py-0.5 text-[10px] whitespace-nowrap z-10 text-popover-foreground">
                          {hour}:00 - {count} sessions
                        </div>
                        <div
                          className={`w-full transition-all ${count > 0 ? 'bg-primary' : 'bg-secondary'}`}
                          style={{ height: `${Math.max(height, 4)}%`, minHeight: count > 0 ? '8px' : '4px' }}
                        />
                      </div>
                      {hour % 6 === 0 && (
                        <span className="text-[10px] text-muted-foreground">{hour}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                <span>12 AM</span>
                <span>6 AM</span>
                <span>12 PM</span>
                <span>6 PM</span>
                <span>12 AM</span>
              </div>
            </CardContent>
          </Card>

          {/* Recent Messages */}
          {recentHistory.length > 0 && (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <History className="w-4 h-4 text-muted-foreground" />
                  Recent Messages
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recentHistory.map((entry, index) => {
                    const projectName = entry.project?.split('/').pop() || 'Unknown';
                    const agent = entry.project ? findAgentForProject(entry.project) : null;
                    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    const date = new Date(entry.timestamp).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    });

                    return (
                      <div
                        key={`${entry.timestamp}-${index}`}
                        className="p-3 bg-secondary border border-border hover:border-primary/30 transition-all"
                      >
                        <div className="flex items-start gap-3">
                          {/* Agent avatar or default */}
                          <div className={`w-8 h-8 ${agent?.name?.toLowerCase() === 'bitwonka' ? 'bg-success/20' : 'bg-card'} flex items-center justify-center text-sm shrink-0`}>
                            {agent ? (agent.name?.toLowerCase() === 'bitwonka' ? '\u{1F438}' : (characterEmojis[agent.character || 'robot'] || '\u{1F916}')) : '\u{1F4AC}'}
                          </div>

                          <div className="flex-1 min-w-0">
                            {/* Header row */}
                            <div className="flex items-center gap-2 mb-1">
                              {agent && (
                                <span className="text-xs font-medium text-foreground">
                                  {agent.name || `Agent ${agent.id.slice(0, 6)}`}
                                </span>
                              )}
                              <Badge variant="secondary" className="text-xs px-1.5 py-0.5">
                                {projectName}
                              </Badge>
                              <span className="text-xs text-muted-foreground ml-auto shrink-0">
                                {date} {time}
                              </span>
                            </div>

                            {/* Message */}
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {entry.display}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Agents Overview */}
          {agents.length > 0 && (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Bot className="w-4 h-4 text-muted-foreground" />
                  Agents Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {agents.slice(0, 6).map((agent) => {
                    const projectName = agent.cwd.split('/').pop() || 'Unknown';
                    const statusColors: Record<string, string> = {
                      running: 'bg-success',
                      waiting: 'bg-warning',
                      inactive: 'bg-muted-foreground',
                      dormant: 'bg-muted-foreground/60',
                      error: 'bg-destructive',
                      completed: 'bg-foreground',
                    };

                    return (
                      <div
                        key={agent.id}
                        className="p-3 bg-secondary border border-border flex items-center gap-3 hover:border-primary/30 transition-all"
                      >
                        <div className="relative">
                          <div className={`w-10 h-10 ${agent.name?.toLowerCase() === 'bitwonka' ? 'bg-success/20' : 'bg-card'} flex items-center justify-center text-xl`}>
                            {agent.name?.toLowerCase() === 'bitwonka' ? '\u{1F438}' : (characterEmojis[agent.character || 'robot'] || '\u{1F916}')}
                          </div>
                          <div
                            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border border-secondary ${statusColors[agent.processState]}`}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate text-foreground">
                            {agent.name || `Agent ${agent.id.slice(0, 6)}`}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{projectName}</p>
                        </div>
                        <Badge
                          variant={agent.processState === 'running' ? 'default' : agent.processState === 'error' ? 'destructive' : 'secondary'}
                          className="text-[10px] px-2 py-0.5"
                        >
                          {agent.processState}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
                {agents.length > 6 && (
                  <p className="text-xs text-muted-foreground mt-3 text-center">
                    +{agents.length - 6} more agents
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
