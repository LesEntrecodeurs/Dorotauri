import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Trash2,
  Save,
  Plus,
  X,
  Eye,
  EyeOff,
  Loader2,
  Plug,
  AlertCircle,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

type Provider = 'claude' | 'codex' | 'gemini';

interface McpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface EditState {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const PROVIDER_TABS: { id: Provider; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini' },
];

function GeminiSvg({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12Z" />
    </svg>
  );
}

function ProviderIcon({ provider, className }: { provider: Provider; className?: string }) {
  switch (provider) {
    case 'claude':
      return <img src="/claude-ai-icon.webp" alt="Claude" className={className} />;
    case 'codex':
      return <img src="/chatgpt-icon.webp" alt="Codex" className={className} />;
    case 'gemini':
      return <GeminiSvg className={className} />;
  }
}

export function McpSection() {
  const [provider, setProvider] = useState<Provider>('claude');
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [editStates, setEditStates] = useState<Record<string, EditState>>({});
  const [savingServer, setSavingServer] = useState<string | null>(null);
  const [savedServer, setSavedServer] = useState<string | null>(null);
  const [deletingServer, setDeletingServer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maskedEnvKeys, setMaskedEnvKeys] = useState<Set<string>>(new Set());

  const loadServers = useCallback(async (p: Provider) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI?.mcp?.list({ provider: p });
      if (result?.error) {
        setError(result.error);
        setServers([]);
      } else {
        setServers(result?.servers || []);
        // Initialize edit states
        const states: Record<string, EditState> = {};
        for (const s of result?.servers || []) {
          states[s.name] = { command: s.command, args: [...s.args], env: { ...s.env } };
        }
        setEditStates(states);
        // All env values start masked
        const allKeys = new Set<string>();
        for (const s of result?.servers || []) {
          for (const k of Object.keys(s.env)) {
            allKeys.add(`${s.name}:${k}`);
          }
        }
        setMaskedEnvKeys(allKeys);
      }
    } catch (err) {
      setError(String(err));
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServers(provider);
    setExpandedServer(null);
  }, [provider, loadServers]);

  const handleTabChange = (p: Provider) => {
    setProvider(p);
  };

  const getEditState = (name: string): EditState => {
    return editStates[name] || { command: '', args: [], env: {} };
  };

  const updateEditState = (name: string, updates: Partial<EditState>) => {
    setEditStates(prev => ({
      ...prev,
      [name]: { ...getEditState(name), ...updates },
    }));
  };

