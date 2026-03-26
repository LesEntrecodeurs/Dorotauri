# Audit: Memory (Gestion Memoire In-App)

**Statut:** PARTIELLEMENT FONCTIONNEL sous Tauri — delete casse
**Risque:** Moyen (feature visible dans la sidebar, utilisateurs peuvent rencontrer l'erreur)

## Description

Page Memory permettant de naviguer, editer, creer et supprimer les fichiers memoire de Claude Code / Codex / Gemini (`~/.claude/projects/*/memory/*.md`). Inclut aussi un graphe de connaissances interactif (force-directed graph).

## Ce qui existe

### Frontend (FONCTIONNEL)

| Fichier | Role |
|---------|------|
| `src/routes/memory.tsx` | Page complete : 3 panneaux (projets, fichiers, editeur), stats, modal creation, suppression |
| `src/components/Memory/AgentKnowledgeGraph.tsx` | Graphe force-directed : agents, fichiers memoire, skills, instructions, plugins, MCP |
| `src/components/Sidebar.tsx` | Lien `/memory` avec icone Brain |
| `src/hooks/useMemory.ts` | Hook React : `fetchProjects`, `selectProject`, `selectFile`, `saveFile`, `createFile`, `deleteFile`, `refresh` |

### Types (FONCTIONNEL)

| Fichier | Role |
|---------|------|
| `src/types/electron.d.ts` | `MemoryFile`, `ProjectMemory`, `ElectronAPI.memory` interfaces |

### Backend Tauri (PARTIELLEMENT FONCTIONNEL)

| Fichier | Role | Statut |
|---------|------|--------|
| `src-tauri/src/commands/memory.rs` | `memory_list_projects()` | OK |
| `src-tauri/src/commands/memory.rs` | `memory_read_file(path)` | OK |
| `src-tauri/src/commands/memory.rs` | `memory_write_file(path, content)` | OK |
| `src-tauri/src/commands/memory.rs` | `memory_create_file(dir, name, content)` | OK |
| `src-tauri/src/commands/memory.rs` | `memory_delete_file(path)` | **MANQUANT** |
| `src-tauri/src/lib.rs` (L132-137) | Registration des commandes | 4/5 enregistrees |

### Legacy Electron (MORT)

| Fichier | Role |
|---------|------|
| `electron/handlers/memory-handlers.ts` | 5 IPC handlers (list, read, write, create, delete) |
| `electron/services/memory-service.ts` | Business logic avec validation de chemin |

### Tests (ORPHELINS — testent le code Electron)

| Fichier | Role |
|---------|------|
| `__tests__/electron/handlers/memory-handlers.test.ts` | Tests unitaires Electron |

## Bugs

### 1. `memory_delete_file` manquant (CRITIQUE)
- Le frontend appelle `invoke('memory_delete_file', { path })` via `useMemory.ts`
- La commande Tauri n'existe pas dans `memory.rs`
- La commande n'est pas enregistree dans `lib.rs`
- **Resultat :** erreur runtime quand on clique "Delete" sur un fichier memoire

### 2. Protection MEMORY.md
- Le frontend empeche la suppression de `MEMORY.md` (entrypoint) — OK
- Mais le backend ne valide pas cote serveur — si appele directement, pas de protection

## Providers supportes

| Provider | Dossier scanne |
|----------|----------------|
| Claude | `~/.claude/projects/*/memory/` |
| Codex | `~/.codex/projects/*/memory/` |
| Gemini | `~/.gemini/projects/*/memory/` |

## Fonctionnalites detaillees

- Navigation par projet avec recherche/filtre
- Edition inline avec sauvegarde
- Creation de fichiers `.md`
- Suppression (cassee sous Tauri)
- Stats (nb projets, nb fichiers, taille totale)
- Detection entrypoint (`MEMORY.md` toujours en premier)
- Decodage des chemins projets (tirets → slashes)
- Graphe de connaissances agents/memoire/skills

## Decision requise

- **Reparer** : ajouter `memory_delete_file` dans `memory.rs` + l'enregistrer dans `lib.rs` (~15 lignes)
- **Garder tel quel** : tout fonctionne sauf le delete
- **Supprimer** : retirer la page, le hook, le composant graphe
