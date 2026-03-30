# Dorotoring Knowledge Layer

## Probleme

**1. Gaspillage de tokens a l'exploration.** Chaque session d'un agent AI commence
par une phase d'exploration (Grep, Read, Glob en boucle) pour comprendre le codebase.
Sur un projet de 100k lignes, ca consomme 50-80k tokens avant de coder. Les outils
natifs des agents sont deja optimises individuellement — le probleme est le nombre
d'appels necessaires.

**2. Amnesie entre sessions et entre agents.** Les decisions prises il y a 3 semaines
sont perdues. Les tentatives echouees aussi. Quand 3 agents tournent en parallele,
aucun ne sait ce que les autres font. Il n'existe aucune memoire partagee.

## Solution

Une **knowledge.db par projet** qui unifie deux types de connaissances dans un seul
systeme de recherche :

- **Code Knowledge** — structure du codebase : symboles, references, repo map.
  Alimente automatiquement par tree-sitter. L'agent demarre informe.

- **Agent Knowledge** — historique des sessions, decisions, contexte.
  Alimente automatiquement par l'indexation des sessions Dorotoring et de la
  memoire native Claude Code. L'agent a une memoire long-terme.

Tout est automatique. Pas de `remember` explicite, pas de prompt special, pas d'UI.
L'utilisateur ne configure rien. Les agents sont plus intelligents et consomment
moins de tokens.

## Decisions Architecturales

| Decision | Choix | Justification |
|---|---|---|
| Stockage | Une `knowledge.db` SQLite par projet | Isolation propre, backup/suppression par projet |
| Recherche | FTS5 + embeddings (hybride) | FTS5 pour les mots exacts, embeddings pour le sens. Recherche hybride `a * cosine + (1-a) * bm25` |
| Embeddings | ort + MiniLM (384d) + sqlite-vec, actif des v1 | Necessaire pour les transcripts de sessions. +25MB binaire, ~15ms/embedding, offline |
| Embedding adaptatif | Ollama nomic-embed-text (768d) si disponible, MiniLM fallback | Meilleure qualite quand possible, fonctionne toujours sans |
| Index de recherche | Unifie code + agent knowledge | Un agent qui cherche "auth" trouve les symboles ET les decisions passees |
| Injection repo map | `--append-system-prompt` au spawn | System prompt jamais compresse, pas de pollution CLAUDE.md |
| Parsing | Rust natif (tree-sitter) | Performance critique, bindings Rust matures |
| MCP tools | Node.js via API HTTP Rust (:31415) | Coherent avec mcp-orchestrator, mcp-vault existants |
| Repo map | Par projet, partage entre agents | Simple, cache bien |
| Pas de `remember` | Les agents n'ecrivent pas dans la memoire | Tout est automatique : tree-sitter, sessions, indexation Claude Code memory |
| Pas d'UI | Infrastructure invisible | Les agents y accedent via MCP et system prompt |
| Retention sessions | 90 jours par defaut, configurable | Purge auto au demarrage. Sessions pinned exemptees |

---

## Knowledge DB (fondation)

### Schema

Une DB par projet : `~/.dorotoring/projects/{project-hash}/knowledge.db`
(`project-hash` = SHA-256 tronque a 12 chars du chemin absolu du projet)

#### Tables Code Knowledge

```sql
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  file TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,        -- function, class, interface, type, variable, method
  signature TEXT,
  line INTEGER NOT NULL,
  end_line INTEGER,
  exported BOOLEAN DEFAULT FALSE,
  rank REAL DEFAULT 0.0      -- PageRank score
);

CREATE TABLE references (
  from_file TEXT NOT NULL,
  from_symbol TEXT,
  to_symbol TEXT NOT NULL,
  to_file TEXT,
  line INTEGER
);
```

#### Tables Agent Knowledge

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  prompt TEXT,                -- ce qui a ete demande a l'agent
  status TEXT NOT NULL,       -- completed, failed, stopped
  files_modified TEXT,        -- JSON array des fichiers touches
  commits TEXT,               -- JSON array des messages de commit
  transcript TEXT,            -- clean output du PTY (lastCleanOutput)
  started_at TEXT NOT NULL,
  ended_at TEXT,
  pinned BOOLEAN DEFAULT FALSE
);

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent TEXT NOT NULL,
  to_agent TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  tab_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_events_agent ON events(from_agent, created_at);
