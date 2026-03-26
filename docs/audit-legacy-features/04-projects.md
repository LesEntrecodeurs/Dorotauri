# Audit: Projects (Gestion de Projets)

**Statut:** FONCTIONNEL sous Tauri
**Risque:** Faible (feature principale qui marche)

## Description

Page de gestion de projets permettant de decouvrir, organiser et naviguer les projets de developpement. Auto-detection des repos git, integration avec les sessions Claude Code, favoris, et lien vers les agents.

## Ce qui existe

### Frontend (FONCTIONNEL)

| Fichier | Role |
|---------|------|
| `src/routes/projects.tsx` (1135 lignes) | Page complete : grille de projets, recherche, filtres (Favoris/Actifs/Caches), panneau detail |
| `src/components/Dashboard/ProjectsOverview.tsx` | Overview dans le dashboard : top 6 projets |
| `src/components/TerminalsView/components/SidebarProjectBrowser.tsx` | Browser de projets dans la sidebar terminaux |
| `src/components/TerminalsView/components/ProjectTabBar.tsx` | Barre d'onglets par projet (deprecated) |
| `src/components/CanvasView/components/ProjectNodeCard.tsx` | Noeud projet sur le canvas |
| `src/components/AgentList/ProjectFilterTabs.tsx` | Filtrage d'agents par projet |
| `src/components/AgentTerminalDialog/AgentDialogSecondaryProject.tsx` | Selection de projet secondaire pour agents |

### Hooks (FONCTIONNEL)

| Fichier | Role |
|---------|------|
| `src/hooks/useClaude.ts` | `useClaude()`, `useProjects()`, `useSessionMessages()` |
| `src/hooks/useElectron.ts` | `useElectronFS().fetchProjects()` → appelle `invoke('projects_list')` |

### Types

| Fichier | Role |
|---------|------|
| `src/lib/claude-code.ts` | `ClaudeProject`, `ClaudeSession` interfaces |
| `src/types/index.ts` | `Project`, `ProjectStatus` (active/archived/paused) |

### Backend Tauri (FONCTIONNEL)

| Fichier | Role |
|---------|------|
| `src-tauri/src/commands/shell.rs` | `projects_list()` — scanne les dossiers git dans ~/projects, ~/code, ~/dev, ~/src, ~/Documents, ~/repos, ~/workspace |

### Backend Electron (MORT)

| Fichier | Role |
|---------|------|
| `electron/handlers/ipc-handlers.ts` (L1587) | `fs:list-projects` handler |
| `electron/preload.ts` | `fs.listProjects()` bridge |

### Persistence

| Stockage | Contenu |
|----------|---------|
| `localStorage['dorotoring-custom-projects']` | Projets ajoutes manuellement |
| `appSettings.favoriteProjects` | Chemins des projets favoris |
| `appSettings.hiddenProjects` | Chemins des projets caches |
| `appSettings.defaultProjectPath` | Projet par defaut (pin) |

## Fonctionnalites

- Auto-decouverte des repos git dans les dossiers standards
- Merge avec les projets Claude Code (`~/.claude/projects/`)
- Organisation : favoris, caches, projet par defaut
- Recherche par nom/chemin
- Detail : branche git, agents, sessions, messages
- Actions rapides : ouvrir dans Cursor, lancer un agent
- Codes couleur consistants par projet
- Canvas : noeuds de projet draggables

## Etat actuel

**Pleinement fonctionnel.** La commande Tauri `projects_list` existe et fonctionne. Les donnees Claude Code sont lues directement du filesystem. Pas de bugs connus.

## Decision

Rien a faire — feature operationnelle.
