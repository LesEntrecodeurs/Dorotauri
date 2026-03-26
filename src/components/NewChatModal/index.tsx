


import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, Play, Check } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

import type { NewChatModalProps, AgentPersonaValues } from './types';
import type { AgentProvider } from '@/types/electron';
import type { AppSettings } from '@/components/Settings/types';
import { CHARACTER_OPTIONS, getRandomChampion } from './constants';
import { useSkillInstall } from './hooks/useSkillInstall';
import StepModel from './StepModel';
import StepTools from './StepTools';
import StepTask from './StepTask';
import SkillInstallTerminal from './SkillInstallTerminal';

const STEPS = [
  { label: 'Model', number: 1 },
  { label: 'Tools', number: 2 },
  { label: 'Task', number: 3 },
] as const;

function StepIndicator({ currentStep, onStepClick }: { currentStep: number; onStepClick: (step: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-0 py-1">
      {STEPS.map((s, i) => {
        const isCompleted = currentStep > s.number;
        const isActive = currentStep === s.number;
        const isFuture = currentStep < s.number;

        return (
          <div key={s.number} className="flex items-center">
            {/* Connector line before (skip first) */}
            {i > 0 && (
              <div
                className={`w-10 h-[2px] ${
                  isCompleted || isActive ? 'bg-foreground' : 'bg-border'
                }`}
              />
            )}

            {/* Step circle + label */}
            <button
              onClick={() => {
                if (isCompleted) onStepClick(s.number);
              }}
              disabled={isFuture || isActive}
              className={`flex flex-col items-center gap-1 ${
                isCompleted ? 'cursor-pointer' : isFuture ? 'cursor-default' : 'cursor-default'
              }`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                  isCompleted
                    ? 'bg-foreground text-background'
                    : isActive
                      ? 'bg-foreground text-background ring-2 ring-foreground/20 ring-offset-2 ring-offset-card'
                      : 'border-2 border-border text-muted-foreground'
                }`}
              >
                {isCompleted ? <Check className="w-3.5 h-3.5" /> : s.number}
              </div>
              <span
                className={`text-[11px] leading-none ${
                  isActive ? 'text-foreground font-medium' : isCompleted ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {s.label}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function NewChatModal({
  open,
  onClose,
  onSubmit,
  onUpdate,
  editAgent,
  installedSkills = [],
  allInstalledSkills = [],
  onRefreshSkills,
  initialStep,
}: NewChatModalProps) {
  const isEditMode = !!editAgent;
  // Step navigation
  const [step, setStep] = useState(initialStep || 1);

  // Step 1: Model
  const [provider, setProvider] = useState<AgentProvider>('claude');
  const [model, setModel] = useState<string>('default');
  const [localModel, setLocalModel] = useState('');
  const [tasmaniaEnabled, setTasmaniaEnabled] = useState(false);
  const [installedProviders, setInstalledProviders] = useState<Record<string, boolean>>({ claude: true, codex: true, gemini: true, opencode: true, pi: true });
  const agentPersonaRef = useRef<AgentPersonaValues>(getRandomChampion());
  // Track open/editAgent to synchronously update persona ref before children render
  const prevOpenRef = useRef(open);
  const prevEditAgentRef = useRef(editAgent);
  if (open !== prevOpenRef.current || editAgent !== prevEditAgentRef.current) {
    if (open) {
      if (editAgent) {
        agentPersonaRef.current = { character: editAgent.character || 'robot', name: editAgent.name || '' };
      } else {
        agentPersonaRef.current = getRandomChampion();
      }
    }
    prevOpenRef.current = open;
    prevEditAgentRef.current = editAgent;
  }

  // Step 2: Tools
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [installedSkillsByProvider, setInstalledSkillsByProvider] = useState<Record<string, string[]>>({});
  const [selectedObsidianVaults, setSelectedObsidianVaults] = useState<string[]>([]);
  const [registeredVaults, setRegisteredVaults] = useState<string[]>([]);
  const [detectedVault, setDetectedVault] = useState<string | null>(null);

  // Step 3: Task
  const [prompt, setPrompt] = useState('');
  const [useWorktree, setUseWorktree] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [isOrchestrator, setIsOrchestrator] = useState(false);

  // Refresh both parent skills and local provider-skill map
  const handleRefreshSkills = useCallback(() => {
    onRefreshSkills?.();
    invoke<Record<string, string[]>>('skill_list_installed_all').then((byProvider) => {
      if (byProvider) setInstalledSkillsByProvider(byProvider);
    }).catch(() => {
      // Command not implemented yet in Tauri
    });
  }, [onRefreshSkills]);

  // Skill installation hook
  const skillInstall = useSkillInstall(handleRefreshSkills);

  // Pre-compute installed skill names for the selected provider
  const installedSkillSet = useMemo(() => {
    const set = new Set<string>();
    const providerSkills = installedSkillsByProvider[provider] || [];
    for (const s of providerSkills) set.add(s.toLowerCase());
    return set;
  }, [installedSkillsByProvider, provider]);

  // Reset form when modal opens (or pre-populate in edit mode)
  useEffect(() => {
    if (open) {
      if (editAgent) {
        // Edit mode: pre-populate from existing agent
        setStep(initialStep || 1);
        setSelectedSkills(editAgent.skills || []);
        setPrompt('');
        setUseWorktree(!!editAgent.branchName);
        setBranchName(editAgent.branchName || '');
        setSkipPermissions(editAgent.skipPermissions || false);
        setProvider(editAgent.provider || 'claude');
        setLocalModel(editAgent.localModel || '');
        setSelectedObsidianVaults(editAgent.obsidianVaultPaths || []);
        setDetectedVault(null);
      } else {
        // Create mode: reset everything
        setStep(initialStep || 1);
        setSelectedSkills([]);
        setPrompt('');
        setUseWorktree(false);
        setBranchName('');
        setSkipPermissions(false);
        setProvider('claude');
        setLocalModel('');
        setSelectedObsidianVaults([]);
        setDetectedVault(null);
      }

      // Load app settings (Tasmania)
      invoke<AppSettings | null>('app_settings_get').then((settings) => {
        if (!settings) return;
        setTasmaniaEnabled(settings.tasmaniaEnabled || false);
      }).catch(() => {});

      // Load registered obsidian vaults
      invoke<{ vaultPaths?: string[] }>('obsidian_get_vault_info').then((info) => {
        setRegisteredVaults(info?.vaultPaths || []);
      }).catch(() => {
        setRegisteredVaults([]);
      });

      // Detect installed CLI providers
      invoke<Record<string, string>>('cli_paths_detect').then((paths) => {
        if (paths) {
          setInstalledProviders({
            claude: !!paths.claude,
            codex: !!paths.codex,
            gemini: !!paths.gemini,
            opencode: !!paths.opencode,
            pi: !!paths.pi,
          });
        }
      }).catch(() => {
        // Command not implemented yet — keep defaults
      });

      // Fetch per-provider installed skills
      invoke<Record<string, string[]>>('skill_list_installed_all').then((byProvider) => {
        if (byProvider) setInstalledSkillsByProvider(byProvider);
      }).catch(() => {
        // Command not implemented yet
      });
    }
  }, [open, initialStep, editAgent]);

  // Clear selected skills when provider changes
  useEffect(() => {
    setSelectedSkills([]);
  }, [provider]);

  const toggleSkill = useCallback((skillName: string) => {
    setSelectedSkills((prev) =>
      prev.includes(skillName) ? prev.filter((s) => s !== skillName) : [...prev, skillName]
    );
  }, []);

  const handleOrchestratorToggle = useCallback((enabled: boolean) => {
    setIsOrchestrator(enabled);
    if (enabled) {
      setSkipPermissions(true);
      agentPersonaRef.current = { ...agentPersonaRef.current, character: 'wizard' };
    }
  }, []);

  const handleToggleVault = useCallback((vp: string) => {
    setSelectedObsidianVaults(prev =>
      prev.includes(vp) ? prev.filter(p => p !== vp) : [...prev, vp]
    );
  }, []);

  const handleSubmit = useCallback(() => {
    if (useWorktree && !branchName.trim()) return;

    const { character: agentCharacter, name: agentName } = agentPersonaRef.current;
    const finalName = agentName.trim() || `${CHARACTER_OPTIONS.find(c => c.id === agentCharacter)?.name || 'Agent'}`;

    if (isEditMode && editAgent && onUpdate) {
      // Edit mode: update existing agent
      onUpdate(editAgent.id, {
        skills: selectedSkills,
        skipPermissions,
        name: finalName,
        character: agentCharacter,
      });
      onClose();
      return;
    }

    // Create mode
    const finalPrompt = prompt.trim()
      || (selectedSkills.length > 0 ? `Use the following skills: ${selectedSkills.join(', ')}` : '');
    const worktreeConfig = useWorktree ? { enabled: true, branchName: branchName.trim() } : undefined;

    onSubmit(selectedSkills, finalPrompt, model, worktreeConfig, agentCharacter, finalName, skipPermissions, provider, localModel, selectedObsidianVaults.length > 0 ? selectedObsidianVaults : undefined);

    // Reset form
    setStep(1);
    setSelectedSkills([]);
    setPrompt('');
    setUseWorktree(false);
    setBranchName('');
    agentPersonaRef.current = getRandomChampion();
    setSkipPermissions(false);
    setProvider('claude');
    setLocalModel('');
    setSelectedObsidianVaults([]);
  }, [prompt, selectedSkills, useWorktree, branchName, model, skipPermissions, provider, localModel, selectedObsidianVaults, onSubmit, isEditMode, editAgent, onUpdate, onClose]);

  // Can always continue (no project validation needed)
  const canContinue = true;
  const canStart = !useWorktree || !!branchName.trim();

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-2xl mx-4 bg-card border border-border shadow-2xl overflow-hidden h-[85vh] lg:h-[90vh] flex flex-col"
        >
          {/* Header: Step Indicator + Close */}
          <div className="px-4 lg:px-6 py-3 lg:py-4 border-b border-border flex items-center justify-between bg-secondary">
            <div className="flex-1">
              <StepIndicator currentStep={step} onStepClick={setStep} />
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {step === 1 && (
              <StepModel
                provider={provider}
                onProviderChange={setProvider}
                model={model}
                onModelChange={setModel}
                localModel={localModel}
                onLocalModelChange={setLocalModel}
                tasmaniaEnabled={tasmaniaEnabled}
                installedProviders={installedProviders}
                agentPersonaRef={agentPersonaRef}
              />
            )}

            {step === 2 && (
              <StepTools
                selectedSkills={selectedSkills}
                onToggleSkill={toggleSkill}
                allInstalledSkills={allInstalledSkills}
                installedSkillSet={installedSkillSet}
                onInstallSkill={skillInstall.handleInstallSkill}
                provider={provider}
                installedSkillsByProvider={installedSkillsByProvider}
                selectedObsidianVaults={selectedObsidianVaults}
                registeredVaults={registeredVaults}
                detectedVault={detectedVault}
                onToggleVault={handleToggleVault}
              />
            )}

            {step === 3 && (
              <StepTask
                prompt={prompt}
                onPromptChange={setPrompt}
                selectedSkills={selectedSkills}
                useWorktree={useWorktree}
                onToggleWorktree={() => setUseWorktree(prev => !prev)}
                branchName={branchName}
                onBranchNameChange={setBranchName}
                skipPermissions={skipPermissions}
                onToggleSkipPermissions={() => setSkipPermissions(prev => !prev)}
                isOrchestrator={isOrchestrator}
                onOrchestratorToggle={handleOrchestratorToggle}
                provider={provider}
                model={model}
                selectedObsidianVaults={selectedObsidianVaults}
              />
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-border flex items-center justify-between bg-secondary">
            <button
              onClick={() => step > 1 && setStep(step - 1)}
              disabled={step === 1}
              className="px-4 py-2 rounded-lg text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Back
            </button>

            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>

              {step < 3 ? (
                <button
                  onClick={() => setStep(step + 1)}
                  disabled={!canContinue}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!canStart}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    isEditMode
                      ? 'bg-foreground text-background hover:bg-foreground/90'
                      : 'bg-green-600 text-white hover:bg-green-600/90'
                  }`}
                >
                  {isEditMode ? (
                    <>
                      <Check className="w-4 h-4" />
                      Save Changes
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Start Agent
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {/* Skill Installation Terminal Modal */}
        <SkillInstallTerminal
          show={skillInstall.showInstallTerminal}
          installingSkill={skillInstall.installingSkill}
          installComplete={skillInstall.installComplete}
          installExitCode={skillInstall.installExitCode}
          terminalRef={skillInstall.terminalRef}
          onClose={skillInstall.closeInstallTerminal}
        />
      </motion.div>
    </AnimatePresence>
  );
}
