# Audit: Docker Management

**Statut:** A VERIFIER — frontend existe, backend Tauri incertain
**Risque:** Moyen (page accessible)

## Ce qui existe

### Frontend

| Fichier | Role |
|---------|------|
| `src/routes/docker.tsx` | Page complete de gestion Docker |

### Backend

A verifier si des commandes Tauri existent pour Docker ou si ca repose sur des appels shell directs.

## Decision requise

- Verifier le backend Tauri
- Fonctionnel → garder
- Pas de backend → masquer ou supprimer
