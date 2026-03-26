# Audit: Automations

**Statut:** CASSE sous Tauri — backend 100% Electron
**Risque:** Eleve (page accessible dans la sidebar, toutes les actions echouent)

## Description

Systeme d'automatisations event-driven : surveiller des sources externes (GitHub, JIRA, Pipedrive, Twitter, RSS, custom), filtrer les evenements, les traiter via un agent IA, et envoyer les resultats vers des canaux de sortie (Telegram, Slack, GitHub comments, etc.).

## Ce qui existe

### Frontend (FONCTIONNEL mais sans backend)

| Fichier | Role |
|---------|------|
| `src/routes/automations.tsx` | Page complete avec CRUD : sources, schedules, agents, outputs, logs, toggles |

### Backend Electron (MORT sous Tauri)

| Fichier | Role |
|---------|------|
| `electron/handlers/automation-handlers.ts` | IPC handlers : `automation:list`, `create`, `update`, `delete`, `run`, `getLogs` |
| `electron/services/kanban-automation.ts` | Service d'automation Kanban : auto-creation d'agents pour les taches |

**Pas de commandes Tauri equivalentes.** Aucun fichier dans `src-tauri/src/commands/` pour les automations.

### MCP Orchestrator (FONCTIONNEL independamment)

| Fichier | Role |
|---------|------|
| `mcp-orchestrator/src/tools/automations.ts` (1200+ lignes) | Tools MCP complets : `list_automations`, `create_automation`, `update_automation`, `delete_automation`, `run_automation`, `pause/resume`, `run_due_automations` |
| `mcp-orchestrator/src/utils/automations.ts` (441 lignes) | Utilitaires : storage, dedup, runs, templates, scheduling |

### Stockage

| Fichier | Contenu |
|---------|---------|
| `~/.dorotoring/automations.json` | Definitions des automations |
| `~/.dorotoring/automations-runs.json` | Historique d'execution (max 1000) |
| `~/.dorotoring/automations-processed.json` | Tracking de deduplication |
| `~/.dorotoring/automations-last-run.json` | Timestamps derniere execution |
| `~/.dorotoring/logs/automation-{id}.log` | Logs d'execution |

### Tests (ORPHELINS)

| Fichier | Role |
|---------|------|
| `__tests__/mcp/orchestrator-automations.test.ts` | Tests outils MCP automations |
| `__tests__/electron/handlers/automation-handlers.test.ts` | Tests handlers Electron |

## Sources supportees

| Source | Evenements |
|--------|-----------|
| GitHub | PRs, issues, releases, commits |
| JIRA | Issues avec filtrage JQL |
| Pipedrive | Deals, activites, personnes |
| Twitter | Recherche, timelines utilisateur |
| RSS | Flux RSS/Atom |
| Custom | Commandes shell arbitraires |

## Canaux de sortie

Telegram, Slack, GitHub comments, JIRA (creation issues + transitions), Webhooks, Email, Discord

## Fonctionnalites detaillees

- Polling des sources avec intervalle configurable
- Deduplication par hash de contenu
- Regles de filtrage (equals, contains, starts_with, regex)
- Interpolation de templates pour les outputs
- Execution d'agent avec prompt custom
- Selection de modele (sonnet, opus, haiku)
- Mode autonome (skip permissions)
- Historique des runs avec statut
- Activation/desactivation par toggle

## Etat actuel

La page frontend est accessible et s'affiche correctement, mais **toutes les operations CRUD echouent** car les IPC handlers Electron ne sont pas disponibles sous Tauri. Le MCP orchestrator a ses propres tools fonctionnels, mais ils ne sont pas connectes au frontend.

## Decision requise

- **Migrer vers Tauri** : creer les commandes Rust dans `src-tauri/src/commands/automations.rs` (gros travail ~500+ lignes)
- **Connecter au MCP** : utiliser les tools MCP existants comme backend (architecture differente)
- **Supprimer le frontend** : retirer la page et le lien sidebar
- **Masquer** : cacher le lien sidebar en attendant la migration