CREATE INDEX idx_sessions_project ON sessions(started_at);
```

#### Index de recherche unifie

```sql
-- FTS5 : recherche par mots exacts sur tout le contenu
CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  content,       -- texte indexe (nom de symbole, transcript, memory content)
  source_type,   -- 'symbol', 'session', 'claude_memory'
  source_id,     -- ID dans la table source
  file           -- fichier associe (pour les symboles)
);

-- Embeddings : recherche par similarite semantique
CREATE VIRTUAL TABLE knowledge_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[384]
);
```

Quand un agent appelle `recall("auth migration")` :
1. Le texte est cherche en FTS5 (mots exacts) → scores BM25
2. Le texte est embede via MiniLM → recherche cosine dans knowledge_vec
3. Les resultats sont fusionnes : `score = a * cosine + (1-a) * bm25`
4. Les resultats viennent de toutes les sources : symboles, sessions, memories Claude Code

### Sources de donnees (toutes automatiques)

#### Source 1 : tree-sitter (Code Knowledge)

**Quand :** file watcher detecte un changement de fichier source.

**Quoi :** parse le fichier, extrait symboles + imports, met a jour `symbols` et
`references`, recalcule PageRank, regenere le repo map si les top-ranked changent.
Indexe les noms de symboles et signatures dans `knowledge_fts` et `knowledge_vec`.

**Langages :** TypeScript, JavaScript, Python, Rust, Go.

**Debounce :** 2 secondes.

#### Source 2 : Sessions Dorotoring (Agent Knowledge)

**Quand :** un agent termine sa session (status → completed/failed/stopped).

**Quoi :** Dorotoring capture automatiquement :
- Le prompt initial (ce qu'on a demande a l'agent)
- Le statut final
- Les fichiers modifies (via git diff ou file watcher)
- Les commits crees (messages)
- Le transcript propre (lastCleanOutput, deja disponible dans Dorotoring)

Stocke dans `sessions`. Le transcript et le prompt sont indexes dans
`knowledge_fts` et embedes dans `knowledge_vec`.

**Retention :** 90 jours par defaut. Sessions `pinned = true` exemptees.
Purge automatique au demarrage de Dorotoring.

#### Source 3 : Memoire native Claude Code (Agent Knowledge)

**Quand :** au demarrage de Dorotoring + file watcher sur `~/.claude/projects/*/memory/`.

**Quoi :** indexe les fichiers markdown de la memoire native Claude Code dans
`knowledge_fts` et `knowledge_vec`. Lecture seule — Dorotoring ne modifie jamais
ces fichiers.

Claude Code ecrit ses memories (decisions, preferences, contexte projet) dans ces
fichiers via son auto-memory. Dorotoring les rend accessibles a tous les agents
(y compris Codex, Gemini) via `recall`.

**Mise a jour :** file watcher sur le repertoire memory. Re-indexation quand un
fichier est modifie ou ajoute.

---

## Rust Backend

### Modules

```
src-tauri/src/
  knowledge/
    mod.rs              → Re-exports, init
    db.rs               → Schema, migrations, connexion knowledge.db
    tree_sitter.rs      → Parser multi-langage, extraction symboles/imports
    reference_graph.rs  → Construction du graphe + PageRank
    repo_map.rs         → Generation du repo map markdown budget-aware
    file_watcher.rs     → notify crate, debounce, re-index incremental
    session_capture.rs  → Capture auto des sessions a completion
    claude_memory.rs    → Indexation des fichiers ~/.claude/projects/*/memory/
    search.rs           → Recherche hybride FTS5 + embeddings
  embedding/
    mod.rs              → EmbeddingEngine (MiniLM / Ollama adaptatif)
