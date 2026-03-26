import { useState, useEffect } from 'react';
import {
  X,
  Check,
  Zap,
  Loader2,
  CheckCircle,
  XCircle,
  Crown,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { isElectron } from '@/hooks/useElectron';

// Module-level cache: avoids re-running the slow IPC call every time Step 3 mounts
let cachedStatus: 'configured' | 'not-configured' | 'error' | null = null;
let cachedError: string | null = null;

interface OrchestratorModeToggleProps {
  isOrchestrator: boolean;
  onToggle: (enabled: boolean) => void;
  scope: 'tab' | 'all';
  onScopeChange: (scope: 'tab' | 'all') => void;
}

export default function OrchestratorModeToggle({
  isOrchestrator,
  onToggle,
  scope,
  onScopeChange,
}: OrchestratorModeToggleProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'configured' | 'not-configured' | 'error'>(
    cachedStatus ?? 'idle'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(cachedError);
  const [isSettingUp, setIsSettingUp] = useState(false);

  useEffect(() => {
    // Use cached result if available -- instant, no IPC call
    if (cachedStatus) {
      setStatus(cachedStatus);
      setErrorMessage(cachedError);
      return;
    }

    const checkStatus = async () => {
      setStatus('loading');
      try {
        const result = await invoke<{ configured?: boolean; error?: string }>('orchestrator_get_status');
        if (result.error) {
          cachedStatus = 'error';
          cachedError = result.error;
          setStatus('error');
          setErrorMessage(result.error);
        } else if (result.configured) {
          cachedStatus = 'configured';
          cachedError = null;
          setStatus('configured');
        } else {
          cachedStatus = 'not-configured';
          cachedError = null;
          setStatus('not-configured');
        }
      } catch (err) {
        // Command not implemented yet in Tauri -- treat as not-configured
        cachedStatus = 'not-configured';
        cachedError = null;
        setStatus('not-configured');
      }
    };

    checkStatus();
  }, []);

  const handleSetup = async () => {
    setIsSettingUp(true);
    setErrorMessage(null);

    try {
      const result = await invoke<{ success?: boolean; error?: string }>('orchestrator_setup');
      if (result.success) {
        cachedStatus = 'configured';
        cachedError = null;
        setStatus('configured');
        onToggle(true);
      } else {
        setErrorMessage(result.error || 'Setup failed');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Orchestrator setup not available yet');
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleRemove = async () => {
    setIsSettingUp(true);
    setErrorMessage(null);

    try {
      const result = await invoke<{ success?: boolean; error?: string }>('orchestrator_remove');
      if (result.success) {
        cachedStatus = 'not-configured';
        cachedError = null;
        setStatus('not-configured');
        onToggle(false);
      } else {
        setErrorMessage(result.error || 'Remove failed');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Orchestrator remove not available yet');
    } finally {
      setIsSettingUp(false);
    }
  };

  if (!isElectron()) {
    return null;
  }

  return (
    <div className="p-4 rounded-md border border-primary/30 bg-primary/5">
      <div className="flex items-start gap-3">
        <button
          onClick={() => {
            if (status === 'configured') {
              onToggle(!isOrchestrator);
            }
          }}
          disabled={status !== 'configured'}
          className={`
            mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-all shrink-0
            ${isOrchestrator && status === 'configured'
              ? 'bg-primary border-primary'
              : 'border-primary/50 hover:border-primary'
            }
            ${status !== 'configured' ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          {isOrchestrator && status === 'configured' && <Check className="w-3 h-3 text-white" />}
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm">Orchestrator Mode (Super Agent)</span>
            {status === 'loading' && (
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
            )}
            {status === 'configured' && (
              <span className="text-xs px-1.5 py-0.5 rounded-sm bg-green-500/20 text-green-500">
                Ready
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            This agent can create, manage, and coordinate other agents. It has full control over the agent fleet.
          </p>

          {status === 'not-configured' && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2">
                Enable orchestrator capabilities by adding the MCP server to Claude&apos;s configuration.
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleSetup}
                disabled={isSettingUp}
                className="bg-primary/20 text-primary hover:bg-primary/30"
              >
                {isSettingUp ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5" />
                    Enable Orchestrator
                  </>
                )}
              </Button>
            </div>
          )}

          {status === 'configured' && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                <span className="text-xs text-green-500">MCP orchestrator is configured</span>
              </div>
              {isOrchestrator && (
                <div className="mt-2">
                  <p className="text-[10px] text-muted-foreground mb-1.5">Scope</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onScopeChange('tab')}
                      className={`text-xs px-3 py-1 rounded border transition-colors ${
                        scope === 'tab'
                          ? 'bg-primary/20 border-primary/50 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/30'
                      }`}
                    >
                      👑 Tab only
                    </button>
                    <button
                      onClick={() => onScopeChange('all')}
                      className={`text-xs px-3 py-1 rounded border transition-colors ${
                        scope === 'all'
                          ? 'bg-primary/20 border-primary/50 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/30'
                      }`}
                    >
                      👑👑 Global
                    </button>
                  </div>
                </div>
              )}
              <button
                onClick={handleRemove}
                disabled={isSettingUp}
                className="mt-2 text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
              >
                {isSettingUp ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Removing...
                  </>
                ) : (
                  <>
                    <X className="w-3 h-3" />
                    Remove orchestrator config
                  </>
                )}
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center gap-2 text-destructive">
                <XCircle className="w-3.5 h-3.5" />
                <span className="text-xs">{errorMessage || 'An error occurred'}</span>
              </div>
            </div>
          )}

          {errorMessage && status !== 'error' && (
            <div className="mt-2 text-xs text-destructive flex items-center gap-1">
              <XCircle className="w-3 h-3" />
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
