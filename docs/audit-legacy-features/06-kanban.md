# Audit: Kanban Board (Gestion de Taches Projet)

**Statut:** CASSE sous Tauri — backend 100% Electron
**Risque:** Moyen (accessible via sidebar/dashboard)

## Description

Tableau Kanban pour gerer les taches de projet avec colonnes (backlog, planned, ongoing, done). Deplacer une tache vers "planned" declenche automatiquement la creation d'un agent pour la traiter.

## Ce qui existe

### Frontend

| Fichier | Role |
|---------|------|
| `src/components/KanbanBoard/index.tsx` | Composant principal du tableau |
| `src/components/KanbanBoard/components/NewTaskModal.tsx` | Modal creation : mode rapide (IA) + mode manuel, attachments |
| `src/components/KanbanBoard/components/` | Sous-composants du board |
| `src/components/Dashboard/LiveTaskFeed.tsx` | Feed de taches actives dans le dashboard |

### Types

| Fichier | Role |
|---------|------|
| `src/types/kanban.ts` | `KanbanTask`, `KanbanTaskCreate`, `KanbanTaskUpdate`, `TaskAttachment` |

### Backend Electron (MORT)

| Fichier | Role |
|---------|------|
| `electron/handlers/kanban-handlers.ts` | IPC handlers : `kanban:list`, `get`, `create`, `move`, `update`, `delete`, `getDetails` |
| `electron/services/kanban-automation.ts` | Auto-creation d'agents quand tache → "planned" |

**Pas de commandes Tauri equivalentes.**

### Preload API (Electron)

```typescript
kanban: {
  list(), get(id), create(params), move(id, column),
  update(id, updates), delete(id), getDetails(id)
}
```

## Fonctionnalites

- Colonnes : backlog → planned → ongoing → done
- Creation rapide par IA (natural language)
- Creation manuelle avec formulaire
- Attachments (images, PDFs, documents)
- Priorite, labels, skills
- Automation : deplacer vers "planned" → spawn agent
- Suivi de progression

## Decision requise

- **Migrer vers Tauri** : creer les commandes Rust
- **Supprimer** : retirer le composant et les types
- **Masquer** : cacher en attendant
