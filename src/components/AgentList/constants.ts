import {
  Circle,
  Activity,
  CheckCircle,
  AlertCircle,
  Pause,
} from 'lucide-react';
import type { ProcessState } from '@/types/electron';

export const STATUS_COLORS: Record<ProcessState, { bg: string; text: string; icon: typeof Circle }> = {
  inactive: { bg: 'bg-emerald-500/15', text: 'text-emerald-700', icon: Circle },
  running: { bg: 'bg-primary/10', text: 'text-primary', icon: Activity },
  completed: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: CheckCircle },
  error: { bg: 'bg-red-500/20', text: 'text-red-400', icon: AlertCircle },
  waiting: { bg: 'bg-amber-500/20', text: 'text-amber-700', icon: Pause },
  dormant: { bg: 'bg-zinc-500/20', text: 'text-zinc-400', icon: Circle },
};

export const STATUS_LABELS: Record<ProcessState, string> = {
  inactive: 'ready to work',
  running: 'working',
  completed: 'done',
  error: 'error',
  waiting: 'waiting for inputs',
  dormant: 'dormant',
};

export const CHARACTER_FACES: Record<string, string> = {
  robot: '🤖',
  ninja: '🥷',
  wizard: '🧙',
  astronaut: '👨‍🚀',
  knight: '⚔️',
  pirate: '🏴‍☠️',
  alien: '👽',
  viking: '🪓',
  frog: '🐸',
};

export const getProjectColor = (name: string) => {
  const colors = [
    { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/20' },
    { bg: 'bg-amber-600/10', text: 'text-amber-700', border: 'border-amber-600/20' },
    { bg: 'bg-blue-600/10', text: 'text-blue-700', border: 'border-blue-600/20' },
    { bg: 'bg-purple-600/10', text: 'text-purple-700', border: 'border-purple-600/20' },
    { bg: 'bg-rose-600/10', text: 'text-rose-700', border: 'border-rose-600/20' },
    { bg: 'bg-cyan-600/10', text: 'text-cyan-700', border: 'border-cyan-600/20' },
    { bg: 'bg-orange-600/10', text: 'text-orange-700', border: 'border-orange-600/20' },
    { bg: 'bg-indigo-600/10', text: 'text-indigo-700', border: 'border-indigo-600/20' },
  ];
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
};

export const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  local: 'Local',
};

export const getStatusPriority = (status: string) => {
  if (status === 'running') return 0;
  if (status === 'waiting') return 1;
  return 2;
};
