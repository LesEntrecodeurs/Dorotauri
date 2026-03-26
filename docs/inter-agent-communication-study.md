# Communication Inter-Agents — Etude de faisabilite

> Date : 2026-03-26
> Auteur : Claude (session de recherche)
> Statut : **A valider** — document de reflexion, aucune implementation

---

## Table des matieres

1. [Probleme actuel](#1-probleme-actuel)
2. [Etat de l'art — frameworks et protocoles existants](#2-etat-de-lart)
3. [Hypotheses d'architecture](#3-hypotheses)
   - H1 : Mailbox (hub-and-spoke ameliore)
   - H2 : Bus pub/sub par topics
   - H3 : Protocole A2A (Google)
   - H4 : Framework externe (Mastra, LangGraph, CrewAI)
   - H5 : Peer-to-peer MCP
   - H6 : Event Log partage (append-only)
4. [Comparatif](#4-comparatif)
5. [Recommandation](#5-recommandation)

---

## 1. Probleme actuel

### Architecture en place

```
Super Agent (Claude Code PTY)
    |  stdio (MCP)
MCP Orchestrator (Node.js)
    |  HTTP REST
API Dorotoring (Rust/Axum :31415)
    |  spawn PTY
Sub-Agent A        Sub-Agent B        Sub-Agent C
```

### Limitations

| Limitation | Impact |
|---|---|
| Communication **hub-and-spoke uniquement** | Le Super Agent est un goulet d'etranglement — tout passe par lui |
| Pas de communication **peer-to-peer** | Agent A ne peut pas demander directement a Agent B |
| Sortie limitee a `lastCleanOutput` | Un seul champ texte, pas de messages structures |
| Pas d'historique de conversation | Delegation fire-and-forget, pas de contexte partage |
| Observabilite faible | L'utilisateur ne voit pas le flux de communication inter-agents |
| Pas de patterns async | Impossible pour un agent de "s'abonner" a des evenements d'autres agents |

---

## 2. Etat de l'art

### 2.1 Google A2A (Agent-to-Agent Protocol)

- **Nature** : Protocole ouvert (Linux Foundation, 150+ organisations, v0.3)
- **Transport** : JSON-RPC 2.0 sur HTTP, SSE pour le streaming
- **Concepts cles** :
  - **Agent Card** : manifeste JSON decrivant les capacites d'un agent, servi a `/.well-known/agent.json`
  - **Task lifecycle** : submitted -> working -> input-required -> completed/failed/canceled
  - **Artifacts** : sorties structurees (fichiers, donnees) attachees aux taches
  - **Streaming** : SSE via `tasks/sendSubscribe` pour suivre la progression en temps reel
- **Auth** : OAuth2, mTLS, API keys
- **Adapte a Dorotoring ?** : Conceptuellement excellent (taches, streaming, discovery). Mais concu pour des agents HTTP natifs, pas des processus CLI/PTY. Necessite une couche d'adaptation. Bon candidat pour le mode headless futur et l'interoperabilite externe.

### 2.2 Mastra.ai

- **Nature** : Framework TypeScript pour agents IA
- **Communication** : Agent Network avec routage dynamique, workflows (state machines)
- **Observabilite** : Dashboard integre, tracing
- **Adapte a Dorotoring ?** : **Non directement.** Les agents Mastra sont des appels API LLM in-process, pas des processus CLI. L'impedance avec des PTY Claude Code est trop forte. Les patterns de workflow (DAG, state machines) sont interessants conceptuellement mais ne justifient pas la dependance.

### 2.3 Autres frameworks

| Framework | Modele de communication | Compatible PTY ? | Interet pour Dorotoring |
|---|---|---|---|
| **OpenAI Agents SDK** | Handoffs sequentiels | Non (in-process, OpenAI-only) | Pattern de handoff interessant |
| **LangGraph** | Graphe d'etat partage | Non (in-process) | Checkpointing, time-travel debugging |
| **AutoGen (Microsoft)** | Messages async, gRPC | Partiellement (runtime distribue) | Le plus proche d'agents externes |
| **CrewAI** | Hub-and-spoke hierarchique | Non (Python in-process) | Support MCP + A2A natif |
| **Commander (Autohand)** | CLI wrapping, worktrees | Oui (meme probleme) | Concurrent direct, meme approche |

### 2.4 Conclusion de l'etat de l'art

**Aucun framework existant ne gere nativement des agents CLI/PTY.** L'architecture de Dorotoring (PTY -> HTTP API -> MCP) est la bonne approche et correspond a ce que font les outils comparables (Commander). La strategie optimale est de :

1. **Garder le bridge PTY -> HTTP -> MCP** pour l'orchestration interne
2. **Emprunter des patterns** : lifecycle A2A, checkpointing LangGraph, delegation CrewAI
3. **Considerer A2A comme couche d'interoperabilite future** (mode headless)

---

## 3. Hypotheses

### H1 — Mailbox (hub-and-spoke ameliore)

**Principe** : Chaque agent recoit une boite aux lettres nommee. Les agents envoient/lisent des messages via des outils MCP (`send_mail`, `read_mail`). Le Super Agent reste coordinateur mais les sub-agents peuvent se laisser des messages.

```
                        Dorotoring API
                    ┌─────────────────────┐
                    │   Mailbox Store     │
                    │   (SQLite)          │
                    │                     │
                    │  agent-A/inbox ──── messages
                    │  agent-B/inbox ──── messages
                    │  broadcast/all ──── messages
                    └────────┬────────────┘
                             |
              ┌──────────────┼──────────────┐
              |              |              |
        Super Agent     Agent A        Agent B
        MCP: send/read  MCP: send/read MCP: send/read
```

| Critere | Evaluation |
|---|---|
| Complexite | **Basse-Moyenne** — 3 endpoints REST, 3 outils MCP, 1 table SQLite |
| Migration | **Faible risque** — purement additif, `delegate_task` inchange |
| Peer-to-peer | Indirect (via mailbox, pas de connexion directe) |
| Observabilite | Bonne — chaque message est stocke avec expediteur/destinataire/timestamp |
| Fiabilite | Bonne — SQLite WAL, messages persistants, long-poll existant |
| Patterns | Request/reply via mailbox, fire-and-forget |

**Points forts** : Simple, incremental, reutilise le broadcast channel existant.
**Points faibles** : Pas de pub/sub par topics, chaque agent doit connaitre le nom du destinataire.

---

### H2 — Bus pub/sub par topics

**Principe** : Bus de messages central avec des topics nommes. Les agents publient sur des topics et s'abonnent a ceux qui les interessent. Plus flexible que les mailboxes car un agent peut ecouter plusieurs topics sans connaitre les expediteurs.

```
                    Dorotoring API
                ┌───────────────────────┐
                │      Topic Bus        │
                │                       │
                │  "tasks"     → [...]  │
                │  "results"   → [...]  │
                │  "review"    → [...]  │
                │  "agent:A"   → [...]  │   ← topic dedie = mailbox
                │  "broadcast" → [...]  │
                │                       │
                │  Subscriptions:       │
                │  A → [tasks, review]  │
                │  B → [tasks, results] │
                └───────────┬───────────┘
                            |
         ┌──────────────────┼──────────────────┐
         |                  |                  |
   Super Agent         Agent A            Agent B
   pub/sub             pub/sub             pub/sub
```

| Critere | Evaluation |
|---|---|
| Complexite | **Moyenne** — gestion des subscriptions, lifecycle, cleanup |
| Migration | **Faible risque** — additif |
| Peer-to-peer | Oui (via topics, decouple) |
| Observabilite | Bonne — chaque message sur un topic est tracable |
| Fiabilite | Bonne — curseurs par subscriber, messages ordonnees par topic |
| Patterns | Pub/sub, broadcast, request/reply (via topic dedie) |

**Points forts** : Decouplage total, un agent peut ecouter sans savoir qui publie.
**Points faibles** : Plus de surface API, gestion du lifecycle des subscriptions (cleanup quand un agent meurt).

---

### H3 — Protocole A2A (Google)

**Principe** : Implementer le protocole Agent-to-Agent de Google. Chaque agent obtient une Agent Card, les interactions suivent le cycle de vie Task (submitted -> working -> completed). Dorotoring agit comme gateway A2A.

```
              Dorotoring A2A Gateway (:31415)
         ┌───────────────────────────────────┐
         │  Agent Registry    Task Manager   │
         │  ┌─────────┐     ┌────────────┐  │
         │  │ A: card  │     │ task-001   │  │
         │  │ B: card  │     │  A → B     │  │
         │  │ S: card  │     │  working   │  │
         │  └─────────┘     └────────────┘  │
         │                                   │
         │  /.well-known/agent.json          │
         │  POST /a2a/tasks/send             │
         │  POST /a2a/tasks/sendSubscribe    │  ← SSE streaming
         │  GET  /a2a/tasks/{id}             │
         └───────────────┬───────────────────┘
                         |
          ┌──────────────┼──────────────┐
          |              |              |
    Super Agent     Agent A        Agent B
    MCP: a2a_*      MCP: a2a_*     MCP: a2a_*
```

| Critere | Evaluation |
|---|---|
| Complexite | **Haute** — spec complete (Agent Cards, Task lifecycle, Artifacts, SSE, auth) |
| Migration | **Risque moyen** — nouvelle couche API, mapping ProcessState ↔ TaskState |
| Peer-to-peer | Oui (via Tasks) |
| Observabilite | Excellente — Agent Cards riches, task lifecycle explicite, artifacts structures |
| Fiabilite | Excellente — lifecycle formel, cancellation, idempotence |
| Patterns | Task-based (sync et streaming), discovery, federation |

**Points forts** : Standard ouvert, interoperabilite future, agents externes, mode headless.
**Points faibles** : Suringenierie pour un usage local, overhead important, mapping PTY complexe.

**Ideal pour** : le mode headless futur et l'exposition d'agents a des systemes externes.

---

### H4 — Framework externe (Mastra, LangGraph, CrewAI)

**Principe** : Integrer un framework d'orchestration multi-agents existant qui gere la communication, la coordination et les workflows.

```
              Dorotoring
         ┌──────────────────────────┐
         │   Framework Runtime      │
         │   (Mastra / LangGraph)   │
         │                          │
         │   Workflow DAG:          │
         │   Step1(A) → Step2(B)    │
         │                          │
         │   ┌─── PTY Adapter ───┐  │
         │   │ framework agent   │  │
         │   │    ↕ adapter      │  │
         │   │ Claude Code PTY   │  │
         │   └───────────────────┘  │
         └──────────────────────────┘

    Probleme : impedance framework ≠ PTY
```

| Critere | Evaluation |
|---|---|
| Complexite | **Tres haute** — dependance massive, adapter PTY, double etat |
| Migration | **Haut risque** — disruptif, remplace ou wrappe le MCP orchestrator |
| Peer-to-peer | Oui (intra-framework) |
| Observabilite | Variable (dashboards framework propres, conflit avec UI Dorotoring) |
| Fiabilite | Variable (adapter PTY = maillon faible, retry ≠ PTY) |
| Patterns | Workflows DAG, state machines, handoffs |

**Points forts** : Patterns de workflow puissants, ecosysteme existant.
**Points faibles** : **Impedance fondamentale** — les frameworks gerent des appels API, pas des PTY. L'adapter serait une reimplementation du MCP orchestrator. **Non recommande.**

---

### H5 — Peer-to-peer MCP (chaque agent = serveur MCP)

**Principe** : Donner a chaque agent son propre serveur MCP avec des outils de communication peer. Les agents se decouvrent via un registre et communiquent directement.

```
    Dorotoring (registre uniquement)
         |  discovery
    ┌────┼────────────┐
    |    |            |
  Agent A ◄──MCP──► Agent B
  :32001              :32002
    ▲                    ▲
    └──────MCP───────────┘
```

| Critere | Evaluation |
|---|---|
| Complexite | **Tres haute** — Claude Code = MCP stdio only, pas de transport HTTP dynamique |
| Migration | **Haut risque** — changement fondamental du lancement de chaque agent |
| Peer-to-peer | Oui (direct) |
| Observabilite | Mauvaise — sans routage central, chaque noeud doit rapporter ses echanges |
| Fiabilite | Fragile — perte de messages si un peer est down, pas d'ordering |
| Patterns | Direct messaging, discovery |

**Bloqueur technique** : Claude Code ne supporte que le transport MCP stdio. On ne peut pas ajouter dynamiquement des serveurs MCP a un agent en cours d'execution. Le `--mcp-config` est fixe au lancement. **Non faisable en l'etat.**

---

### H6 — Event Log partage (append-only)

**Principe** : Un journal d'evenements partage, append-only, auquel tous les agents ecrivent et lisent. Chaque agent ecrit des evenements (messages, resultats, requetes) et lit depuis un curseur. Le long-poll existant notifie les nouveaux evenements.

```
                  Dorotoring API
             ┌────────────────────────────┐
             │   Event Log (SQLite)       │
             │                            │
             │  #1  [super] → A: "do X"   │
             │  #2  [A] → super: "started" │
             │  #3  [A] → B: "need schema"│
             │  #4  [B] → A: "here it is" │
             │  #5  [A] → super: "done"   │
             │                            │
             │  cursor[A] = #4            │
             │  cursor[B] = #5            │
             │                            │
             │  POST /api/events/append   │
             │  GET  /api/events/tail     │  ← long-poll
             │  GET  /api/events/history  │
             └────────────┬───────────────┘
                          |
           ┌──────────────┼──────────────┐
           |              |              |
     Super Agent     Agent A        Agent B
     MCP: emit/tail  MCP: emit/tail MCP: emit/tail
```

| Critere | Evaluation |
|---|---|
| Complexite | **Basse** — 3 endpoints, 3 outils MCP, 1 table SQLite |
| Migration | **Tres faible risque** — purement additif |
| Peer-to-peer | Indirect (via le log, mais n'importe quel agent peut ecrire a n'importe quel autre) |
| Observabilite | **Excellente** — chaque message est dans le log avec seq/timestamp/from/to |
| Fiabilite | **Excellente** — SQLite WAL, append-only, curseurs persistants, ordering global |
| Patterns | Sync (emit + tail long-poll), async (emit et lire plus tard), broadcast |

**Points forts** :
- Complexite minimale, reutilise tous les patterns existants (hooks, broadcast, SQLite, MCP)
- Meilleure observabilite : timeline complete, ordonnee, auditable, rejouable
- Les mailboxes deviennent des vues filtrees (`to_agent = X`)
- Les topics deviennent des filtres sur `event_type`
- Fondation naturelle pour evoluer vers H1, H2 ou H3 plus tard

**Points faibles** : Pas de standard externe (contrairement a A2A), tous les messages passent par le serveur central.

---

## 4. Comparatif

| Critere | H1 Mailbox | H2 Pub/Sub | H3 A2A | H4 Framework | H5 P2P MCP | H6 Event Log |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Complexite impl. | Basse-Moy | Moyenne | Haute | Tres haute | Tres haute | **Basse** |
| Risque migration | Faible | Faible | Moyen | Haut | Haut | **Tres faible** |
| Peer-to-peer | Indirect | Oui | Oui | Oui | Oui | Indirect |
| Observabilite | Bonne | Bonne | Excellente | Variable | Mauvaise | **Excellente** |
| Fiabilite | Bonne | Bonne | Excellente | Variable | Fragile | **Excellente** |
| Compatibilite PTY | Native | Native | Adapter | Adapter | Non faisable | **Native** |
| Standard ouvert | Non | Non | **Oui** | Variable | Non | Non |
| Mode headless futur | Moyen | Bon | **Excellent** | Bon | Mauvais | Bon |
| Fit avec l'existant | Excellent | Bon | Moyen | Mauvais | Mauvais | **Excellent** |

---

## 5. Recommandation

### Approche par phases

```
Phase 1 (maintenant)          Phase 2 (court terme)         Phase 3 (headless)
─────────────────────         ────────────────────          ──────────────────
H6 : Event Log                H1 : Mailbox                  H3 : A2A Gateway
                              (vue filtree du log)           (facade sur le log)

3 endpoints REST              Convenience API                Standard ouvert
3 outils MCP                  sur le Event Log               Interoperabilite
1 table SQLite                                               Agents externes
```

### Phase 1 — Event Log (H6)

**Pourquoi commencer par la** :
1. Complexite minimale, risque minimal
2. Meilleure observabilite de toutes les options
3. Construit sur chaque pattern existant (hooks, broadcast channel, SQLite, MCP over HTTP)
4. **Fondation naturelle** pour les phases suivantes : les mailboxes et les topics ne sont que des vues filtrees du log

**Implementation** :
- Table SQLite : `events(seq INTEGER PRIMARY KEY, from_agent TEXT, to_agent TEXT, event_type TEXT, payload TEXT, timestamp TEXT)`
- REST : `POST /api/events/append`, `GET /api/events/tail?after=N&for=agentId` (long-poll), `GET /api/events/history`
- MCP : `emit_event(to, type, payload)`, `tail_events(since_seq)`, `get_event_history(filter)`
- UI : Timeline des evenements, overlay sur le CanvasView

**Fichiers a modifier** :
- `src-tauri/src/api_server.rs` — nouveaux endpoints
- `mcp-orchestrator/src/tools/agents.ts` — nouveaux outils MCP
- `src-tauri/src/db.rs` ou nouveau module — table events SQLite

### Phase 2 — Mailbox comme convenience (H1 sur H6)

Les mailboxes deviennent une abstraction au-dessus du log :
- `send_mail(to, message)` = `emit_event(to, "mail", message)`
- `read_mail()` = `tail_events(for=self, type="mail")`
- L'utilisateur voit les mails ET le log complet

### Phase 3 — A2A Gateway (H3 sur H6)

Pour le mode headless et l'interoperabilite :
- Agent Cards generes depuis les metadonnees existantes
- `tasks/send` traduit en evenements dans le log
- SSE streaming mappe sur le tail long-poll
- Agents externes peuvent rejoindre via le protocole standard

---

## Annexe : Schema de la table events

```sql
CREATE TABLE events (
    seq       INTEGER PRIMARY KEY AUTOINCREMENT,
    from_agent TEXT NOT NULL,
    to_agent   TEXT,              -- NULL = broadcast
    event_type TEXT NOT NULL,     -- "message", "status", "result", "request", "mail"
    payload    TEXT NOT NULL,     -- JSON
    tab_id     TEXT,              -- pour le filtrage par tab (scope Super Agent)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_by    TEXT DEFAULT '[]'  -- JSON array des agents ayant lu
);

CREATE INDEX idx_events_to ON events(to_agent, seq);
CREATE INDEX idx_events_type ON events(event_type, seq);
CREATE INDEX idx_events_tab ON events(tab_id, seq);
```

## Annexe : Outils MCP proposes

```typescript
// emit_event — Ecrire un evenement dans le log
server.tool("emit_event", {
  to: z.string().optional(),      // agent destinataire (omit = broadcast)
  type: z.string(),                // type d'evenement
  payload: z.string(),             // contenu (JSON ou texte libre)
}, async ({ to, type, payload }) => {
  return apiRequest("POST", "/api/events/append", { to, type, payload });
});

// tail_events — Lire les nouveaux evenements (long-poll)
server.tool("tail_events", {
  since: z.number().optional(),    // sequence number (curseur)
  timeout: z.number().default(30), // timeout en secondes
}, async ({ since, timeout }) => {
  return apiRequest("GET", `/api/events/tail?after=${since}&timeout=${timeout}`);
});

// get_event_history — Consulter l'historique
server.tool("get_event_history", {
  from: z.string().optional(),     // filtrer par expediteur
  to: z.string().optional(),       // filtrer par destinataire
  type: z.string().optional(),     // filtrer par type
  limit: z.number().default(50),   // nombre max
}, async (params) => {
  const qs = new URLSearchParams(params).toString();
  return apiRequest("GET", `/api/events/history?${qs}`);
});
```

## Annexe : Mapping des etats pour A2A (Phase 3)

| ProcessState Dorotoring | TaskState A2A |
|---|---|
| Inactive | — (pas de task) |
| Running | working |
| Waiting | input-required |
| Completed | completed |
| Error | failed |
| Dormant | canceled |
