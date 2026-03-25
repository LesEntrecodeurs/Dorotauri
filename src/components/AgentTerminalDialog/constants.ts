import type { AgentCharacter } from '@/types/electron';

// Character emoji/icons mapping
export const CHARACTER_FACES: Record<AgentCharacter, string> = {
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

// Terminal theme configuration — Dorotoring violet palette (dark)
export const TERMINAL_THEME = {
  background: '#1A1726',
  foreground: '#E2DFF0',
  cursor: '#7C3AED',
  cursorAccent: '#1A1726',
  selectionBackground: '#7C3AED33',
  black: '#1A1726',
  red: '#EF4444',
  green: '#22C55E',
  yellow: '#F59E0B',
  blue: '#7C3AED',
  magenta: '#A78BFA',
  cyan: '#7C3AED',
  white: '#E2DFF0',
  brightBlack: '#6B6685',
  brightRed: '#F87171',
  brightGreen: '#4ADE80',
  brightYellow: '#FBBF24',
  brightBlue: '#A78BFA',
  brightMagenta: '#C4B5FD',
  brightCyan: '#A78BFA',
  brightWhite: '#F8F5FC',
} as const;

// Light terminal theme — Dorotoring violet palette (light)
export const TERMINAL_THEME_LIGHT = {
  background: '#F8F5FC',
  foreground: '#1E1B4B',
  cursor: '#7C3AED',
  cursorAccent: '#F8F5FC',
  selectionBackground: '#7C3AED33',
  black: '#1E1B4B',
  red: '#DC2626',
  green: '#16A34A',
  yellow: '#F59E0B',
  blue: '#7C3AED',
  magenta: '#8B5CF6',
  cyan: '#7C3AED',
  white: '#E2DFF0',
  brightBlack: '#6B6685',
  brightRed: '#EF4444',
  brightGreen: '#22C55E',
  brightYellow: '#FBBF24',
  brightBlue: '#A78BFA',
  brightMagenta: '#C4B5FD',
  brightCyan: '#A78BFA',
  brightWhite: '#F8F5FC',
} as const;

// Helper to get terminal theme by name
export function getTerminalTheme(theme: 'dark' | 'light' = 'dark') {
  return theme === 'light' ? TERMINAL_THEME_LIGHT : TERMINAL_THEME;
}

// Quick terminal theme (slightly different background)
export const QUICK_TERMINAL_THEME = {
  ...TERMINAL_THEME,
  background: '#15122B',
  cursor: '#A78BFA',
  cursorAccent: '#15122B',
  selectionBackground: '#A78BFA33',
} as const;

// Terminal configuration
export const TERMINAL_CONFIG = {
  fontSize: 13,
  fontFamily: 'JetBrains Mono, Menlo, Monaco, Courier New, monospace',
  cursorBlink: true,
  cursorStyle: 'bar' as const,
  scrollback: 10000,
  convertEol: true,
};

export const QUICK_TERMINAL_CONFIG = {
  ...TERMINAL_CONFIG,
  fontSize: 12,
  scrollback: 5000,
};

// Language mappings for syntax highlighting
export const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'markup',
  xml: 'markup',
  yaml: 'yaml',
  yml: 'yaml',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  prisma: 'graphql',
};

// Get language from file extension
export const getLanguageFromPath = (filePath: string): string => {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return LANGUAGE_MAP[ext] || 'typescript';
};

// File tree types
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  isExpanded?: boolean;
}

// Git data types
export interface GitData {
  branch: string;
  status: Array<{ status: string; file: string }>;
  diff: string;
  commits: Array<{ hash: string; message: string; author: string; date: string }>;
}

// Initial git data state
export const INITIAL_GIT_DATA: GitData = {
  branch: '',
  status: [],
  diff: '',
  commits: [],
};
