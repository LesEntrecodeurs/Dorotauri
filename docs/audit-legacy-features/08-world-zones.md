# Audit: World / Zones (Pokaimon World Generator)

**Statut:** ORPHELIN — jamais wire dans le frontend
**Risque:** Nul (aucune route, aucune UI visible)

## Description

Generateur de zones pour un monde Pokaimon avec import/export, sprites, tilemaps et validation.

## Ce qui existe

### Frontend (JAMAIS UTILISE)

| Fichier | Role |
|---------|------|
| `src/hooks/useWorldZones.ts` | Hook avec `invoke('world_list_zones')` et `invoke('world_delete_zone')` — jamais appele |
| `src/types/world.ts` | Type `GenerativeZone` |
| `src/lib/generation/validate-zone.ts` | Logique de validation de zones |
| `src/lib/generation/skill-prompt.ts` | References a la generation de zones |

### Backend Electron (MORT)

| Fichier | Role |
|---------|------|
| `electron/handlers/world-handlers.ts` (500+ lignes) | Import/export/validation de zones, gestion sprites, validation tilemaps |

**Aucune route, aucune page, aucun composant visible.** Le hook existe mais n'est importe nulle part.

### Stockage

- `localStorage['pokaimon-zones']` reference dans le code mais aucune UI

## Decision requise

- **Supprimer** : retirer le hook, les types, les utils de generation, le handler Electron
