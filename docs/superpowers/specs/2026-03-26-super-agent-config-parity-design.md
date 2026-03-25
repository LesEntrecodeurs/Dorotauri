# Design : Config Parity + Super Agent Unifié

**Date :** 2026-03-26
**Statut :** Approuvé

---

## Contexte

Trois problèmes interdépendants à résoudre :

1. **Parité de config** — Le ConfigWheel (Hub) ne propose pas Git Worktree ni le setup MCP Orchestrateur, contrairement à la NewChatModal.
2. **Flux Super Agent fragmenté** — Deux chemins de création divergents (bouton direct vs promotion ConfigWheel) qui aboutissent à des états incohérents (`isSuperAgent` parfois false, MCP pas injecté).
3. **OrchestratorModeToggle non branché** — Cocher "Orchestrator Mode" dans la modal ne crée pas réellement un Super Agent (`isSuperAgent` reste false).

**Approche retenue :** Backend d'abord (filtrage tabId, Git Worktree), puis UI (ConfigWheel étendu, suppression bouton direct, modal wiring).

---

## Décisions de design

| Sujet | Décision |
|---|---|
| Filtrage tab super agent | Réel (API `?tabId=xxx` + env var `DOROTORING_TAB_ID`) |
| Git Worktree dans ConfigWheel | Reconfigurable, appliqué au prochain restart |
| Flux de création Super Agent | Promotion uniquement — suppression des boutons directs |
| Layout ConfigWheel | Sections toujours visibles avec séparateurs visuels |
| Scope dans modal | Inline dans la card Orchestrator (tab/global) |

---

## Section 1 — Backend

### 1.1 Filtrage par tab (`api_server.rs`)

Ajouter un query param `tabId` sur `GET /api/agents` :

```
GET /api/agents?tabId=abc123  →  retourne uniquement les agents de ce tab
GET /api/agents               →  retourne tous les agents (comportement actuel)
```

Implémentation : lire `Query<HashMap<String, String>>` dans le handler, filtrer `agents.values()` par `agent.tab_id == tab_id`.

### 1.2 Injection env var dans le PTY (`commands/agent.rs`)

Quand `is_super_agent && super_agent_scope == "tab"`, écrire dans le PTY **avant** la commande claude :

```
export DOROTORING_TAB_ID={agent.tab_id}\n
```

Pour `scope == "all"`, ne pas écrire la variable (le MCP verra tous les agents).

**Attention :** cette injection doit être faite dans **deux endroits** :
- `agent_start` (nouveau démarrage)
- Le thread de relaunch dans `agent_promote_super` (le `/exit` + relaunch avec `--continue`)

### 1.3 MCP — filtrage dans `list_agents` (`mcp-orchestrator/src/tools/agents.ts`)

```typescript
const tabId = process.env.DOROTORING_TAB_ID;
const url = tabId ? `/api/agents?tabId=${tabId}` : '/api/agents';
const data = await apiRequest(url);
```

Même logique pour `create_agent` : si `DOROTORING_TAB_ID` est défini, passer `tabId` dans le body afin que le nouvel agent créé soit dans le même tab.

### 1.4 Git Worktree backend (`commands/agent.rs`)

`agent_update` accepte déjà `branchName` — vérifier qu'il est bien persisté.

Au `agent_start`, si `agent.branch_name` est défini :
1. Vérifier si le worktree existe déjà (`git worktree list` dans `agent.cwd`)
2. Si non : `git worktree add -b {branch} {worktree_path}` (path : `{cwd}/../{agent_id}-worktree`)
3. Spawner le PTY dans `worktree_path` plutôt que `cwd`
4. Stocker `worktree_path` sur l'agent

Si `branch_name` est effacé (mis à `""`), utiliser `cwd` normal au prochain restart.

---

## Section 2 — ConfigWheel étendu

Layout : sections toujours visibles, séparées par des dividers avec label uppercase.

```
┌─────────────────────────────┐
│ 🧙 Aethon              🎲  │  ← Nom + reroll
│ Role optionnel...           │
├── AUTONOMIE ────────────────┤
│ ☑ ⚡ Skip Permissions      │
├── GIT WORKTREE ─────────────┤
│ ☐ Activer                  │
│ [feature/branch-name      ] │  ← input, visible si activé
├── 👑 SUPER AGENT ───────────┤
│ [toggle ON]  👑 Tab  ✅ MCP│
│ [👑 Tab] [👑👑 Global]     │  ← scope buttons
└─────────────────────────────┘
```

**Section Git Worktree :**
- Checkbox "Activer"
- Si coché : input texte pour le nom de branche
- Label sous l'input : "Appliqué au prochain redémarrage"
- Appelle `agent_update` avec `{ branchName: value }` on blur/change

