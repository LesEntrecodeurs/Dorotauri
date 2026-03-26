# Audit: Plugins / Marketplace

**Statut:** CASSE sous Tauri — backend Electron
**Risque:** Moyen (page accessible)

## Description

Marketplace de plugins avec installation depuis GitHub. Permet de chercher, installer et gerer des plugins/skills pour les agents.

## Ce qui existe

### Frontend

| Fichier | Role |
|---------|------|
| `src/routes/plugins.tsx` | Page marketplace de plugins |
| `src/components/PluginInstallDialog.tsx` | Dialog d'installation avec terminal integre |
| `src/lib/plugins-database.ts` | Base de donnees de plugins (fetch depuis GitHub) |
| `src/components/Settings/SkillsSection.tsx` | Section skills dans les settings |
| `src/components/NewChatModal/SkillInstallTerminal.tsx` | Terminal pour installation de skills |

### Types

| Fichier | Role |
|---------|------|
| `src/types/electron.d.ts` (L278-285) | `window.electronAPI.plugin` : `installStart`, `installWrite`, `installResize`, `installKill` |

### Backend

**Pas de commandes Tauri equivalentes pour le plugin namespace.**

## Fonctionnalites

- Catalogue de plugins depuis GitHub
- Installation via terminal embarque
- Gestion des skills installees
- Integration dans les settings

## Decision requise

- **Migrer** : creer les commandes Tauri pour l'installation de plugins
- **Supprimer** : retirer la page et les composants