```

### Embedding Engine

```toml
# Cargo.toml
ort = "2.0"              # ONNX Runtime (+25MB binaire)
sqlite-vec = "0.1"       # Extension vectorielle SQLite
tokenizers = "0.21"      # Tokenizer HuggingFace
```

**Strategie adaptative :**
- Detecte Ollama au demarrage → utilise `nomic-embed-text` (768d) si disponible
- Sinon → MiniLM via ort (384d), embarque dans le binaire, fonctionne offline

La dimension des vecteurs est stockee dans la DB (`embedding_dims`). Si l'utilisateur
installe Ollama apres la premiere indexation, les anciens embeddings 384d coexistent
avec les nouveaux 768d — la recherche normalise par dimension.

### tree-sitter Parser

Langages supportes via crates Rust :

```toml
tree-sitter = "0.24"
tree-sitter-typescript = "0.23"
tree-sitter-javascript = "0.23"
tree-sitter-python = "0.23"
tree-sitter-rust = "0.23"
tree-sitter-go = "0.23"
```

Pour chaque fichier, extrait :
- Fonctions/methodes : nom, signature, ligne debut/fin, exporte
- Classes/structs : nom, methodes publiques
- Interfaces/types : nom, definition
- Imports/exports : source, symboles importes

**Limitations v1 :** imports dynamiques (`import()`), re-exports complexes, et
references par usage sans import explicite ne sont pas resolus. Le repo map et
le file outline fonctionnent correctement malgre un reference graph incomplet.

### Reference Graph + PageRank

Construit a partir des imports/exports. Pour chaque `import { X } from './module'`,
une entree dans `references` lie le fichier importeur au symbole dans le fichier source.

PageRank sur ce graphe → les symboles les plus references en premier dans le repo map.
Score stocke dans `symbols.rank`.

### File Watcher

Crate `notify`. Sur modification d'un fichier source :
1. Re-parse via tree-sitter (ce fichier uniquement)
2. Mise a jour `symbols`, `references`, `knowledge_fts`, `knowledge_vec`
3. Recalcul PageRank si les top-10 changent
4. Regeneration du repo map si necessaire

Debounce 2 secondes.

### Endpoints API (Axum, :31415)

Auth par bearer token (`~/.dorotoring/api-token`), comme les endpoints existants.

```
# Code Intelligence
GET  /api/code/repo-map?project={path}&budget={tokens}
GET  /api/code/outline?file={path}
GET  /api/code/references?symbol={name}&project={path}

# Knowledge Search (unifie)
GET  /api/knowledge/search?query={text}&project={path}&type={symbol|session|claude_memory|all}&max_results={n}

# Sessions
POST /api/sessions                    ← appele automatiquement par Dorotoring a la fin de chaque session agent
GET  /api/sessions?project={path}&limit={n}
PUT  /api/sessions/{id}/pin

# Events (temps reel inter-agents)
POST /api/events
GET  /api/events?since={seq}&agent={id}&tab={id}&limit={n}  ← long-poll
```

---

## Repo Map

### Generation

Le repo map est genere a partir des symboles indexes dans knowledge.db, tries par
PageRank, tronques au budget token configure.

### Format

```markdown
# Dorotoring Code Map (auto-generated)
# Project: /home/user/my-project | Updated: 2026-03-29T14:32:00Z

## Structure
src/
  api/       → REST endpoints (Express)
  services/  → Business logic
  models/    → Types & Prisma schema
  middleware/→ Auth, rate-limit

## Key Symbols

### src/api/routes.ts (347 lines)
  export setupRoutes(app: Express): void             [L5]
  handleAuth(req, res): Promise<void>                [L23]
  export authMiddleware: RequestHandler               [L120]

### src/services/user.ts (234 lines)
  export class UserService
    findById(id: string): Promise<User>              [L12]
    authenticate(email, pwd): Promise<JWT>           [L45]
    createSession(userId: string): Session           [L89]

### src/models/user.ts (56 lines)
  export interface User { id, email, role, createdAt }  [L3]
  export type UserRole = 'admin' | 'editor' | 'viewer' [L15]
```

Texte simple, pas de JSON. Les numeros de ligne entre crochets permettent a l'agent
de faire `Read(path, offset=23, limit=43)` directement.

### Injection au spawn

Dorotoring injecte le repo map dans le system prompt de l'agent au lancement :

| Agent | Mecanisme |
|---|---|
| Claude Code | `--append-system-prompt "$(cat repo-map.md)"` |
| Codex CLI | Flag d'instructions equivalent (a verifier a l'implementation) |
| Gemini CLI | Flag de contexte equivalent (a verifier a l'implementation) |
| OpenCode | Flag configurable dans les settings Dorotoring |

Stockage du fichier genere : `~/.dorotoring/projects/{project-hash}/repo-map.md`

### Mise a jour

Le file watcher re-parse les fichiers modifies. Le repo map n'est regenere que si
un symbole du top-ranked change. Parse initial sur 100k lignes : < 2 secondes.

---

## MCP Tools

### Serveur `mcp-code-intelligence` (nouveau, Node.js)

```
mcp-code-intelligence/
  src/
    index.ts
    tools/
      repo-map.ts      → dorotoring_repo_map
      outline.ts       → dorotoring_file_outline
      symbols.ts       → dorotoring_symbol_lookup
      search.ts        → dorotoring_recall
    utils/
      api.ts           → Client HTTP vers Rust API (:31415)
