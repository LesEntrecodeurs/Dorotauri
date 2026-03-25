# Dorotoring

A lightweight desktop app to manage your AI coding agents. Run [Claude Code](https://claude.ai/code), [Codex](https://chatgpt.com/codex), [Gemini CLI](https://geminicli.com/) and local agents in parallel — deploy, monitor, and debug from one interface.

Built with Tauri v2 + Rust for speed and a tiny footprint. Inspired by [Dorothy](https://github.com/Charlie85270/Dorothy).

## Features

### Parallel Agent Management

Run 10+ agents simultaneously, each in its own PTY terminal. Agents operate independently across different projects and codebases.

- Spawn unlimited concurrent agents with full PTY support
- Real-time terminal output streaming via xterm.js
- Model selection per agent (Sonnet, Opus, Haiku)
- Agent lifecycle: `idle` → `running` → `completed` / `error` / `waiting`
- Secondary project paths, git worktree support
- Persistent state across restarts

### Super Agent (Orchestrator)

A meta-agent that controls all other agents. Give it a task, it delegates and coordinates across your agent pool.

- Creates, starts, stops agents via MCP tools
- Delegates based on agent skills
- Monitors progress, handles errors
- Remote control via Telegram and Slack

### Workspace Tabs

Organize agents into workspace tabs. Each tab has its own set of agents with mosaic terminal layout.

- Drag-and-drop terminal tiling (react-mosaic)
- Layout presets: single, 2-col, 2-row, quad, 3+1
- Pop-out console windows
- Quick terminal (Ctrl+T)
- Zen mode (F11) and fullscreen toggle

### Kanban Board

Task board integrated with the agent system. Drag tasks through `Backlog → Planned → Ongoing → Done` and let agents auto-pick them up.

### Automations

Poll external sources (GitHub PRs, JIRA issues) and spawn agents to process each item autonomously. Template variables inject item data into agent prompts.

### Scheduled Tasks

Run agents on cron schedules — recurring maintenance, monitoring, reporting.

### Vault

Shared document store (SQLite + FTS5) where agents read, write, and search across sessions.

### Remote Control

Control your agent fleet from Telegram or Slack. Start agents, check status, delegate tasks from your phone.

### Usage Tracking

Monitor API usage across all agents — tokens, costs, activity patterns.

## Tech Stack

| Category | Technology |
|----------|-----------|
| **Desktop** | Tauri v2 (Rust backend) |
| **Frontend** | React 19 + Vite |
| **Routing** | React Router 7 |
| **UI** | shadcn/ui + Tailwind CSS 4 |
| **State** | Zustand |
| **Terminal** | xterm.js + portable-pty (Rust) |
| **Layout** | react-mosaic |
| **Database** | rusqlite (SQLite) |
| **MCP** | @modelcontextprotocol/sdk |

## Installation

### Prerequisites

- **Node.js** 18+
- **Rust** (via [rustup](https://rustup.rs))
- **Claude Code CLI**: `npm install -g @anthropic-ai/claude-code`

### Build from source

```bash
git clone https://github.com/LesEntrecodeurs/dorotoring.git
cd dorotoring
npm install
npm run tauri:dev        # Development
npm run tauri:build      # Production build
```

### Platform notes

- **Linux**: requires `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`
- **macOS**: Xcode Command Line Tools

## Project Structure

```
dorotoring/
├── src/                        # React frontend
│   ├── components/             # UI components (shadcn/ui)
│   ├── routes/                 # React Router pages
│   ├── hooks/                  # Tauri bridge hooks
│   ├── store/                  # Zustand state
│   └── main.tsx                # Entry point
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── commands/           # Tauri IPC commands
│   │   │   ├── agent.rs        # Agent CRUD
│   │   │   ├── pty.rs          # PTY management
│   │   │   ├── settings.rs     # Settings persistence
│   │   │   ├── vault.rs        # Vault (rusqlite)
│   │   │   └── window.rs       # Window management
│   │   ├── pty.rs              # portable-pty manager
│   │   ├── state.rs            # AppState persistence
│   │   └── lib.rs              # Tauri plugin setup
│   └── tauri.conf.json
├── mcp-orchestrator/           # MCP server (agent orchestration)
├── mcp-telegram/               # MCP server (Telegram)
├── mcp-kanban/                 # MCP server (task management)
├── mcp-vault/                  # MCP server (document store)
└── mcp-socialdata/             # MCP server (Twitter/X)
```

## MCP Servers

Five MCP servers expose 40+ tools for programmatic control:

| Server | Tools | Purpose |
|--------|-------|---------|
| `mcp-orchestrator` | 26+ | Agent management, messaging, scheduling, automations |
| `mcp-kanban` | 8 | Kanban CRUD |
| `mcp-vault` | 10 | Document management + FTS search |
| `mcp-telegram` | 4 | Telegram messaging with media |
| `mcp-socialdata` | 5 | Twitter/X data via SocialData API |

## Configuration

| File | Description |
|------|-------------|
| `~/.dorothy/app-settings.json` | App settings (tokens, preferences) |
| `~/.dorothy/agents.json` | Persisted agent state |
| `~/.dorothy/kanban-tasks.json` | Kanban tasks |
| `~/.dorothy/vault.db` | Vault (SQLite) |
| `~/.claude/settings.json` | Claude Code settings |

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features and future direction.

## Contributing

Contributions welcome. Fork, branch, PR.

## Credits

Dorotoring is a fork of [Dorothy](https://github.com/Charlie85270/Dorothy) by [@Charlie85270](https://github.com/Charlie85270), rewritten from Electron + Next.js to Tauri v2 + Vite with a shadcn/ui redesign.

## License

[MIT](LICENSE)
