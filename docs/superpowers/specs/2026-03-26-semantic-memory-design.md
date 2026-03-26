# Semantic Memory for Dorotoring — Design Document

**Date:** 2026-03-26
**Status:** Draft — en attente de validation

---

## Table des matières

1. [Contexte et motivation](#1-contexte-et-motivation)
2. [Audit de l'existant](#2-audit-de-lexistant)
3. [Ce qui reste, ce qui part](#3-ce-qui-reste-ce-qui-part)
4. [Etat de l'art](#4-etat-de-lart)
5. [Approches proposées](#5-approches-proposees)
6. [Recommandation](#6-recommandation)
7. [Annexes](#7-annexes)

---

## 1. Contexte et motivation

Dorotoring orchestre 10+ agents IA en parallèle (Claude Code, Codex, Gemini) sur des projets différents. Aujourd'hui, chaque agent est **amnésique entre sessions** : quand un agent reprend une tâche le lendemain, le dev doit ré-expliquer le contexte. Quand l'agent A découvre un bug critique, l'agent B sur le même projet ne le sait pas.

### Problèmes concrets

| Problème | Impact |
|---|---|
| Agent reprend une tâche = contexte perdu | Le dev perd 5-10 min à ré-expliquer |
| Multi-agent sans mémoire partagée | Travail dupliqué, décisions contradictoires |
| Recherche Vault = mots-clés seulement | "authentification" ne trouve pas "login" / "OAuth" |
| Memory files = browsing manuel | L'agent ne sait pas quel fichier est pertinent pour sa tâche |
| Pas de continuité sémantique | Les patterns découverts par un agent se perdent |

### Objectif

Donner aux agents une **mémoire sémantique persistante** qui :
- Extrait automatiquement les faits saillants des conversations
- Retrouve le contexte pertinent par similitude de sens (pas juste par mots-clés)
- Partage les connaissances entre agents du même projet
- Fonctionne **offline** sans dépendance cloud obligatoire

---

## 2. Audit de l'existant

### 2.1 Project Memory (fichiers .md natifs)

**Fichiers:** `src-tauri/src/commands/memory.rs` (306 lignes), `src/hooks/useMemory.ts`, `src/routes/memory.tsx`

**Fonctionnement :** Lit les fichiers markdown depuis `~/.claude/projects/*/memory/`, `~/.codex/projects/*/memory/`, `~/.gemini/projects/*/memory/`. Expose 4 commandes Tauri : `memory_list_projects`, `memory_read_file`, `memory_write_file`, `memory_create_file`.

**UI :** Page Memory avec 3 panneaux (projets / fichiers / contenu) + AgentKnowledgeGraph (graphe force-directed visualisant agents, skills, mémoires, MCP).

**Forces :**
- Zero configuration — lit la mémoire native de Claude Code/Codex/Gemini
- Pas de base de données propre — simple lecture/écriture de fichiers
- UI fonctionnelle et complète (vue, édition, création, suppression)
- AgentKnowledgeGraph donne une vue d'ensemble visuelle

**Faiblesses :**
- Pas de recherche (ni textuelle, ni sémantique)
- Navigation manuelle uniquement — l'agent ne peut pas auto-retriever
- Pas d'extraction automatique de faits
- Pas de partage inter-agent

### 2.2 Vault (SQLite + FTS5)

**Fichiers:** `src-tauri/src/commands/vault.rs` (382 lignes), `src-tauri/src/db.rs` (116 lignes), `src/components/VaultView/index.tsx`, `mcp-vault/`

**Fonctionnement :** Base SQLite à `~/.dorotoring/vault.db` avec tables `documents`, `folders`, `attachments`. Index FTS5 (full-text search) sur titre/contenu/tags avec triggers auto-sync. MCP server `mcp-vault` expose les outils aux agents via HTTP API (port 31415).

**Schema :**
```sql
documents (id, title, content, folder_id, author, agent_id, tags, created_at, updated_at)
folders (id, name, parent_id, created_at, updated_at)
attachments (id, document_id, filename, filepath, mimetype, size, created_at)
documents_fts USING fts5(title, content, tags)  -- recherche BM25
```

**Forces :**
- Recherche textuelle fonctionnelle (FTS5 BM25 avec snippets `<mark>`)
- Attribution par agent (`agent_id`)
- Organisation hiérarchique (folders)
- Pièces jointes
- MCP server permet aux agents d'écrire/lire/chercher
- Unread tracking côté frontend

**Faiblesses :**
- Recherche lexicale uniquement — "auth" ne matche pas "connexion"
- Pas de similarité sémantique
- Documents manuels — pas d'extraction automatique depuis les conversations
- Pas de déduplication ni résolution de contradictions

### 2.3 Obsidian integration

**Fichiers:** `src/hooks/useObsidian.ts` (142 lignes), `src/components/ObsidianVaultView/index.tsx`

**Fonctionnement :** Le hook `useObsidian` appelle `obsidian_scan`, `obsidian_read_file`, `obsidian_write_file` — mais **ces commandes Rust n'existent pas**. Le champ `obsidianVaultPaths` existe dans `Agent` et dans la config globale, mais la fonctionnalité est non implémentée.

**Verdict :** Code mort. Le frontend et les types existent, le backend non.

### 2.4 Intégrations manquantes

| Fonctionnalité | Frontend | Backend Rust | MCP Server |
|---|---|---|---|
| Project Memory (lire/écrire .md) | useMemory + Memory page | memory.rs | -- |
| Vault (documents + FTS) | VaultView | vault.rs + db.rs | mcp-vault |
| Obsidian | useObsidian + ObsidianVaultView | **MANQUANT** | -- |
| Recherche sémantique | -- | -- | -- |
| Extraction auto de faits | -- | -- | -- |
| Mémoire inter-agent | -- | -- | -- |
| `memory_delete_file` | Appelé dans useMemory | **MANQUANT** dans memory.rs | -- |
| `vault_attach_file` | Référencé | **MANQUANT** dans vault.rs | Existe dans mcp-vault |

---

## 3. Ce qui reste, ce qui part

### 3.1 A GARDER (essentiel)

| Composant | Raison |
|---|---|
| **Project Memory (memory.rs)** | Lecture native des mémoires Claude/Codex/Gemini. C'est le pont entre les agents et la mémoire que Claude Code écrit nativement. Ne pas toucher. |
| **Vault SQLite (vault.rs + db.rs)** | Base de documents fonctionnelle. Devient le **substrat** de la mémoire sémantique : on y ajoute les vecteurs, pas on le remplace. |
| **FTS5** | Reste utile en complément du vectoriel. La recherche hybride (FTS + vector) est meilleure que le vector seul. |
| **mcp-vault** | Canal par lequel les agents interagissent avec le Vault. A étendre avec les opérations sémantiques. |
| **AgentKnowledgeGraph** | Visualisation. A enrichir avec les connexions sémantiques. |
| **Memory page (routes/memory.tsx)** | UI de browsing. Reste utile pour la vue "fichiers bruts". |

### 3.2 A SUPPRIMER (code mort)

| Composant | Raison |
|---|---|
| **useObsidian.ts** | Hook appelant des commandes Rust inexistantes. Dead code. |
| **ObsidianVaultView** | UI pour une fonctionnalité non implémentée. |
| **`obsidianVaultPaths` dans Agent/Config** | Champ orphelin sans backend. |
| **electron/services/memory-service.ts** | Legacy Electron, remplacé par memory.rs Tauri. |
| **electron/handlers/memory-handlers.ts** | Legacy Electron. |

### 3.3 A CORRIGER (bugs/manques)

| Composant | Problème |
|---|---|
| **`memory_delete_file`** | Le frontend l'appelle mais la commande Rust n'existe pas dans memory.rs |
| **`vault_attach_file`** | Le MCP server l'utilise mais pas de commande Tauri correspondante |

### 3.4 A AJOUTER (nouvelle couche sémantique)

| Composant | Description |
|---|---|
| **Stockage vectoriel** | Ajouter des embeddings aux documents Vault |
| **Pipeline d'extraction** | Extraire automatiquement des faits depuis les outputs d'agents |
| **Recherche sémantique** | Retrouver des documents/faits par similarité de sens |
| **Injection de contexte** | Au lancement d'un agent, injecter les mémoires pertinentes |
| **Déduplication/résolution** | Détecter les faits contradictoires et les résoudre |
| **MCP memory tools** | Exposer `remember` / `recall` aux agents |

---

## 4. Etat de l'art

### 4.1 Solutions de mémoire pour agents IA

#### Mem0 (mem0.ai) — Apache 2.0

La référence actuelle. Pipeline : extraction de faits → embeddings → vector store → retrieval sémantique.

| Aspect | Détail |
|---|---|
| **Architecture** | Extraction LLM (identifie les faits) → Compare avec existants → ADD/UPDATE/DELETE/NOOP → Vector store + optional graph (Neo4j) |
| **SDK** | TypeScript (`mem0ai` npm), Python |
| **Self-hosting** | Docker, 24+ vector stores (Qdrant, Chroma, pgvector...), 16+ LLM providers (OpenAI, Anthropic, Ollama) |
| **Performance** | 90% réduction tokens, 91% latence en moins, 26% accuracy en plus vs OpenAI (benchmark LOCOMO) |
| **Forces** | Déduplication automatique, résolution de contradictions, graph memory optionnel |
| **Faiblesses** | Node.js/Python — pas de Rust natif. Chaque opération mémoire = appel LLM (lent sans modèle local) |
| **Pertinence pour Dorotoring** | Forte — concepts à réutiliser (extraction, dédup, ADD/UPDATE/DELETE). SDK TS utilisable dans mcp-vault. Mais ajoute une dépendance Node lourde. |

#### Letta (ex-MemGPT) — Apache 2.0

Paradigme "LLM as OS" : l'agent gère sa propre mémoire comme un OS gère la RAM.

| Aspect | Détail |
|---|---|
| **Architecture** | Core Memory (toujours en contexte, auto-éditable) + Archival Memory (stockage long-terme, cherché à la demande) + Recall Memory (historique cherchable) |
| **Self-hosting** | Docker, SQLite/PostgreSQL, REST API + SDKs TS/Python |
| **Forces** | L'agent décide activement quoi mémoriser et quand purger |
| **Faiblesses** | Framework complet d'agent, pas juste une couche mémoire. Python server obligatoire. |
| **Pertinence** | Concept intéressant (self-editing memory) mais trop lourd comme dépendance. |

#### Zep / Graphiti — Graphiti: Apache 2.0, Zep: cloud-only

Knowledge graph temporel : entités, relations, faits avec timestamps + invalidation.

| Aspect | Détail |
|---|---|
| **Zep Community** | Discontinué (avril 2025). Zep Cloud uniquement (SOC 2, HIPAA). |
| **Graphiti** | Open-source mais nécessite Neo4j + LLM. Lourd pour un desktop app. |
| **Pertinence** | Le concept de **temporalité** (quand un fait a été appris / invalidé) est bon à reprendre. Neo4j = trop lourd. |

#### LangMem — MIT

Toolkit Python pour LangGraph. Pas de SDK TypeScript. Non pertinent pour Dorotoring.

#### OpenAI Memory

Built-in ChatGPT uniquement. Pas d'API. Non utilisable programmatiquement.

### 4.2 Stockage vectoriel

#### sqlite-vec — Apache 2.0 / MIT

Extension SQLite pour recherche vectorielle, écrite en C pur sans dépendances.

| Aspect | Détail |
|---|---|
| **Intégration Rust** | Crate `sqlite-vec` pour rusqlite. `sqlite3_auto_extension()` + feature `bundled`. |
| **Vecteurs** | float32, int8, binary. Tables virtuelles `vec0`. |
| **Recherche** | Brute-force KNN (pas d'ANN). OK pour <100K vecteurs. |
| **Version** | v0.1.7 (pré-v1, breaking changes possibles) |
| **Pertinence** | **Excellent.** Zero dépendance externe, compile statiquement dans rusqlite, parfait pour desktop app. Dorotoring utilise déjà SQLite/rusqlite. |

#### Qdrant — Apache 2.0

Base vectorielle haute performance en Rust. SIMD, quantification, HNSW.

| Aspect | Détail |
|---|---|
| **Self-hosting** | Docker : `qdrant/qdrant` sur ports 6333/6334 |
| **Client Rust** | `qdrant-client` officiel (gRPC/Tonic) |
| **Version** | v1.17.0 |
| **Pertinence** | Bon mais lourd — un conteneur Docker supplémentaire. Justifié uniquement à grande échelle (>100K vecteurs). |

### 4.3 Modèles d'embedding locaux

| Modèle | Params | Dims | Taille | Contexte | CPU? | Notes |
|---|---|---|---|---|---|---|
| **all-MiniLM-L6-v2** | 22.7M | 384 | 22 MB | 256 tokens | Rapide | Idéal pour embarqué Rust (via `ort` crate) |
| **nomic-embed-text v1** | 137M | 768 | 274 MB | 8192 tokens | OK | Meilleur que text-embedding-ada-002. Via Ollama. |
| **nomic-embed-text-v2-moe** | 475M | 768 | ~500 MB | 8192 tokens | Lent | Multilingue (100 langues). MoE. |
| **mxbai-embed-large** | 334M | 1024 | 670 MB | 512 tokens | Lent | Haute qualité mais gourmand. |
| **BGE-M3** | 567M | 1024 | 1.2 GB | 8192 tokens | Très lent | Meilleurs benchmarks, trop lourd pour desktop. |

**Deux chemins pour Dorotoring :**
1. **Natif Rust** : `ort` crate (ONNX Runtime) avec all-MiniLM-L6-v2 (22 MB) → zero dépendance externe
2. **Ollama** : nomic-embed-text via API locale → meilleure qualité, nécessite Ollama installé

---

## 5. Approches proposées

### Approche A — "Natif Rust" (zero dépendance externe)

Tout intégré dans le binaire Tauri. Pas de Docker, pas d'Ollama, pas de process externe.

```
┌──────────────────────────────────────────────────────┐
│                  TAURI BINARY                        │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                  │
│  │  vault.db     │  │  ort crate   │                  │
│  │  (SQLite)     │  │  (ONNX RT)   │                  │
│  │              │  │              │                  │
│  │  documents    │  │  MiniLM-L6   │                  │
│  │  + vec0      │  │  (22 MB)     │                  │
│  │  (sqlite-vec)│  │              │                  │
│  └──────┬───────┘  └──────┬───────┘                  │
│         │                 │                          │
│         ▼                 ▼                          │
│  ┌──────────────────────────────┐                    │
│  │  Memory Service (Rust)       │                    │
│  │  - extract_facts() via LLM   │                    │
│  │  - embed() via ort            │                    │
│  │  - search_similar()          │                    │
│  │  - dedup_and_resolve()       │                    │
│  └──────────────────────────────┘                    │
│         │                                            │
│         ▼                                            │
│  ┌──────────────────────────────┐                    │
│  │  mcp-vault (étendu)          │                    │
│  │  + remember()                │                    │
│  │  + recall()                  │                    │
│  └──────────────────────────────┘                    │
└──────────────────────────────────────────────────────┘
```

**Composants :**
- **Embedding** : `ort` crate + all-MiniLM-L6-v2 (ONNX, 22 MB bundlé)
- **Stockage vectoriel** : `sqlite-vec` extension dans le vault.db existant
- **Extraction de faits** : L'agent lui-même (Claude/GPT) via prompt dédié dans les hooks output
- **Recherche** : Hybrid FTS5 + cosine similarity via vec0

**Ajouts au schema :**
```sql
-- Table de mémoires extraites
CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,          -- le fait en langage naturel
    source_type TEXT NOT NULL,      -- 'agent_output' | 'vault_document' | 'manual'
    source_id TEXT,                 -- agent_id ou document_id
    project_path TEXT,              -- projet concerné
    tags TEXT DEFAULT '[]',
    confidence REAL DEFAULT 1.0,
    superseded_by TEXT,             -- résolution de contradictions
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Vecteurs associés (via sqlite-vec)
CREATE VIRTUAL TABLE memories_vec USING vec0(
    memory_id TEXT PRIMARY KEY,
    embedding float[384]            -- MiniLM dimensions
);

-- Index FTS pour recherche hybride
CREATE VIRTUAL TABLE memories_fts USING fts5(content, tags);
```

**Avantages :**
- Zero dépendance externe — tout compile dans le binaire
- Fonctionne offline immédiatement
- Taille binaire : +~25 MB (modèle ONNX + runtime)
- Latence embedding : ~5-15ms sur CPU pour un passage court
- Pas de process à gérer, pas de Docker

**Inconvénients :**
- Qualité d'embedding limitée (384 dims, 256 tokens max)
- Pas de contexte long — le modèle tronque au-delà de 256 tokens
- Extraction de faits dépend de l'agent (pas de LLM dédié dans le binaire)
- sqlite-vec est pré-v1 (breaking changes possibles)

**Complexité d'implémentation :** Moyenne. Le plus complexe est l'intégration `ort` + `sqlite-vec` dans le build Tauri.

---

### Approche B — "Mem0 adapté" (SDK Node.js dans mcp-vault)

Utiliser le SDK TypeScript `mem0ai` dans le MCP server existant, avec Ollama optionnel pour de meilleurs embeddings.

```
┌───────────────────────────────────────────────────────┐
│                  TAURI APP                            │
│                                                       │
│  ┌──────────────┐     ┌──────────────────────────┐    │
│  │  vault.db     │     │  mcp-vault (Node.js)     │    │
│  │  (SQLite)     │◄────│                          │    │
│  │  documents    │     │  ┌──────────────────┐    │    │
│  │  + FTS5       │     │  │  mem0ai SDK       │    │    │
│  └──────────────┘     │  │  - add()          │    │    │
│                       │  │  - search()       │    │    │
│         ┌─────────────│  │  - get()          │    │    │
│         │             │  └────────┬───────────┘    │    │
│         │             └───────────│────────────────┘    │
│         │                        │                     │
│         ▼                        ▼                     │
│  ┌──────────────┐     ┌──────────────────────┐         │
│  │  Rust API     │     │  Ollama (optionnel)  │         │
│  │  :31415       │     │  nomic-embed-text    │         │
│  └──────────────┘     │  + extraction LLM    │         │
│                       └──────────────────────┘         │
└───────────────────────────────────────────────────────┘
```

**Composants :**
- **SDK** : `mem0ai` npm package dans mcp-vault
- **Vector store** : Qdrant (Docker) ou in-memory (dev) ou sqlite backend via Mem0 config
- **Embedding** : OpenAI text-embedding-3-small (cloud) ou Ollama nomic-embed-text (local)
- **Extraction LLM** : Claude Haiku (cloud) ou Ollama (local)

**Nouveaux outils MCP :**
```typescript
// Dans mcp-vault, ajoutés aux outils existants
remember(content, metadata)     // → mem0.add()
recall(query, filters?)         // → mem0.search()
forget(memoryId)                // → mem0.delete()
list_memories(agentId?, project?) // → mem0.getAll()
```

**Avantages :**
- Extraction de faits clé-en-main (ADD/UPDATE/DELETE/NOOP)
- Déduplication et résolution de contradictions automatiques
- Qualité d'embedding supérieure (768 dims, 8K tokens)
- Moins de code à écrire — Mem0 gère le pipeline
- Graph memory optionnel (relations entre entités)

**Inconvénients :**
- Dépendance npm lourde (`mem0ai` + transitive deps)
- Nécessite un LLM pour chaque opération `add()` (extraction = appel API)
- Mode cloud : coût API (OpenAI embeddings + extraction LLM)
- Mode local : nécessite Ollama installé et un modèle téléchargé (~300 MB)
- Pas de client Rust — le passage Tauri → MCP → Mem0 ajoute de la latence

**Complexité d'implémentation :** Faible à moyenne. L'essentiel est d'intégrer le SDK dans mcp-vault et d'ajouter les routes HTTP dans api_server.rs.

---

### Approche C — "Hybride pragmatique" (Rust natif + Ollama optionnel)

Combiner le meilleur des deux : stockage et recherche en Rust natif (sqlite-vec), mais avec Ollama optionnel pour de meilleurs embeddings quand il est disponible. L'extraction de faits est déléguée aux agents eux-mêmes via les hooks existants.

```
┌───────────────────────────────────────────────────────┐
│                  TAURI APP                            │
│                                                       │
│  ┌──────────────────────────────────────────────┐     │
│  │  Memory Service (Rust)                        │     │
│  │                                              │     │
│  │  ┌─────────────────────────────────────┐     │     │
│  │  │  Embedding Strategy                  │     │     │
│  │  │                                     │     │     │
│  │  │  if Ollama available:               │     │     │
│  │  │    → nomic-embed-text (768d, 8K)    │     │     │
│  │  │  else:                              │     │     │
│  │  │    → MiniLM via ort (384d, 256t)    │     │     │
│  │  └─────────────────────────────────────┘     │     │
│  │                                              │     │
│  │  ┌─────────────────────────────────────┐     │     │
│  │  │  vault.db (SQLite)                   │     │     │
│  │  │                                     │     │     │
│  │  │  documents + FTS5      (existant)   │     │     │
│  │  │  memories + vec0       (nouveau)    │     │     │
│  │  │  memories_fts          (nouveau)    │     │     │
│  │  └─────────────────────────────────────┘     │     │
│  └──────────────────────────────────────────────┘     │
│                                                       │
│  ┌──────────────────────────────────────────────┐     │
│  │  mcp-vault (Node.js, étendu)                  │     │
│  │                                              │     │
│  │  Outils existants : vault_*                  │     │
│  │  Nouveaux outils  : remember, recall, forget │     │
│  │                                              │     │
│  │  → HTTP vers Rust API :31415                 │     │
│  │  → Rust gère embedding + stockage            │     │
│  └──────────────────────────────────────────────┘     │
│                                                       │
│  ┌──────────────────────────────────────────────┐     │
│  │  Hooks (existants, étendus)                   │     │
│  │                                              │     │
│  │  POST /api/hooks/output                      │     │
│  │  → si output contient [MEMORY: ...]          │     │
│  │    → extraire et stocker via Memory Service  │     │
│  └──────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────┘

         ┌──────────────────────┐
         │  Ollama (optionnel)  │
         │  nomic-embed-text    │
         └──────────────────────┘
```

**Fonctionnement :**

1. **Stockage** : Table `memories` + `memories_vec` (sqlite-vec) dans le vault.db existant
2. **Embedding adaptatif** :
   - Vérifie si Ollama est accessible (`http://localhost:11434/api/tags`)
   - Si oui : utilise nomic-embed-text (768 dims, haute qualité)
   - Si non : utilise all-MiniLM-L6-v2 via `ort` (384 dims, embarqué)
   - Dimension stockée par mémoire pour permettre le mix
3. **Extraction de faits** : Pas de LLM dédié. Les agents utilisent un outil MCP `remember(fact)` quand ils jugent qu'un fait est important. Alternative : hook post-output qui parse des marqueurs `[MEMORY: ...]` dans la sortie agent.
4. **Recherche hybride** : Score final = α × cosine_similarity + (1-α) × BM25_score (FTS5)
5. **Injection au lancement** : Quand un agent démarre via `delegate_task`, l'orchestrateur peut appeler `recall(taskPrompt)` et injecter les résultats dans le system prompt.

**Schema SQL :**
```sql
-- Mémoires extraites
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'manual',
    source_id TEXT,
    project_path TEXT,
    agent_id TEXT,
    tags TEXT DEFAULT '[]',
    embedding_dims INTEGER NOT NULL,    -- 384 ou 768 selon le modèle utilisé
    confidence REAL DEFAULT 1.0,
    superseded_by TEXT REFERENCES memories(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Vecteurs (sqlite-vec, dimension dynamique)
CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
    memory_id TEXT PRIMARY KEY,
    embedding float[384]    -- dimension par défaut, recréé si switch à 768
);

-- FTS pour recherche hybride
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content, tags,
    content='memories', content_rowid='rowid'
);
```

**Nouvelles routes API (api_server.rs) :**
```
POST   /api/memories          — créer une mémoire (embed + store)
GET    /api/memories/search   — recherche sémantique (query → embed → KNN + FTS)
GET    /api/memories          — lister (filtres: project, agent, tags)
DELETE /api/memories/:id      — supprimer
POST   /api/memories/:id/supersede  — marquer comme remplacée
```

**Nouveaux outils MCP (mcp-vault étendu) :**
```
remember(content, project?, tags?)      → POST /api/memories
recall(query, project?, limit?)         → GET /api/memories/search
forget(memoryId)                        → DELETE /api/memories/:id
list_memories(project?, agent?)         → GET /api/memories
```

**Avantages :**
- Fonctionne offline immédiatement (fallback MiniLM embarqué)
- Meilleure qualité quand Ollama est dispo (auto-détection)
- Pas de dépendance npm lourde — le MCP server reste léger
- Tout le compute vectoriel est en Rust (performant)
- Recherche hybride (FTS + vectoriel) = meilleure précision
- Extension naturelle de l'architecture existante (vault.db, api_server, mcp-vault)
- L'extraction est explicite (l'agent choisit quoi mémoriser) — pas de surprise

**Inconvénients :**
- Plus de code Rust à écrire que l'approche B
- Pas de déduplication automatique (vs Mem0 qui le fait out-of-the-box)
- Extraction manuelle — l'agent doit appeler `remember()` explicitement
- sqlite-vec pré-v1
- Dimension d'embedding variable (384 vs 768) complique les requêtes

**Complexité d'implémentation :** Moyenne à élevée. Le gros du travail est l'intégration `ort` + `sqlite-vec` + routes API + outils MCP.

---

### Tableau comparatif des approches

| Critère | A — Natif Rust | B — Mem0 SDK | C — Hybride |
|---|---|---|---|
| **Dépendances externes** | Aucune | Ollama ou API cloud | Ollama (optionnel) |
| **Fonctionne offline** | Toujours | Si Ollama local | Toujours (fallback) |
| **Qualité embedding** | Correcte (384d) | Haute (768d+) | Adaptive (384→768d) |
| **Extraction de faits** | Agent via hook | Mem0 automatique | Agent via MCP tool |
| **Déduplication** | Manuelle | Automatique (Mem0) | Manuelle |
| **Impact sur le build** | +25 MB (ONNX) | +npm deps dans MCP | +25 MB (ONNX) |
| **Complexité code** | Moyenne | Faible | Moyenne-haute |
| **Maintenabilité** | Tout en Rust | Dépend de Mem0 | Rust + MCP |
| **Latence search** | <10ms | ~200ms (Mem0) | <10ms local |
| **Scalabilité** | <100K mémoires | Illimitée (Qdrant) | <100K mémoires |
| **Risque technique** | sqlite-vec pré-v1 | Mem0 SDK stability | sqlite-vec pré-v1 |

---

## 6. Recommandation

**Approche C — Hybride pragmatique** est recommandée.

**Pourquoi :**

1. **Offline first** — Une app desktop doit fonctionner sans internet. Le fallback MiniLM embarqué garantit ça.
2. **Architecture cohérente** — Tout passe par Rust (embedding, stockage, API). Le MCP server reste un thin client HTTP.
3. **Progressive enhancement** — Commence avec MiniLM embarqué. Ollama améliore la qualité quand disponible. Un futur provider cloud peut être ajouté sans refonte.
4. **Extraction explicite** — L'agent choisit quoi mémoriser (`remember("Le endpoint /users nécessite auth JWT")`). Pas de magie noire, pas de coût LLM caché par `add()`.
5. **Recherche hybride** — FTS5 + vectoriel est l'état de l'art pour la qualité de résultats.

**Ce qu'on prend de chaque solution :**
- De **Mem0** : le concept ADD/UPDATE/DELETE/NOOP, la résolution de contradictions (`superseded_by`)
- De **Letta** : l'idée que l'agent gère activement sa mémoire via des outils
- De **Zep/Graphiti** : la temporalité (quand un fait a été appris, quand il a été invalidé)
- De **sqlite-vec** : le stockage vectoriel sans dépendance
- De **Dorotoring existant** : vault.db, FTS5, mcp-vault, hooks, api_server

---

## 7. Annexes

### A. Arbre de décision embedding

```
Au démarrage du Memory Service :
│
├─ Vérifier Ollama (GET http://localhost:11434/api/tags)
│  │
│  ├─ Disponible + nomic-embed-text installé
│  │  → Utiliser nomic-embed-text (768 dims)
│  │  → Log: "Using Ollama nomic-embed-text for embeddings"
│  │
│  ├─ Disponible mais modèle manquant
│  │  → Fallback MiniLM
│  │  → Proposer dans l'UI : "Install nomic-embed-text for better search"
│  │
│  └─ Non disponible
│     → Fallback MiniLM via ort (384 dims)
│     → Log: "Using built-in MiniLM for embeddings (install Ollama for better quality)"
```

### B. Flux d'extraction de mémoire

```
Agent termine une tâche
│
├─ Voie 1 : Outil MCP explicite
│  Agent appelle remember("Fait important", {project: "/path", tags: ["api"]})
│  → mcp-vault → POST /api/memories → Rust embed + store
│
├─ Voie 2 : Hook post-output (automatique)
│  POST /api/hooks/output contient le texte de sortie
│  → Rust parse les marqueurs [MEMORY: ...] dans le texte
│  → Pour chaque marqueur : embed + store
│
└─ Voie 3 : UI manuelle
   L'utilisateur crée une mémoire depuis la page Memory
   → Frontend → Tauri command → embed + store
```

### C. Flux de recall au lancement d'agent

```
Super Agent appelle delegate_task(agentId, prompt)
│
├─ mcp-orchestrator appelle recall(prompt, {project: agentProject})
│  → GET /api/memories/search?q={prompt}&project={path}&limit=5
│  → Retourne les 5 mémoires les plus pertinentes
│
├─ Construit le prompt enrichi :
│  """
│  ## Relevant context from previous sessions:
│  - [2026-03-25] Le endpoint /users nécessite auth JWT (source: agent-42)
│  - [2026-03-24] La migration 003 ajoute la colonne email (source: agent-17)
│
│  ## Your task:
│  {prompt original}
│  """
│
└─ start_agent(agentId, enrichedPrompt)
```

### D. Crates Rust nécessaires

```toml
# Cargo.toml additions
ort = "2.0"                    # ONNX Runtime pour MiniLM
sqlite-vec = "0.1"             # Extension vectorielle SQLite
tokenizers = "0.21"            # Tokenizer HuggingFace (pour MiniLM)
reqwest = { version = "0.12", features = ["json"] }  # Pour appeler Ollama
```

### E. Sources

- [Mem0 Documentation](https://docs.mem0.ai/) — Architecture et SDK
- [Mem0 Research Paper (arXiv 2504.19413)](https://arxiv.org/abs/2504.19413) — Benchmarks LOCOMO
- [sqlite-vec Documentation](https://alexgarcia.xyz/sqlite-vec/) — API et intégration Rust
- [Qdrant Documentation](https://qdrant.tech/documentation/) — Vector DB
- [Letta / MemGPT Concepts](https://docs.letta.com/concepts/memgpt/) — Self-editing memory
- [Graphiti (Zep)](https://github.com/getzep/graphiti) — Temporal knowledge graph
- [nomic-embed-text](https://ollama.com/library/nomic-embed-text) — Modèle d'embedding
- [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) — Modèle embarqué léger
- [ONNX Runtime Rust (ort)](https://github.com/pykeio/ort) — Inférence ML en Rust
