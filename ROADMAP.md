# Roadmap

> Last updated: 2026-03-25

This document tracks planned features and improvements for Dorotauri. Items are organized by timeframe and may shift as priorities evolve. Contributions and feedback welcome — open an issue to discuss any item.

**Legend:** &ensp; 🟢 Done &ensp; 🔵 In Progress &ensp; ⚪ Planned

---

## Near-term

Core improvements and integrations that are next in line.

| Status | Feature | Description |
|--------|---------|-------------|
| ⚪ | **Multi-provider project detection** | Detect projects from Codex (`~/.codex/`), OpenCode (`~/.opencode/`), and Gemini CLI alongside Claude Code. Unified project view regardless of which agent CLI created the session. |
| ⚪ | **Discord integration** | Remote control of the agent fleet via Discord bot — start agents, check status, receive notifications, delegate tasks from a Discord server. Complements existing Telegram and Slack support. |

## Near-term — Backend Rust Migration

Migrate remaining Electron/Node.js services to native Rust within Tauri for lower memory usage, better concurrency, and eliminating the Node.js dependency.

| Status | Feature | Description |
|--------|---------|-------------|
| ⚪ | **Slack & Telegram bots** | Rewrite bot services using `reqwest` + `tokio` instead of `@slack/bolt` and `node-telegram-bot-api`. |
| ⚪ | **Cron parser** | Replace the JS cron parser with the `cron` crate for native scheduling. |
| ⚪ | **MCP config handling** | Migrate MCP configuration read/write to `serde` + native `std::fs`. |
| ⚪ | **Process spawning** | Replace Node.js child process management with `tokio::process` for agent lifecycle control. |

## Mid-term

Larger efforts that expand what Dorotauri can do and where it can run.

| Status | Feature | Description |
|--------|---------|-------------|
| ⚪ | **Headless mode** | Run Dorotauri as a background daemon on a server without a GUI. Expose a REST/WebSocket API for remote management. Enables CI/CD integration and always-on agent fleets on cloud VMs. |
| ⚪ | **Web dashboard for headless** | Lightweight web UI to monitor and control a headless Dorotauri instance from a browser. |
| ⚪ | **Multi-provider agent support** | Spawn agents using Codex, Gemini CLI, or OpenCode directly from the UI — not just Claude Code. Per-agent provider selection. |

## Long-term

Exploratory ideas and larger vision items.

| Status | Feature | Description |
|--------|---------|-------------|
| ⚪ | **Plugin system** | Allow community-built plugins to extend Dorotauri — custom MCP servers, new agent providers, UI widgets. |
| ⚪ | **Team collaboration** | Shared agent fleet across a team — role-based access, shared Vault, centralized usage tracking. |
| ⚪ | **Mobile companion app** | Monitor and control your agent fleet from a mobile app (iOS/Android). |

---

## Contributing to the Roadmap

Have an idea? Open an [issue](https://github.com/LesEntrecodeurs/dorotauri/issues) with the `roadmap` label. PRs that address roadmap items are especially welcome.
