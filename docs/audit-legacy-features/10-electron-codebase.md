# Audit: Codebase Electron Legacy

**Statut:** ENTIEREMENT MORT sous Tauri
**Risque:** Nul fonctionnellement, mais ~2.5MB de code mort qui pollue le repo

## Description

L'integralite du dossier `electron/` est l'ancien backend Electron d'avant le fork vers Tauri. Aucun de ces fichiers n'est utilise par l'app Tauri.

## Inventaire

### Core (~5 fichiers)

| Fichier | Role |
|---------|------|
| `electron/main.ts` | Bootstrap du process principal Electron |
| `electron/preload.ts` | Script preload (bridge IPC) |
| `electron/core/pty-manager.ts` | Gestion des pseudo-terminaux |
| `electron/core/tray-manager.ts` | Icone system tray |
| `electron/core/window-manager.ts` | Gestion des fenetres |

### Handlers (~11 fichiers)

| Fichier | Role |
|---------|------|
| `electron/handlers/ipc-handlers.ts` | Handler IPC principal (1500+ lignes) |
| `electron/handlers/automation-handlers.ts` | Automations |
| `electron/handlers/cli-paths-handlers.ts` | Resolution chemins CLI |
| `electron/handlers/gws-handlers.ts` | Git worktree |
| `electron/handlers/kanban-handlers.ts` | Kanban board |
| `electron/handlers/mcp-config-handlers.ts` | Config MCP |
| `electron/handlers/memory-handlers.ts` | Memoire |
| `electron/handlers/obsidian-handlers.ts` | Integration Obsidian |
| `electron/handlers/scheduler-handlers.ts` | Scheduler |
| `electron/handlers/vault-handlers.ts` | Vault documents |
| `electron/handlers/world-handlers.ts` | World/Zones |

### Services

| Fichier | Role |
|---------|------|
| `electron/services/memory-service.ts` | Service memoire |
| `electron/services/slack-bot.ts` | Bot Slack |
| `electron/services/telegram-bot.ts` | Bot Telegram |
| `electron/services/api-routes/` | Routes API HTTP |

### Providers

| Dossier | Role |
|---------|------|
| `electron/providers/` | Providers LLM |

### Utils

| Fichier | Role |
|---------|------|
| `electron/utils/broadcast.ts` | Broadcast IPC vers fenetres |
| `electron/utils/agents-tick.ts` | Tick agents |
| `electron/utils/cron-parser.ts` | Parsing cron |

### Tests (~30+ fichiers)

| Dossier | Role |
|---------|------|
| `__tests__/electron/` | Tests unitaires pour tous les handlers Electron |

## Aussi concerne

### `src/types/electron.d.ts` (900+ lignes)

Declare l'interface `ElectronAPI` complete avec ~20 namespaces. Devrait etre remplace par des types Tauri mais est encore reference par le frontend. Contient des declarations pour des features qui n'existent plus :
- `world`, `zones`
- `plugin` (installStart, installWrite, installResize, installKill)
- `updates` (checking for updates)
- `obsidian` (integration)
- `memory` (partiellement migre)

## Decision requise

- **Archiver** : deplacer dans une branche `legacy/electron` pour reference
- **Supprimer** : `rm -rf electron/ __tests__/electron/` + nettoyer `electron.d.ts`
- **Garder** : comme reference pour la migration (risque de confusion)
