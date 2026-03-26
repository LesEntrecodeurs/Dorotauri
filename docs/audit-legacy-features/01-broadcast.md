# Audit: Broadcast (Input Broadcasting)

**Statut:** CASSE - wiring incomplet
**Risque:** Faible (feature isolee, pas d'effets de bord)

## Description

Le Broadcast Mode permettait d'envoyer le meme input a TOUS les terminaux/agents actifs en meme temps. Un bouton "Broadcasting" dans la toolbar globale activait ce mode, et chaque terminal affichait un badge "BROADCAST" pulse.

## Ce qui existe

### Frontend (FONCTIONNEL)

| Fichier | Role |
|---------|------|
| `src/components/TerminalsView/components/BroadcastIndicator.tsx` | Overlay anime "Broadcast Mode Active" avec icone Radio |
| `src/components/TerminalsView/components/GlobalToolbar.tsx` (L135-149) | Bouton toggle dans la toolbar |
| `src/components/TerminalsView/components/TerminalPanelHeader.tsx` (L84-88) | Badge "BROADCAST" pulse sur chaque terminal |
| `src/components/TerminalsView/components/TerminalPanelInput.tsx` | Placeholder adapte + callback `onBroadcastSubmit` |
| `src/components/TerminalsView/components/TerminalPanel.tsx` | Passe `isBroadcasting` aux enfants |

### State Management (FONCTIONNEL)

| Fichier | Role |
|---------|------|
| `src/components/TerminalsView/hooks/useBroadcast.ts` | Hook React: `broadcastMode`, `toggleBroadcast`, `enableBroadcast`, `disableBroadcast` |
| `src/components/TerminalsView/types.ts` (L34) | `broadcastMode: boolean` dans `TerminalsViewState` |
| `src/components/TerminalsView/index.tsx` (L124) | Utilise `useBroadcast()` et passe l'etat aux composants |

### Raccourci Clavier (FONCTIONNEL)

| Fichier | Role |
|---------|------|
| `src/components/TerminalsView/constants.ts` (L39) | `Ctrl+Shift+B` defini |
| `src/components/TerminalsView/hooks/useTerminalKeyboard.ts` (L48-50) | Handler active le toggle |

### Logique Broadcast (FONCTIONNEL mais JAMAIS APPELEE)

| Fichier | Role |
|---------|------|
| `src/components/TerminalsView/hooks/useMultiTerminal.ts` (L320-326) | `broadcastInput()` — itere tous les terminaux et appelle `agent_send_input` pour chacun |

### Backend Tauri (FONCTIONNEL)

| Fichier | Role |
|---------|------|
| `src-tauri/src/commands/agent.rs` | `agent_send_input(id, input)` — envoie a un PTY unique |

### Legacy Electron (MORT)

| Fichier | Role |
|---------|------|
| `electron/utils/broadcast.ts` | `broadcastToAllWindows()` — broadcast IPC vers toutes les fenetres Electron (pas le meme broadcast) |

## Bug critique

**Le callback `onBroadcastSubmit` n'est JAMAIS passe a `TerminalPanelInput`.**

La fonction `broadcastInput` existe dans `useMultiTerminal` et est retournee, mais elle n'est jamais connectee au prop `onBroadcastSubmit` du composant `TerminalPanelInput`.

Resultat : quand l'utilisateur active le broadcast mode et tape du texte, le code dans `TerminalPanelInput` (L30-31) :
```typescript
if (isBroadcasting && onBroadcastSubmit) {
  onBroadcastSubmit(trimmed + '\n');
}
```
...ne s'execute jamais car `onBroadcastSubmit` est `undefined`.

## Pour reparer

1. Dans le composant qui instancie `TerminalPanelInput`, passer `onBroadcastSubmit={multiTerminal.broadcastInput}`
2. Pas besoin de backend — `agent_send_input` fonctionne deja, le `broadcastInput` l'appelle en boucle sur tous les agents

## Decision requise

- **Reparer** : 1 ligne de wiring a ajouter
- **Supprimer** : retirer ~6 fichiers/sections de code