  const handleSave = async (name: string) => {
    const state = getEditState(name);
    setSavingServer(name);
    try {
      const result = await window.electronAPI?.mcp?.update({
        provider,
        name,
        command: state.command,
        args: state.args,
        env: state.env,
      });
      if (result?.success) {
        setSavedServer(name);
        setTimeout(() => setSavedServer(null), 2000);
      } else {
        setError(result?.error || 'Failed to save');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingServer(null);
    }
  };

  const handleDelete = async (name: string) => {
    setDeletingServer(name);
    try {
      const result = await window.electronAPI?.mcp?.delete({ provider, name });
      if (result?.success) {
        setServers(prev => prev.filter(s => s.name !== name));
        const newStates = { ...editStates };
        delete newStates[name];
        setEditStates(newStates);
        if (expandedServer === name) setExpandedServer(null);
      } else {
        setError(result?.error || 'Failed to delete');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setDeletingServer(null);
    }
  };

  const toggleEnvMask = (serverName: string, envKey: string) => {
    const compositeKey = `${serverName}:${envKey}`;
    setMaskedEnvKeys(prev => {
      const next = new Set(prev);
      if (next.has(compositeKey)) next.delete(compositeKey);
      else next.add(compositeKey);
      return next;
    });
  };

  // -- Arg helpers --

  const addArg = (name: string) => {
    const state = getEditState(name);
    updateEditState(name, { args: [...state.args, ''] });
  };

  const updateArg = (name: string, idx: number, value: string) => {
    const state = getEditState(name);
    const newArgs = [...state.args];
    newArgs[idx] = value;
    updateEditState(name, { args: newArgs });
  };

  const removeArg = (name: string, idx: number) => {
    const state = getEditState(name);
    updateEditState(name, { args: state.args.filter((_, i) => i !== idx) });
  };

  // -- Env helpers --

  const addEnvVar = (name: string) => {
    const state = getEditState(name);
    updateEditState(name, { env: { ...state.env, '': '' } });
  };

  const updateEnvKey = (serverName: string, oldKey: string, newKey: string) => {
    const state = getEditState(serverName);
    const entries = Object.entries(state.env);
    const newEnv: Record<string, string> = {};
    for (const [k, v] of entries) {
      newEnv[k === oldKey ? newKey : k] = v;
    }
    updateEditState(serverName, { env: newEnv });
    // Update mask key
    const oldComposite = `${serverName}:${oldKey}`;
    const newComposite = `${serverName}:${newKey}`;
    setMaskedEnvKeys(prev => {
      const next = new Set(prev);
      if (next.has(oldComposite)) {
        next.delete(oldComposite);
        next.add(newComposite);
      }
      return next;
    });
  };

  const updateEnvValue = (serverName: string, key: string, value: string) => {
    const state = getEditState(serverName);
    updateEditState(serverName, { env: { ...state.env, [key]: value } });
  };

  const removeEnvVar = (serverName: string, key: string) => {
    const state = getEditState(serverName);
    const newEnv = { ...state.env };
    delete newEnv[key];
    updateEditState(serverName, { env: newEnv });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold mb-1">Custom MCP Servers</h2>
        <p className="text-sm text-muted-foreground">
          View and edit MCP server configurations installed via CLI commands. Dorothy-managed servers are hidden.
        </p>
      </div>

      {/* Provider Tabs */}
      <div className="flex gap-1 border border-border p-1">
        {PROVIDER_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              provider === tab.id
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            <ProviderIcon provider={tab.id} className="w-4 h-4 object-contain" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 text-sm flex items-center gap-2 bg-red-700/10 text-destructive border border-red-700/20">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto p-1 hover:text-red-500">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Content */}
      <Card>
        <CardContent className="p-6">
          {/* Header row */}
          <div className="flex items-center justify-between pb-4">
            <div className="flex items-center gap-3">
              <Plug className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="font-medium">{PROVIDER_TABS.find(t => t.id === provider)?.label} MCP Servers</p>
                <p className="text-sm text-muted-foreground">
                  {loading ? 'Loading...' : `${servers.length} custom server${servers.length !== 1 ? 's' : ''}`}
                </p>
              </div>
            </div>
            <button
              onClick={() => loadServers(provider)}
              disabled={loading}
              className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <Separator />

          {/* Server list */}
          <div className="mt-4 space-y-2">
            {loading && servers.length === 0 && (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Loading servers...
              </div>
            )}

            {!loading && servers.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No custom MCP servers found for {PROVIDER_TABS.find(t => t.id === provider)?.label}.
              </div>
            )}

            {servers.map(server => {
              const isExpanded = expandedServer === server.name;
              const state = getEditState(server.name);
              const isSaving = savingServer === server.name;
              const isSaved = savedServer === server.name;
              const isDeleting = deletingServer === server.name;

              return (
                <div key={server.name} className="border border-border overflow-hidden">
                  {/* Collapsed header */}
                  <button
                    onClick={() => setExpandedServer(isExpanded ? null : server.name)}
                    className="w-full flex items-center justify-between p-3 hover:bg-secondary/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                        : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      }
                      <span className="font-medium text-sm truncate">{server.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono truncate ml-3 max-w-[50%]">
                      {server.command} {server.args.join(' ')}
                    </span>
                  </button>

                  {/* Expanded editor */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
                      {/* Command */}
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Command</Label>
                        <Input
                          type="text"
                          value={state.command}
                          onChange={e => updateEditState(server.name, { command: e.target.value })}
                          className="font-mono"
                        />
                      </div>

                      {/* Args */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <Label className="text-xs text-muted-foreground">Arguments</Label>
                          <button
                            onClick={() => addArg(server.name)}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                          >
                            <Plus className="w-3 h-3" /> Add
                          </button>
                        </div>
                        {state.args.length === 0 && (
                          <p className="text-xs text-muted-foreground italic">No arguments</p>
                        )}
                        <div className="space-y-1">
                          {state.args.map((arg, idx) => (
                            <div key={idx} className="flex gap-1">
                              <Input
                                type="text"
                                value={arg}
                                onChange={e => updateArg(server.name, idx, e.target.value)}
                                className="flex-1 font-mono h-8"
                                placeholder={`arg ${idx}`}
                              />
                              <button
                                onClick={() => removeArg(server.name, idx)}
                                className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Env vars */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <Label className="text-xs text-muted-foreground">Environment Variables</Label>
                          <button
                            onClick={() => addEnvVar(server.name)}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                          >
                            <Plus className="w-3 h-3" /> Add
                          </button>
                        </div>
                        {Object.keys(state.env).length === 0 && (
                          <p className="text-xs text-muted-foreground italic">No environment variables</p>
                        )}
                        <div className="space-y-1">
                          {Object.entries(state.env).map(([key, value]) => {
                            const isMasked = maskedEnvKeys.has(`${server.name}:${key}`);
                            return (
                              <div key={key} className="flex gap-1">
                                <Input
                                  type="text"
                                  value={key}
                                  onChange={e => updateEnvKey(server.name, key, e.target.value)}
                                  className="w-[40%] font-mono h-8"
                                  placeholder="KEY"
                                />
                                <div className="flex-1 flex">
                                  <Input
                                    type={isMasked ? 'password' : 'text'}
                                    value={value}
                                    onChange={e => updateEnvValue(server.name, key, e.target.value)}
                                    className="flex-1 font-mono h-8 rounded-r-none border-r-0"
                                    placeholder="value"
                                  />
                                  <button
                                    onClick={() => toggleEnvMask(server.name, key)}
                                    className="px-2 bg-secondary border border-border text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    {isMasked ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                                <button
                                  onClick={() => removeEnvVar(server.name, key)}
                                  className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Actions */}
                      <Separator />
                      <div className="flex items-center justify-end gap-2 pt-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(server.name)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          Delete
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleSave(server.name)}
                          disabled={isSaving}
                        >
                          {isSaving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : isSaved ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : (
                            <Save className="w-3.5 h-3.5" />
                          )}
                          {isSaved ? 'Saved' : 'Save'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
