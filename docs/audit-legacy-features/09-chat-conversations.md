# Audit: Chat / Conversations

**Statut:** CODE MORT — types et mocks uniquement
**Risque:** Nul (aucune UI visible)

## Description

Types et donnees mock pour un systeme de chat/conversation. Jamais implemente en tant que feature.

## Ce qui existe

### Types

| Fichier | Role |
|---------|------|
| `src/types/index.ts` (L81-105) | Interfaces `Chat` et `ChatMessage` |

### Mock Data

| Fichier | Role |
|---------|------|
| `src/store/index.ts` | `sampleChats` avec des conversations fictives. Aussi : `sampleSkills`, `sampleAgents`, `sampleProjects`, `sampleTasks`, `sampleEntities`, `sampleDashboardStats` |

### Store

| Fichier | Role |
|---------|------|
| `src/store/index.ts` | Methodes `useStore().chats` et fonctions associees |

**Aucun composant, aucune route, aucune page.**

## Decision requise

- **Supprimer** : retirer les types Chat/ChatMessage, les sample data, les methodes store inutilisees
