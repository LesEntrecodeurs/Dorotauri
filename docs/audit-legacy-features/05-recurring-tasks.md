# Audit: Recurring Tasks (Taches Recurrentes / Scheduler)

**Statut:** CASSE sous Tauri — backend 100% Electron
**Risque:** Eleve (page accessible, toutes les operations echouent)

## Description

Systeme de planification de taches recurrentes avec cron, integration launchd (macOS) et crontab (Linux). Permet de programmer l'execution automatique d'agents Claude sur des schedules (horaire, quotidien, hebdomadaire, mensuel, custom cron).

## Ce qui existe

### Frontend (FONCTIONNEL mais sans backend)

| Fichier | Role |
|---------|------|
| `src/routes/recurring-tasks.tsx` | Page principale orchestrant le module RecurringTasks |
| `src/components/RecurringTasks/components/CreateTaskModal.tsx` | Modal creation de tache |
| `src/components/RecurringTasks/components/EditTaskModal.tsx` | Modal edition |
| `src/components/RecurringTasks/components/TaskCard.tsx` | Carte individuelle avec actions (run, edit, delete, logs) |
| `src/components/RecurringTasks/components/TaskList.tsx` | Liste des taches |
| `src/components/RecurringTasks/components/FilterBar.tsx` | Filtrage par projet/schedule |
| `src/components/RecurringTasks/components/PageHeader.tsx` | Header avec refresh/create |
| `src/components/RecurringTasks/components/ScheduleFieldPicker.tsx` | Constructeur d'expressions cron |
| `src/components/RecurringTasks/components/LogsModal.tsx` | Visualisation des logs d'execution |
| `src/components/RecurringTasks/components/NotificationFields.tsx` | Config notifications Telegram/Slack |
| `src/components/RecurringTasks/components/TaskOptionsFields.tsx` | Options (autonome, git worktree) |
| `src/components/RecurringTasks/components/Toast.tsx` | Notifications toast |
| `src/components/SchedulerCalendar.tsx` | Calendrier visuel des taches planifiees |

### Hooks Frontend

| Fichier | Role |
|---------|------|
| `src/components/RecurringTasks/hooks/useScheduledTasks.ts` | Chargement, refresh, run, delete |
| `src/components/RecurringTasks/hooks/useTaskForm.ts` | Formulaire creation |
| `src/components/RecurringTasks/hooks/useEditForm.ts` | Formulaire edition |
| `src/components/RecurringTasks/hooks/useTaskLogs.ts` | Logs en temps reel |
| `src/components/RecurringTasks/hooks/useToast.ts` | Toast state |

### Types & Utils Frontend

| Fichier | Role |
|---------|------|
| `src/components/RecurringTasks/types.ts` | `ScheduledTask`, `Agent`, `ScheduleFormFields`, `TaskLogRun`, `SCHEDULE_PRESETS`, `DAY_OPTIONS` |
| `src/components/RecurringTasks/utils.ts` | `buildCronExpression()`, `formatNextRun()` |

### Backend Electron (MORT sous Tauri)

| Fichier | Role |
|---------|------|
| `electron/handlers/scheduler-handlers.ts` (600+ lignes) | IPC handlers : `scheduler:listTasks`, `createTask`, `deleteTask`, `updateTask`, `runTask`, `getLogs`, `watchLogs`, `unwatchLogs`, `fixMcpPaths` |
| `electron/utils/cron-parser.ts` | Parsing cron, conversion launchd calendar entries |
| `electron/services/api-routes/scheduler-routes.ts` | Route HTTP `POST /api/scheduler/status` |

**Pas de commandes Tauri equivalentes.** Aucun fichier dans `src-tauri/src/commands/` pour le scheduler.

### MCP Orchestrator (FONCTIONNEL independamment)

| Fichier | Role |
|---------|------|
| `mcp-orchestrator/src/tools/scheduler.ts` (475 lignes) | Tools MCP : `list_scheduled_tasks`, `create_scheduled_task`, `delete_scheduled_task`, `run_scheduled_task`, `get_scheduled_task_logs`, `update_scheduled_task_status` |
| `mcp-orchestrator/src/utils/scheduler.ts` (400 lignes) | `cronToHuman()`, `getNextRunTime()`, `createLaunchdJob()`, `createCronJob()`, `deleteLaunchdJob()`, `deleteCronJob()`, `getClaudePath()` |

### Stockage

| Fichier | Contenu |
|---------|---------|
| `~/.claude/schedules.json` | Definitions globales des taches |
| `~/.claude/projects/{project}/schedules.json` | Taches par projet |
| `~/.dorotoring/scheduler-metadata.json` | Metadata (titre, agent, notifications, dernier statut) |
| `~/.dorotoring/scripts/{taskId}.sh` | Scripts d'execution generes |
| `~/.claude/logs/{taskId}.log` | Logs d'execution |
| `~/Library/LaunchAgents/com.dorotoring.scheduler.{taskId}.plist` | Jobs macOS launchd |

### Tests (ORPHELINS)

| Fichier | Role |
|---------|------|
| `__tests__/mcp/orchestrator-scheduler.test.ts` | Tests outils MCP scheduler |
| `__tests__/electron/handlers/scheduler-handlers.test.ts` | Tests handlers Electron |
| `__tests__/cron-parser.test.ts` | Tests parsing cron |

## Presets de schedule

| Preset | Cron |
|--------|------|
| Toutes les heures | `0 * * * *` |
| Tous les jours | `0 9 * * *` |
| Jours ouvrables | `0 9 * * 1-5` |
| Tous les N jours | `0 9 */N * *` |
| Jours specifiques | `0 9 * * 1,3,5` |
| Mensuel | `0 9 1 * *` |
| Custom cron | libre |

## Fonctionnalites detaillees

- Creation/edition/suppression de taches
- Execution manuelle immediate
- Execution autonome (skip permissions)
- Support git worktree (execution isolee)
- Notifications Telegram et Slack
- Assignation a un agent specifique
- Streaming de logs en temps reel
- Historique des executions avec statut (success/error/partial/running)
- Calendrier visuel semaine
- Multi-plateforme : macOS (launchd) + Linux (crontab)
- Multi-provider (Claude, Codex, Gemini)

## Etat actuel

La page s'affiche mais **toute interaction echoue** : listing, creation, execution, logs. Les hooks frontend appellent `invoke()` sur des commandes Electron qui n'existent pas dans Tauri.

## Decision requise

- **Migrer vers Tauri** : creer `src-tauri/src/commands/scheduler.rs` (gros travail ~400+ lignes, plus integration OS)
- **Connecter au MCP** : utiliser les tools MCP existants comme backend
- **Supprimer le frontend** : retirer la page, les composants, le calendrier
- **Masquer** : cacher le lien sidebar en attendant
