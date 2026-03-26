# Audit Features Legacy — Sommaire

Date: 2026-03-26

Audit exhaustif des features post-fork Electron → Tauri + Vite.

## Vue d'ensemble

| # | Feature | Statut | Risque | Decision |
|---|---------|--------|--------|----------|
| 01 | [Broadcast](01-broadcast.md) | CASSE (wiring) | Faible | Reparer (1 ligne) ou supprimer |
| 02 | [Memory](02-memory.md) | PARTIEL (delete manquant) | Moyen | Reparer (~15 lignes) |
| 03 | [Automations](03-automations.md) | CASSE (pas de backend Tauri) | Eleve | Migrer, connecter MCP, ou supprimer |
| 04 | [Projects](04-projects.md) | FONCTIONNEL | Faible | Rien a faire |
| 05 | [Recurring Tasks](05-recurring-tasks.md) | CASSE (pas de backend Tauri) | Eleve | Migrer, connecter MCP, ou supprimer |
| 06 | [Kanban Board](06-kanban.md) | CASSE (pas de backend Tauri) | Moyen | Migrer ou supprimer |
| 07 | [Plugins Marketplace](07-plugins-marketplace.md) | CASSE (pas de backend Tauri) | Moyen | Migrer ou supprimer |
| 08 | [World / Zones](08-world-zones.md) | ORPHELIN (jamais wire) | Nul | Supprimer |
| 09 | [Chat / Conversations](09-chat-conversations.md) | CODE MORT | Nul | Supprimer |
| 10 | [Codebase Electron](10-electron-codebase.md) | ENTIEREMENT MORT | Nul | Archiver ou supprimer |
| 11 | [Docker](11-docker.md) | A VERIFIER | Moyen | Verifier backend |

## Repartition

### Fonctionnel (1)
- **Projects** — pleinement operationnel sous Tauri

### Reparable rapidement (2)
- **Broadcast** — 1 ligne de prop wiring manquante
- **Memory** — 1 commande Tauri manquante (`memory_delete_file`)

### Migration lourde necessaire (4)
- **Automations** — backend complet a ecrire (ou connecter au MCP orchestrator)
- **Recurring Tasks** — backend complet a ecrire (ou connecter au MCP orchestrator)
- **Kanban Board** — backend complet a ecrire
- **Plugins Marketplace** — backend complet a ecrire

### A supprimer (3)
- **World / Zones** — code orphelin jamais utilise
- **Chat / Conversations** — types et mocks morts
- **Codebase Electron** — ~2.5MB de code mort

### A verifier (1)
- **Docker** — statut backend incertain
