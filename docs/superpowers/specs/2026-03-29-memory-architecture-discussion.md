# Memory Architecture — Discussion 2026-03-29

> Conversation entre Flavien et Claude sur la couche memoire structuree pour Dorotoring

---

## Point de depart

Flavien propose de construire une couche de memoire structuree cote Rust (rusqlite + embeddings) en s'appuyant sur l'event bus Tokio, plutot qu'ajouter une dependance externe Python/JS comme Mem0.

---

## Audit de l'existant

### Systemes de memoire actuels

| Systeme | Statut | Stockage | Recherche | MCP | Agents y ecrivent ? |
|---------|--------|----------|-----------|-----|---------------------|
| **Project Memory** (memory.rs) | Fonctionnel (delete manquant) | Fichiers .md natifs (~/.claude/projects/*/memory/) | Aucune | Non | Non (Claude Code ecrit directement ses fichiers) |
| **Vault** (vault.rs + db.rs) | Fonctionnel | SQLite vault.db (documents, folders, attachments) | FTS5 BM25 | Oui (mcp-vault) | Oui via mcp-vault |
| **Obsidian** (useObsidian.ts) | **Code mort** — backend inexistant | N/A | N/A | Non | Non |

### Event Bus Tokio (`agent/event_bus.rs`)

```
EventBus
├── global_tx: broadcast::Sender<AgentEvent>  (capacity: 256)
│   ├── Created { agent_id, parent_id, tab_id }
│   ├── StateChanged { agent_id, old, new }
│   ├── Removed { agent_id }
│   └── StatusLineUpdated { agent_id, line }
│
└── pty_channels: HashMap<AgentId, broadcast::Sender<Bytes>>  (capacity: 1024/agent)
    └── Raw PTY output bytes (stdout+stderr melange)
```

- **Producteurs :** AgentManager (lifecycle events), PTY reader thread (raw bytes)
- **Consommateurs :** Frontend (Tauri events + WebSocket), API server (long-poll)
- **Persistence :** Aucune — fire-and-forget, les events en broadcast sont perdus si personne n'ecoute

### Infrastructure reutilisable

| Composant | Fichier | Ce qu'on peut reutiliser |
|-----------|---------|--------------------------|
| **rusqlite** (bundled, WAL, FTS5) | `src-tauri/src/db.rs` | Meme connexion vault.db ou nouvelle DB dediee |
| **Axum API** (:31415) | `src-tauri/src/api_server.rs` | Ajouter des routes `/api/memories/*` et `/api/events/*` |
| **MCP server** (Node.js) | `mcp-orchestrator/src/tools/` | Ajouter outils `remember`, `recall`, `emit_event`, `tail_events` |
| **Broadcast channel** | `event_bus.rs` | Notifier les nouveaux events/memories en temps reel |
| **Hooks output** | `POST /api/hooks/output` | Point d'entree pour extraction automatique depuis sorties agents |
| **Agent model** | `agent/model.rs` | `agent_id`, `tab_id`, `project (cwd)` — metadata pour les memories |

### Bugs identifies

| Bug | Impact | Fichiers |
|-----|--------|----------|
| `memory_delete_file` — le frontend appelle une commande Tauri inexistante | Crash silencieux a la suppression | `src/hooks/useMemory.ts` → `memory.rs` (manquant) |
| `vault_attach_file` — le MCP server l'utilise mais pas de commande Tauri | Attachments non fonctionnels via MCP | `mcp-vault/src/tools/` → `vault.rs` (manquant) |

### Code mort a supprimer

| Composant | Fichiers |
|-----------|----------|
| Obsidian integration | `src/hooks/useObsidian.ts`, `src/components/ObsidianVaultView/`, champ `obsidianVaultPaths` dans Agent/Config |

### Documents de design existants

| Document | Statut | Recommandation |
|----------|--------|----------------|
| `docs/inter-agent-communication-study.md` | Draft, non valide | **H6 Event Log** — fondation pour la com inter-agents |
| `docs/superpowers/specs/2026-03-26-semantic-memory-design.md` | Draft, non valide | **Approche C Hybride** — rusqlite + sqlite-vec + ort (MiniLM) + Ollama optionnel |

---

## Pourquoi Rust natif > Mem0

| Critere | Mem0 (Python/JS) | Rust natif (rusqlite + embeddings) |
|---------|-------------------|-------------------------------------|
| **Dependencies** | npm `mem0ai` + Qdrant Docker OU Ollama | Zero externe (ort + sqlite-vec compilent dans le binaire) |
| **Offline** | Necessite LLM pour chaque `add()` | MiniLM embarque, fonctionne toujours |
| **Latence** | ~200ms (extraction LLM + embed + store) | <15ms (embed local + SQLite) |
| **Integration event bus** | Impossible directement | Subscriber Tokio → extraction → embed → store dans le meme process |
| **Architecture** | Process externe, bridge HTTP | Meme binaire Tauri, meme runtime tokio |
| **Maintenance** | Dependance tierce, breaking changes | Code interne, controle total |
| **Scalabilite memoire** | Illimitee (Qdrant) | <100K vecteurs (sqlite-vec brute-force KNN) — suffisant pour desktop |

**Verdict :** Mem0 est concu pour des apps cloud avec acces LLM permanent. Dorotoring est une app desktop qui doit fonctionner offline. Le Rust natif est objectivement superieur ici.

---

## Cas d'usage cibles (valides par Flavien)

### 1. Conscience mutuelle en temps reel

Quand 3 agents tournent en parallele sur le meme projet, chacun devrait savoir ce que les autres font *maintenant*. Pas juste les transitions d'etat, mais le contexte actif :
> "Agent A est en train de refactorer auth.rs, Agent B modifie les routes API, Agent C ecrit des tests"

C'est le role de l'event log + `tail_events` en long-poll. Un agent peut demander "qu'est-ce qui se passe autour de moi ?" avant de toucher un fichier que quelqu'un d'autre est en train de modifier.

### 2. Memoire des decisions non-ecrites

Flavien a change le design de l'application il y a 20 jours. C'est dans sa tete, peut-etre visible dans les commits, mais aucun agent ne le sait. Il ne va pas ecrire un markdown a chaque decision. Il faut un moyen leger de capturer ca.

**Le vrai besoin :** une memoire partagee qui capture les decisions et le contexte *sans friction* — pas un journal technique d'events lifecycle, mais une connaissance collective que n'importe quel agent peut interroger.

---

## Decision : extraction automatique (option B)

Flavien choisit l'extraction **automatique** des faits depuis les conversations/outputs d'agents. Pas d'outil explicite `remember()` comme mode principal.

### Pipeline d'extraction

```
Agent output (PTY brut)
    │
    ▼
POST /api/hooks/output          ← point d'interception existant
    │
    ▼
Accumulation (buffer par agent)
    │
    ▼ toutes les N lignes ou a la completion

LLM extraction  ← ❓ QUI fait ca ?
    │
    ▼
Faits structures → embed (MiniLM) → SQLite (memories + vec0)
```

### Options pour le LLM d'extraction

| Option | Comment | Cout | Offline |
|--------|---------|------|---------|
| **Anthropic API** (Haiku) | `reqwest` POST depuis Rust, ~100 tokens/extraction | ~$0.001/extraction | Non |
| **Ollama local** | Modele leger (qwen2.5:3b, phi3:mini) | Gratuit, ~2s/extraction | Oui |
| **L'agent lui-meme** | On injecte dans le system prompt : "a chaque decision significative, emets `[FACT: ...]`" | Gratuit, instantane | Oui |

La 3eme option est la plus legere — les agents SONT des LLMs, autant leur demander d'emettre les faits eux-memes au fil de l'eau plutot que de re-analyser leur output apres coup. Mais c'est moins fiable (l'agent peut oublier, chaque provider reagit differemment).

**Decision en attente :** choix du LLM d'extraction (ou mix des approches).

---

## Plan d'implementation propose

### Phase 1 — Event Log (fondation)

Table SQLite append-only, 3 routes REST, 3 outils MCP. Subscriber sur l'event bus Tokio.

```sql
CREATE TABLE events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    from_agent TEXT NOT NULL,
    to_agent   TEXT,
    event_type TEXT NOT NULL,
    payload    TEXT NOT NULL,
    tab_id     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Phase 2 — Memoire semantique (rusqlite + embeddings)

```toml
# Cargo.toml
ort = "2.0"                  # ONNX Runtime (MiniLM embarque, +25MB)
sqlite-vec = "0.1"           # Extension vectorielle SQLite
tokenizers = "0.21"          # Tokenizer HuggingFace
```

```sql
CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'auto',
    source_id TEXT,
    project_path TEXT,
    agent_id TEXT,
    tags TEXT DEFAULT '[]',
    embedding_dims INTEGER NOT NULL,
    confidence REAL DEFAULT 1.0,
    superseded_by TEXT REFERENCES memories(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE memories_vec USING vec0(
    memory_id TEXT PRIMARY KEY,
    embedding float[384]
);

CREATE VIRTUAL TABLE memories_fts USING fts5(content, tags);
```

Embedding adaptatif : Ollama nomic-embed-text (768d) si disponible, sinon MiniLM via ort (384d).
Recherche hybride : `score = α × cosine_similarity + (1-α) × bm25_score`

### Phase 3 — Extraction automatique

Connecter le hook output au pipeline d'extraction LLM → embed → store.
Injection de contexte au `delegate_task` via `recall(prompt)`.

### Phase 4 (future) — Mailbox + A2A

Couches de convenience au-dessus de l'event log.

---

## Fichiers cles

| Fichier | Role |
|---------|------|
| `src-tauri/src/agent/event_bus.rs` | Event bus Tokio — ajouter subscriber persistant |
| `src-tauri/src/db.rs` | Init SQLite vault.db — ajouter tables events + memories |
| `src-tauri/src/api_server.rs` | Axum API — ajouter routes /api/events/* et /api/memories/* |
| `src-tauri/src/commands/memory.rs` | Memory existant (fichiers .md) — a garder tel quel |
| `src-tauri/src/commands/vault.rs` | Vault existant — a garder, memories est une table separee |
| `mcp-orchestrator/src/tools/agents.ts` | Outils MCP agents — ajouter emit_event, tail_events |
| `mcp-vault/src/tools/` | Outils MCP vault — ajouter remember, recall, forget |
| `src-tauri/Cargo.toml` | Dependances — ajouter ort, sqlite-vec, tokenizers |