```

Enregistrement dans `~/.claude/mcp.json` :
```json
{
  "mcpServers": {
    "dorotoring-code-intel": {
      "command": "node",
      "args": ["~/.dorotoring/mcp-code-intelligence/dist/bundle.js"],
      "env": {
        "DOROTORING_API_URL": "http://127.0.0.1:31415",
        "DOROTORING_API_TOKEN": "..."
      }
    }
  }
}
```

### Outils

#### `dorotoring_repo_map`

Carte structurelle du projet. Pour refresh ou agents lances hors Dorotoring.

```
Input:  { project?: string, budget?: number }
Output: { map: string, symbols_count: number, files_count: number }
```

#### `dorotoring_file_outline`

Squelette d'un fichier : signatures, sans le corps du code.

```
Input:  { path: string }
Output: {
  path: string,
  lines: number,
  language: string,
  symbols: [{ kind, name, signature?, line, end_line?, exported }]
}
```

Gain : ~150 tokens au lieu de ~2000 pour un Read complet. **-90%.**

#### `dorotoring_symbol_lookup`

Jump-to-definition et find-references.

```
Input:  { symbol: string, action: "definition" | "references", project?: string }
Output: {
  definition?: { file, line, kind, signature? },
  references?: [{ file, line, context }]
}
```

Gain : 1 appel au lieu de Grep → Read → Grep → Read. **-95%.**

#### `dorotoring_recall`

Recherche unifiee dans toute la knowledge.db : symboles, sessions passees, memories
Claude Code. Recherche hybride FTS5 + embeddings.

```
Input:  { query: string, project?: string, type?: "all" | "symbol" | "session" | "claude_memory", max_results?: number }
Output: {
  results: [{
    source_type: string,     -- symbol, session, claude_memory
    content: string,         -- nom/signature du symbole, resume de session, texte de memory
    file?: string,           -- pour les symboles
    line?: number,           -- pour les symboles
    session_id?: string,     -- pour les sessions
    relevance: number        -- score hybride
  }]
}
```

### Outils dans `mcp-orchestrator` (existant)

#### `tail_events`

Conscience temps reel entre agents. Long-poll.

```
Input:  { since_seq?: number, agent_id?: string, tab_id?: string, timeout?: number }
Output: { events: [{ seq, from_agent, event_type, payload, created_at }] }
```

---

## Configuration

Nouveaux champs dans `~/.dorotoring/app-settings.json` :

| Setting | Type | Default | Description |
|---|---|---|---|
| Knowledge Layer | Toggle | ON | Active/desactive toute la feature |
| Repo Map Budget | Slider (512-8192) | 2048 | Budget token du repo map |
| Languages | Checkboxes | Auto-detect | Langages a indexer (tree-sitter) |
| Re-index Trigger | Select | on-save | Quand re-indexer : on-save, on-commit, manual |
| Session Retention | Number (jours) | 90 | Duree de retention des sessions |

Pas d'UI dediee pour la knowledge layer. Les settings sont dans le panneau Settings
existant, section "Knowledge".

---

## Hors Scope

- Extraction automatique LLM depuis les outputs agents (v2)
- Outil `remember` explicite (v2, si necessaire)
- Hooks Claude Code (PreToolUse/PostToolUse) — feature separee
- Shell aliases (rg, fd, eza, bat) — feature separee
- Recherche structurelle via ast-grep — future phase
- Langages au-dela de TS/JS/Python/Rust/Go — extensible
- Mailbox agent-to-agent — future phase sur l'event log
- Interface UI pour la memoire — invisible

## Risques et Mitigations

| Risque | Mitigation |
|---|---|
| Parse lente sur gros monorepo (>500k lignes) | Parse async, progress bar, limite de profondeur configurable |
| Reference graph incomplet (imports dynamiques) | Limitations v1 acceptees. Repo map et outline marchent sans graph complet |
| Flag `--append-system-prompt` absent pour un agent | Fallback : une ligne dans CLAUDE.md pointant vers le repo-map |
| Repo map stale | File watcher + regen sur changement top-ranked. Fallback : MCP `dorotoring_repo_map` |
| Budget token insuffisant pour gros projet | Configurable. PageRank garantit les plus importants inclus |
| Transcripts de session volumineux | Retention 90j + purge auto. Pin pour les sessions critiques |
| MiniLM moins bon sur le code que sur le texte | Recherche hybride FTS5 + embeddings. FTS5 compense sur les noms de symboles |
| Ollama installe apres premiere indexation | Coexistence 384d/768d. Normalisation par dimension a la recherche |
