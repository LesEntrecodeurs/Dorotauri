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

// Terminal theme configuration — Dorothy warm palette (dark)
export const TERMINAL_THEME = {
  background: '#1A1714',
  foreground: '#E8DEC8',
  cursor: '#4DB8B0',
  cursorAccent: '#1A1714',
  selectionBackground: '#4DB8B033',
  black: '#1A1714',
  red: '#D4634D',
  green: '#5AAF62',
  yellow: '#CD7F4A',
  blue: '#4DB8B0',
  magenta: '#A080B2',
  cyan: '#4DB8B0',
  white: '#E8DEC8',
  brightBlack: '#7A6E58',
  brightRed: '#D4634D',
  brightGreen: '#5AAF62',
  brightYellow: '#CD7F4A',
  brightBlue: '#4DB8B0',
  brightMagenta: '#A080B2',
  brightCyan: '#4DB8B0',
  brightWhite: '#FAF4EA',
} as const;

// Light terminal theme — Dorothy warm palette (light)
export const TERMINAL_THEME_LIGHT = {
  background: '#FAF4EA',
  foreground: '#2C2418',
  cursor: '#3D9B94',
  cursorAccent: '#FAF4EA',
  selectionBackground: '#3D9B9433',
  black: '#2C2418',
  red: '#B85440',
  green: '#4A8B50',
  yellow: '#CD7F4A',
  blue: '#3D9B94',
  magenta: '#8B6B9B',
  cyan: '#3D9B94',
  white: '#E8DEC8',
  brightBlack: '#9A8E78',
  brightRed: '#D4634D',
  brightGreen: '#5AAF62',
  brightYellow: '#CD7F4A',
  brightBlue: '#4DB8B0',
  brightMagenta: '#A080B2',
  brightCyan: '#4DB8B0',
  brightWhite: '#FAF4EA',
} as const;

// Helper to get terminal theme by name
export function getTerminalTheme(theme: 'dark' | 'light' = 'dark') {
  return theme === 'light' ? TERMINAL_THEME_LIGHT : TERMINAL_THEME;
}

// Quick terminal theme (slightly different background)
export const QUICK_TERMINAL_THEME = {
  ...TERMINAL_THEME,
  background: '#15120F',
  cursor: '#A080B2',
  cursorAccent: '#15120F',
  selectionBackground: '#A080B233',
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
