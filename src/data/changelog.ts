export interface Release {
  id: number;
  version: string;
  date: string;
  description?: string;
  updates: string[];
}

export const CHANGELOG: Release[] = [
  {
    id: 1,
    version: '1.0.0',
    date: '2026-03-25',
    description:
      'Dorotauri is a fork of Dorothy (github.com/Charlie85270/Dorothy), rewritten from Electron + Next.js to Tauri v2 + Vite + React Router with a full shadcn/ui redesign.',
    updates: [
      // Architecture — Tauri rewrite
      'Full rewrite from Electron + Next.js to Tauri v2 + Vite + React Router',
      'Rust backend core with Node.js sidecar for third-party integrations',
      'Multi-window console management with react-mosaic tiling layout',
      'PTY managed in Rust for lower-latency terminal output',

      // UI — shadcn/ui violet reskin
      'Complete UI redesign with shadcn/ui and violet theme (#7A33E0)',
      'Source Code Pro monospace font throughout — dev-tool aesthetic',
      'Near-black dark mode',
      'Zen / fullscreen mode (F11 / Ctrl+Shift+F)',
      'Collapsible sidebar with compact icon-only state',
      'macOS native traffic light inset support',

      // Multi-provider
      'Multi-provider support: Claude Code, Codex, Gemini CLI, PI, and OpenCode',
      'Provider selector in agent creation flow',
      'Memory page shows projects across all providers',
      'Custom MCP server configuration per provider',
      'CLI Paths settings for all provider binaries',

      // Layout & terminal UX
      'Layout presets, split terminals, drag-and-drop reordering',
      'Quick terminal shortcut (Ctrl+T)',
      'React app preview tab with live preview of react-app code blocks',
      'Settings cog opens agent edit modal directly from hub',
      'Revamped agents page with improved layout and filtering',

      // Skills
      'Skills marketplace with community skill browser',
      'Skill installation progress terminal',
      'Link skills to specific providers',

      // Notifications & hooks
      'Custom MP3/audio file support per notification type',
      '"Response Finished" notification toggle (Stop hook)',
      'Dedicated PermissionRequest and TaskCompleted hook events',
      'Status line option: model, context usage, git branch, session time, and token stats live in terminal',

      // Projects & MCP
      'Pinned and favorite projects with quick default selection',
      'JIRA self-hosted domain support',
      'Manage external MCP servers (outside Dorotauri) from settings',

      // macOS tray
      'macOS menu bar tray with live agent status panel',
      'Status tabs in tray: Working, Waiting for inputs, Ready to work, Idle',
      'Live task preview next to agent name',
      'Full-color Dorotauri logo in the macOS menu bar',

      // Agent lifecycle
      'Fixed agent status lifecycle: idle on start, working only after user prompt',

      // In progress
      '🔵 Agent-terminal unification — single Agent primitive replacing separate Agent + Terminal concepts, with dormant state and tab-based teams',
      '🔵 Sidebar usage widget — live API rate-limit consumption display',
      '🔵 Backend Rust migration — Slack/Telegram bots, cron parser, MCP config, and process spawning rewritten in native Rust',
    ],
  },
];

export const LATEST_RELEASE = CHANGELOG[0];
export const WHATS_NEW_STORAGE_KEY = 'dorotauri_whats_new_last_seen';