**Section Super Agent :**
- Toggle existant (`SuperAgentToggle`) — inchangé visuellement
- Intégrer le statut MCP inline (pas d'appel supplémentaire — utiliser le cache du module `OrchestratorModeToggle`)
- Si MCP non configuré : bouton "Setup" inline → appelle `orchestrator_setup` sans ouvrir de modal
- Scope tab/global affiché sous le toggle quand activé

**Fichier à modifier :** `src/components/ConfigWheel/index.tsx`
**Nouveaux sous-composants :** `ConfigWheelWorktree.tsx`, factoriser le statut MCP depuis `OrchestratorModeToggle.tsx`

---

## Section 3 — Suppression des boutons "Create Super Agent"

**Supprimer :**
- Bouton "Super Agent" dans `src/components/AgentList/AgentListHeader.tsx`
- Bouton "Super Agent" dans `src/components/CanvasView/components/CanvasToolbar.tsx` + `SuperAgentButton.tsx`
- Hook `src/hooks/useSuperAgent.ts` (plus utilisé après suppression des boutons)
- Références à `handleSuperAgentClick` dans `src/components/CanvasView/hooks/useAgentActions.ts`
- Prop `isCreatingSuperAgent` dans `AgentListHeader`

**Conserver :**
- `SuperAgentToggle.tsx` (utilisé dans ConfigWheel)
- `isSuperAgentCheck` dans constants.ts (utilisé pour le badging 👑)
- `agent_promote_super` côté Rust (c'est la voie canonique)

> **Note :** `src/routes/agents.tsx` utilise `useSuperAgent` — à nettoyer également (supprimer le hook et ses props dans ce fichier).

---

## Section 4 — NewChatModal OrchestratorModeToggle rewired

**`OrchestratorModeToggle.tsx` :**
- Ajouter prop `scope: 'tab' | 'all'` et `onScopeChange`
- Quand status === 'configured' ET isOrchestrator coché : afficher les boutons scope inline
- UI : deux boutons "👑 Tab" / "👑👑 Global" dans la card (layout A choisi)

**`NewChatModal/index.tsx` :**
- Ajouter state `orchestratorScope: 'tab' | 'all'` (default: `'tab'`)
- `handleOrchestratorToggle` existant : passer le scope à l'état
- `handleSubmit` : si `isOrchestrator`, passer `isSuperAgent: true` et `superAgentScope: orchestratorScope` à `onSubmit`

**`onSubmit` → `agent_create` :**
- Ajouter `superAgentScope` dans la config passée à `agent_create`
- Rust `agent_create` : stocker `super_agent_scope` (champ déjà présent dans le struct `Agent`)

**`useElectron.ts` `createAgent` config type :**
- Ajouter `superAgentScope?: 'tab' | 'all'`

---

## Fichiers impactés

| Fichier | Changement |
|---|---|
| `src-tauri/src/api_server.rs` | Query param `?tabId` sur GET /api/agents |
| `src-tauri/src/commands/agent.rs` | Inject `DOROTORING_TAB_ID` env var, Git Worktree au start |
| `mcp-orchestrator/src/tools/agents.ts` | Lire `DOROTORING_TAB_ID`, filtrer list_agents + create_agent |
| `src/components/ConfigWheel/index.tsx` | Sections Git Worktree + Super Agent étendues |
| `src/components/ConfigWheel/ConfigWheelWorktree.tsx` | Nouveau composant |
| `src/components/AgentList/AgentListHeader.tsx` | Supprimer bouton Super Agent |
| `src/components/CanvasView/components/CanvasToolbar.tsx` | Supprimer bouton Super Agent |
| `src/components/CanvasView/components/SuperAgentButton.tsx` | Supprimer |
| `src/components/CanvasView/hooks/useAgentActions.ts` | Supprimer handleSuperAgentClick |
| `src/hooks/useSuperAgent.ts` | Supprimer |
| `src/components/NewChatModal/OrchestratorModeToggle.tsx` | Ajouter scope inline |
| `src/components/NewChatModal/index.tsx` | Brancher isSuperAgent + scope sur submit |
| `src/hooks/useElectron.ts` | Ajouter `superAgentScope` dans createAgent config |

---

## Vérification end-to-end

1. **Tab Super Agent filtré :**
   - Créer 2 agents dans tab A, 1 agent dans tab B
   - Promouvoir un agent de tab A en Super Agent (scope tab)
   - Lui demander `list_agents` → doit voir seulement les 2 agents de tab A

2. **Global Super Agent :**
   - Promouvoir un agent en Super Agent (scope global)
   - `list_agents` → voit tous les agents de tous les tabs

3. **Git Worktree ConfigWheel :**
   - Sur un agent existant, activer Git Worktree + saisir une branche
   - Redémarrer l'agent → il démarre dans un nouveau worktree sur cette branche
   - Effacer la branche → au restart suivant, tourne dans `cwd` normal

4. **Création via modal :**
   - NewChatModal → cocher Orchestrator Mode → sélectionner scope "Tab"
   - Créer l'agent → vérifier `isSuperAgent: true` et `superAgentScope: 'tab'` dans l'état Rust
   - L'agent démarre avec `--mcp-config` + `--append-system-prompt-file` + `export DOROTORING_TAB_ID`

5. **Suppression boutons :**
   - Vérifier qu'aucun bouton "Create Super Agent" / "Super Agent" n'apparaît dans Hub toolbar ni Canvas toolbar
