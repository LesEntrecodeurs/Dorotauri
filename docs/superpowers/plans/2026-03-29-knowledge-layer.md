# Knowledge Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Dorotoring agents instant codebase comprehension and long-term memory via a unified knowledge.db per project.

**Architecture:** Rust backend (tree-sitter parsing, embeddings via ort/MiniLM, SQLite with FTS5 + sqlite-vec) exposes endpoints on the existing Axum API (:31415). A new Node.js MCP server (`mcp-code-intelligence`) wraps these endpoints as MCP tools. Repo map is injected at agent spawn via `--append-system-prompt-file`.

**Tech Stack:** Rust (tree-sitter, ort, sqlite-vec, notify, sha2), Node.js (MCP SDK, zod, esbuild), SQLite (FTS5, vec0)

---

## File Structure

### New Rust modules (`src-tauri/src/`)

| File | Responsibility |
|------|---------------|
| `knowledge/mod.rs` | Module re-exports, `KnowledgeEngine` struct, init/shutdown |
| `knowledge/db.rs` | Schema creation, migrations, connection pool per project |
| `knowledge/tree_sitter.rs` | Multi-language parser, symbol + import extraction |
| `knowledge/reference_graph.rs` | Build reference graph from imports, PageRank scoring |
| `knowledge/repo_map.rs` | Generate budget-aware markdown repo map from symbols |
| `knowledge/indexer.rs` | Orchestrates parse → index → embed pipeline for files |
| `knowledge/file_watcher.rs` | `notify` crate watcher, debounce, triggers re-index |
| `knowledge/session_capture.rs` | Capture session data on agent completion |
| `knowledge/claude_memory.rs` | Index Claude Code memory markdown files |
| `knowledge/search.rs` | Hybrid FTS5 + embedding search with score fusion |
| `embedding/mod.rs` | `EmbeddingEngine` — MiniLM via ort, Ollama fallback |

### New MCP server (`mcp-code-intelligence/`)

| File | Responsibility |
|------|---------------|
| `src/index.ts` | MCP server entrypoint, registers all tools |
| `src/tools/repo-map.ts` | `dorotoring_repo_map` tool |
| `src/tools/outline.ts` | `dorotoring_file_outline` tool |
| `src/tools/symbols.ts` | `dorotoring_symbol_lookup` tool |
| `src/tools/search.ts` | `dorotoring_recall` tool |
| `src/utils/api.ts` | HTTP client to Rust API (:31415) |

### Modified files

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add tree-sitter, ort, sqlite-vec, notify, sha2, tokenizers deps |
| `src-tauri/src/lib.rs` | Add `knowledge` and `embedding` modules, init KnowledgeEngine in setup |
| `src-tauri/src/agent/provider.rs` | Add `repo_map_file` to `AgentStartConfig`, append to command |
| `src-tauri/src/commands/agent.rs` | Pass repo map file path when building start config |
| `src-tauri/src/api_server.rs` | Add `/api/code/*`, `/api/knowledge/*`, `/api/sessions/*`, `/api/events/*` routes |
| `src-tauri/src/commands/orchestrator.rs` | Register `dorotoring-code-intel` MCP server alongside orchestrator |
| `mcp-orchestrator/src/tools/agents.ts` | Add `tail_events` tool |

---

## Task 1: Add Rust Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add new dependencies to Cargo.toml**

```toml
# Add after existing dependencies:
tree-sitter = "0.24"
tree-sitter-typescript = "0.23"
tree-sitter-javascript = "0.23"
tree-sitter-python = "0.23"
tree-sitter-rust = "0.23"
tree-sitter-go = "0.23"
notify = { version = "7", features = ["macos_kqueue"] }
sha2 = "0.10"
ort = { version = "2", features = ["load-dynamic"] }
tokenizers = { version = "0.21", features = ["onig"] }
```

Note: `sqlite-vec` is loaded as a runtime extension via `rusqlite`, not a Cargo dep.
`ort` with `load-dynamic` avoids bundling ONNX runtime at build time — it uses a
shared library or downloads it. For the MiniLM model, we'll download it on first use
to `~/.dorotoring/models/all-MiniLM-L6-v2.onnx`.

- [ ] **Step 2: Verify build compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: successful compilation (warnings OK)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "chore: add tree-sitter, ort, notify, sha2 dependencies"
```

---

## Task 2: Embedding Engine

**Files:**
- Create: `src-tauri/src/embedding/mod.rs`

- [ ] **Step 1: Create embedding module directory**

```bash
mkdir -p src-tauri/src/embedding
```

- [ ] **Step 2: Write the EmbeddingEngine**

Create `src-tauri/src/embedding/mod.rs`:

```rust
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

const MODEL_FILENAME: &str = "all-MiniLM-L6-v2.onnx";
const TOKENIZER_FILENAME: &str = "tokenizer.json";
const MODEL_URL: &str = "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx";
const TOKENIZER_URL: &str = "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json";
const MINILM_DIMS: usize = 384;

pub struct EmbeddingEngine {
    session: Option<Arc<ort::Session>>,
    tokenizer: Option<tokenizers::Tokenizer>,
    dims: usize,
    models_dir: PathBuf,
}

impl EmbeddingEngine {
    pub fn new(data_dir: &Path) -> Self {
        let models_dir = data_dir.join("models");
        Self {
            session: None,
            tokenizer: None,
            dims: MINILM_DIMS,
            models_dir,
        }
    }

    /// Download model files if missing, then load ONNX session.
    /// Call once at startup. If download fails, engine stays inactive.
    pub async fn init(&mut self) -> Result<(), String> {
        std::fs::create_dir_all(&self.models_dir)
            .map_err(|e| format!("Failed to create models dir: {e}"))?;

        let model_path = self.models_dir.join(MODEL_FILENAME);
        let tokenizer_path = self.models_dir.join(TOKENIZER_FILENAME);

        // Download if missing
        if !model_path.exists() {
            eprintln!("[embedding] Downloading MiniLM model...");
            download_file(MODEL_URL, &model_path).await?;
        }
        if !tokenizer_path.exists() {
            eprintln!("[embedding] Downloading tokenizer...");
            download_file(TOKENIZER_URL, &tokenizer_path).await?;
        }

        // Load ONNX session
        let session = ort::Session::builder()
            .map_err(|e| format!("ONNX session builder error: {e}"))?
            .with_intra_threads(1)
            .map_err(|e| format!("ONNX thread config error: {e}"))?
            .commit_from_file(&model_path)
            .map_err(|e| format!("ONNX load error: {e}"))?;

        let tokenizer = tokenizers::Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| format!("Tokenizer load error: {e}"))?;

        self.session = Some(Arc::new(session));
        self.tokenizer = Some(tokenizer);
        eprintln!("[embedding] MiniLM loaded ({MINILM_DIMS}d)");
        Ok(())
    }

    pub fn is_ready(&self) -> bool {
        self.session.is_some()
    }

    pub fn dims(&self) -> usize {
        self.dims
    }

    /// Generate embedding for a text. Returns None if engine not initialized.
    pub fn embed(&self, text: &str) -> Option<Vec<f32>> {
        let session = self.session.as_ref()?;
        let tokenizer = self.tokenizer.as_ref()?;

        let encoding = tokenizer.encode(text, true).ok()?;
        let input_ids: Vec<i64> = encoding.get_ids().iter().map(|&x| x as i64).collect();
        let attention_mask: Vec<i64> = encoding.get_attention_mask().iter().map(|&x| x as i64).collect();
        let token_type_ids: Vec<i64> = vec![0i64; input_ids.len()];
        let len = input_ids.len();

        let ids_array = ndarray::Array2::from_shape_vec((1, len), input_ids).ok()?;
        let mask_array = ndarray::Array2::from_shape_vec((1, len), attention_mask).ok()?;
        let type_array = ndarray::Array2::from_shape_vec((1, len), token_type_ids).ok()?;

        let outputs = session
            .run(ort::inputs![ids_array, mask_array, type_array].ok()?)
            .ok()?;

        // Mean pooling over token embeddings
        let embeddings = outputs[0].try_extract_tensor::<f32>().ok()?;
        let view = embeddings.view();
        // Shape: (1, seq_len, 384)
        let seq_len = view.shape()[1];
        let dims = view.shape()[2];
        let mut pooled = vec![0.0f32; dims];
        for i in 0..seq_len {
            for j in 0..dims {
                pooled[j] += view[[0, i, j]];
            }
        }
        for v in &mut pooled {
            *v /= seq_len as f32;
        }
        // L2 normalize
        let norm: f32 = pooled.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for v in &mut pooled {
                *v /= norm;
            }
        }
        Some(pooled)
    }
}

async fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Download read failed: {e}"))?;
    std::fs::write(dest, &bytes)
        .map_err(|e| format!("Write failed: {e}"))?;
    Ok(())
}
```

- [ ] **Step 3: Add ndarray dependency for ort tensor operations**

Add to `src-tauri/Cargo.toml`:
```toml
ndarray = "0.16"
```

- [ ] **Step 4: Register module in lib.rs**

Add to `src-tauri/src/lib.rs` after other module declarations:
```rust
pub mod embedding;
```

- [ ] **Step 5: Verify build**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: compiles successfully

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/embedding/ src-tauri/Cargo.toml src-tauri/src/lib.rs
git commit -m "feat: add EmbeddingEngine with MiniLM/ort support"
```

---

## Task 3: Knowledge DB Schema

**Files:**
- Create: `src-tauri/src/knowledge/mod.rs`
- Create: `src-tauri/src/knowledge/db.rs`

- [ ] **Step 1: Create knowledge module directory**

```bash
mkdir -p src-tauri/src/knowledge
```

- [ ] **Step 2: Write db.rs with schema and connection management**

Create `src-tauri/src/knowledge/db.rs`:

```rust
use rusqlite::{Connection, params};
use sha2::{Sha256, Digest};
use std::path::{Path, PathBuf};

const SCHEMA_VERSION: u32 = 1;

/// Returns the DB path for a given project path.
/// ~/.dorotoring/projects/{hash}/knowledge.db
pub fn db_path_for_project(project_path: &str) -> PathBuf {
    let hash = project_hash(project_path);
    let base = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".dorotoring")
        .join("projects")
        .join(&hash);
    std::fs::create_dir_all(&base).ok();
    base.join("knowledge.db")
}

pub fn project_hash(project_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(project_path.as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..6]) // 12 hex chars
}

pub fn open(project_path: &str) -> Result<Connection, String> {
    let path = db_path_for_project(project_path);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open knowledge.db: {e}"))?;

    conn.execute_batch("
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
    ").map_err(|e| format!("Pragma error: {e}"))?;

    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap_or(0);

    if version < 1 {
        conn.execute_batch("
            -- Code Knowledge
            CREATE TABLE IF NOT EXISTS symbols (
                id INTEGER PRIMARY KEY,
                file TEXT NOT NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                signature TEXT,
                line INTEGER NOT NULL,
                end_line INTEGER,
                exported BOOLEAN DEFAULT FALSE,
                rank REAL DEFAULT 0.0
            );

            CREATE TABLE IF NOT EXISTS refs (
                id INTEGER PRIMARY KEY,
                from_file TEXT NOT NULL,
                from_symbol TEXT,
                to_symbol TEXT NOT NULL,
                to_file TEXT,
                line INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file);
            CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
            CREATE INDEX IF NOT EXISTS idx_refs_to ON refs(to_symbol);

            -- Agent Knowledge
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                prompt TEXT,
                status TEXT NOT NULL,
                files_modified TEXT,
                commits TEXT,
                transcript TEXT,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                pinned BOOLEAN DEFAULT FALSE
            );

            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                from_agent TEXT NOT NULL,
                to_agent TEXT,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                tab_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_events_agent ON events(from_agent, created_at);
            CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);

            -- Unified FTS5 index
            CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
                content,
                source_type,
                source_id,
                file
            );

            -- Embedding vector index (384d MiniLM)
            -- Note: sqlite-vec must be loaded before creating this table.
            -- See load_sqlite_vec() below.
        ").map_err(|e| format!("Migration error: {e}"))?;

        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|e| format!("Version update error: {e}"))?;
    }

    Ok(())
}

/// Load sqlite-vec extension for vector search.
/// The extension binary is expected at ~/.dorotoring/extensions/vec0.so (Linux)
/// or vec0.dylib (macOS). Downloaded on first use.
pub fn load_sqlite_vec(conn: &Connection) -> Result<(), String> {
    let ext_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".dorotoring")
        .join("extensions");
    std::fs::create_dir_all(&ext_dir).ok();

    let ext_name = if cfg!(target_os = "macos") { "vec0.dylib" } else { "vec0.so" };
    let ext_path = ext_dir.join(ext_name);

    if !ext_path.exists() {
        eprintln!("[knowledge] sqlite-vec extension not found at {}. Vector search disabled.", ext_path.display());
        return Ok(());
    }

    unsafe {
        conn.load_extension(&ext_path, None)
            .map_err(|e| format!("Failed to load sqlite-vec: {e}"))?;
    }
    Ok(())
}

/// Purge sessions older than retention_days (skip pinned)
pub fn purge_old_sessions(conn: &Connection, retention_days: u32) -> Result<usize, String> {
    let deleted = conn.execute(
        "DELETE FROM sessions WHERE pinned = FALSE AND started_at < datetime('now', ?1)",
        params![format!("-{retention_days} days")],
    ).map_err(|e| format!("Purge error: {e}"))?;

    // Also clean FTS entries for deleted sessions
    conn.execute(
        "DELETE FROM knowledge_fts WHERE source_type = 'session' AND source_id NOT IN (SELECT id FROM sessions)",
        [],
    ).map_err(|e| format!("FTS cleanup error: {e}"))?;

    Ok(deleted)
}
```

- [ ] **Step 3: Write mod.rs with KnowledgeEngine struct**

Create `src-tauri/src/knowledge/mod.rs`:

```rust
pub mod db;
pub mod tree_sitter;
pub mod reference_graph;
pub mod repo_map;
pub mod indexer;
pub mod file_watcher;
pub mod session_capture;
pub mod claude_memory;
pub mod search;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use rusqlite::Connection;
use crate::embedding::EmbeddingEngine;

pub struct KnowledgeEngine {
    /// One DB connection per project (keyed by project path)
    connections: Mutex<HashMap<String, Arc<std::sync::Mutex<Connection>>>>,
    pub embedding: Arc<Mutex<EmbeddingEngine>>,
    pub data_dir: PathBuf,
}

impl KnowledgeEngine {
    pub fn new(data_dir: PathBuf, embedding: Arc<Mutex<EmbeddingEngine>>) -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
            embedding,
            data_dir,
        }
    }

    /// Get or open a connection for a project.
    pub async fn get_conn(&self, project_path: &str) -> Result<Arc<std::sync::Mutex<Connection>>, String> {
        let mut conns = self.connections.lock().await;
        if let Some(conn) = conns.get(project_path) {
            return Ok(Arc::clone(conn));
        }
        let conn = db::open(project_path)?;
        let arc = Arc::new(std::sync::Mutex::new(conn));
        conns.insert(project_path.to_string(), Arc::clone(&arc));
        Ok(arc)
    }
}
```

- [ ] **Step 4: Add hex dependency and register module**

Add to `src-tauri/Cargo.toml`:
```toml
hex = "0.4"
```

Add to `src-tauri/src/lib.rs`:
```rust
pub mod knowledge;
```

- [ ] **Step 5: Verify build**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: compiles (will warn about unused modules — that's fine, we'll fill them next)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/knowledge/ src-tauri/Cargo.toml src-tauri/src/lib.rs
git commit -m "feat: add knowledge DB schema and KnowledgeEngine skeleton"
```

---

## Task 4: tree-sitter Parser

**Files:**
- Create: `src-tauri/src/knowledge/tree_sitter.rs`

- [ ] **Step 1: Write the multi-language parser**

Create `src-tauri/src/knowledge/tree_sitter.rs`:

```rust
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize)]
pub struct Symbol {
    pub name: String,
    pub kind: SymbolKind,
    pub signature: Option<String>,
    pub line: usize,
    pub end_line: Option<usize>,
    pub exported: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub enum SymbolKind {
    Function,
    Class,
    Interface,
    Type,
    Variable,
    Method,
}

impl SymbolKind {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Function => "function",
            Self::Class => "class",
            Self::Interface => "interface",
            Self::Type => "type",
            Self::Variable => "variable",
            Self::Method => "method",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Import {
    pub source: String,
    pub symbols: Vec<String>,
    pub line: usize,
}

#[derive(Debug)]
pub struct ParseResult {
    pub symbols: Vec<Symbol>,
    pub imports: Vec<Import>,
}

#[derive(Debug, Clone, Copy)]
pub enum Language {
    TypeScript,
    JavaScript,
    Python,
    Rust,
    Go,
}

pub fn detect_language(path: &Path) -> Option<Language> {
    match path.extension()?.to_str()? {
        "ts" | "tsx" => Some(Language::TypeScript),
        "js" | "jsx" | "mjs" | "cjs" => Some(Language::JavaScript),
        "py" => Some(Language::Python),
        "rs" => Some(Language::Rust),
        "go" => Some(Language::Go),
        _ => None,
    }
}

pub fn parse_file(path: &Path) -> Result<ParseResult, String> {
    let lang = detect_language(path)
        .ok_or_else(|| format!("Unsupported language: {}", path.display()))?;

    let source = std::fs::read_to_string(path)
        .map_err(|e| format!("Read error: {e}"))?;

    let mut parser = ::tree_sitter::Parser::new();
    let ts_language = get_ts_language(lang);
    parser.set_language(&ts_language)
        .map_err(|e| format!("Language error: {e}"))?;

    let tree = parser.parse(&source, None)
        .ok_or("Parse failed")?;

    let root = tree.root_node();
    let mut symbols = Vec::new();
    let mut imports = Vec::new();

    extract_nodes(root, &source, lang, &mut symbols, &mut imports);

    Ok(ParseResult { symbols, imports })
}

fn get_ts_language(lang: Language) -> tree_sitter::Language {
    match lang {
        Language::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        Language::JavaScript => tree_sitter_javascript::LANGUAGE_JAVASCRIPT.into(),
        Language::Python => tree_sitter_python::LANGUAGE_PYTHON.into(),
        Language::Rust => tree_sitter_rust::LANGUAGE_RUST.into(),
        Language::Go => tree_sitter_go::LANGUAGE_GO.into(),
    }
}

fn extract_nodes(
    node: tree_sitter::Node,
    source: &str,
    lang: Language,
    symbols: &mut Vec<Symbol>,
    imports: &mut Vec<Import>,
) {
    let kind = node.kind();

    match lang {
        Language::TypeScript | Language::JavaScript => {
            extract_ts_node(node, source, kind, symbols, imports);
        }
        Language::Python => {
            extract_python_node(node, source, kind, symbols, imports);
        }
        Language::Rust => {
            extract_rust_node(node, source, kind, symbols, imports);
        }
        Language::Go => {
            extract_go_node(node, source, kind, symbols, imports);
        }
    }

    // Recurse into children
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        extract_nodes(child, source, lang, symbols, imports);
    }
}

fn extract_ts_node(
    node: tree_sitter::Node,
    source: &str,
    kind: &str,
    symbols: &mut Vec<Symbol>,
    imports: &mut Vec<Import>,
) {
    match kind {
        "function_declaration" | "method_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source);
                let sig = extract_line_text(node, source);
                let exported = is_exported_ts(node);
                let sym_kind = if kind == "method_definition" {
                    SymbolKind::Method
                } else {
                    SymbolKind::Function
                };
                symbols.push(Symbol {
                    name,
                    kind: sym_kind,
                    signature: Some(sig),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported,
                });
            }
        }
        "class_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                symbols.push(Symbol {
                    name: node_text(name_node, source),
                    kind: SymbolKind::Class,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported: is_exported_ts(node),
                });
            }
        }
        "interface_declaration" | "type_alias_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let sym_kind = if kind == "interface_declaration" {
                    SymbolKind::Interface
                } else {
                    SymbolKind::Type
                };
                symbols.push(Symbol {
                    name: node_text(name_node, source),
                    kind: sym_kind,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported: is_exported_ts(node),
                });
            }
        }
        "lexical_declaration" | "variable_declaration" => {
            // export const foo = ...
            if is_exported_ts(node) {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "variable_declarator" {
                        if let Some(name_node) = child.child_by_field_name("name") {
                            symbols.push(Symbol {
                                name: node_text(name_node, source),
                                kind: SymbolKind::Variable,
                                signature: Some(extract_line_text(node, source)),
                                line: node.start_position().row + 1,
                                end_line: None,
                                exported: true,
                            });
                        }
                    }
                }
            }
        }
        "import_statement" => {
            if let Some(imp) = parse_ts_import(node, source) {
                imports.push(imp);
            }
        }
        _ => {}
    }
}

fn extract_python_node(
    node: tree_sitter::Node,
    source: &str,
    kind: &str,
    symbols: &mut Vec<Symbol>,
    imports: &mut Vec<Import>,
) {
    match kind {
        "function_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                symbols.push(Symbol {
                    name: node_text(name_node, source),
                    kind: SymbolKind::Function,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported: !node_text(name_node, source).starts_with('_'),
                });
            }
        }
        "class_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                symbols.push(Symbol {
                    name: node_text(name_node, source),
                    kind: SymbolKind::Class,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported: true,
                });
            }
        }
        "import_from_statement" => {
            if let Some(module) = node.child_by_field_name("module_name") {
                let source_name = node_text(module, source);
                let mut syms = Vec::new();
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "dotted_name" || child.kind() == "aliased_import" {
                        syms.push(node_text(child, source));
                    }
                }
                imports.push(Import {
                    source: source_name,
                    symbols: syms,
                    line: node.start_position().row + 1,
                });
            }
        }
        _ => {}
    }
}

fn extract_rust_node(
    node: tree_sitter::Node,
    source: &str,
    kind: &str,
    symbols: &mut Vec<Symbol>,
    imports: &mut Vec<Import>,
) {
    match kind {
        "function_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let exported = has_visibility(node, source);
                symbols.push(Symbol {
                    name: node_text(name_node, source),
                    kind: SymbolKind::Function,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported,
                });
            }
        }
        "struct_item" | "enum_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                symbols.push(Symbol {
                    name: node_text(name_node, source),
                    kind: SymbolKind::Class,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported: has_visibility(node, source),
                });
            }
        }
        "type_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                symbols.push(Symbol {
                    name: node_text(name_node, source),
                    kind: SymbolKind::Type,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: None,
                    exported: has_visibility(node, source),
                });
            }
        }
        "use_declaration" => {
            let text = node_text(node, source);
            imports.push(Import {
                source: text,
                symbols: vec![],
                line: node.start_position().row + 1,
            });
        }
        _ => {}
    }
}

fn extract_go_node(
    node: tree_sitter::Node,
    source: &str,
    kind: &str,
    symbols: &mut Vec<Symbol>,
    imports: &mut Vec<Import>,
) {
    match kind {
        "function_declaration" | "method_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source);
                let exported = name.chars().next().map_or(false, |c| c.is_uppercase());
                let sym_kind = if kind == "method_declaration" {
                    SymbolKind::Method
                } else {
                    SymbolKind::Function
                };
                symbols.push(Symbol {
                    name,
                    kind: sym_kind,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported,
                });
            }
        }
        "type_declaration" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "type_spec" {
                    if let Some(name_node) = child.child_by_field_name("name") {
                        let name = node_text(name_node, source);
                        let exported = name.chars().next().map_or(false, |c| c.is_uppercase());
                        symbols.push(Symbol {
                            name,
                            kind: SymbolKind::Type,
                            signature: Some(extract_line_text(child, source)),
                            line: child.start_position().row + 1,
                            end_line: Some(child.end_position().row + 1),
                            exported,
                        });
                    }
                }
            }
        }
        _ => {}
    }
}

// --- Helpers ---

fn node_text(node: tree_sitter::Node, source: &str) -> String {
    source[node.byte_range()].to_string()
}

fn extract_line_text(node: tree_sitter::Node, source: &str) -> String {
    let start = node.start_position().row;
    source.lines().nth(start).unwrap_or("").trim().to_string()
}

fn is_exported_ts(node: tree_sitter::Node) -> bool {
    node.parent()
        .map(|p| p.kind() == "export_statement")
        .unwrap_or(false)
}

fn has_visibility(node: tree_sitter::Node, source: &str) -> bool {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "visibility_modifier" {
            return node_text(child, source).contains("pub");
        }
    }
    false
}

fn parse_ts_import(node: tree_sitter::Node, source: &str) -> Option<Import> {
    let mut import_source = String::new();
    let mut symbols = Vec::new();

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "string" | "string_fragment" => {
                import_source = node_text(child, source)
                    .trim_matches(|c| c == '"' || c == '\'')
                    .to_string();
            }
            "import_clause" | "named_imports" => {
                let mut inner = child.walk();
                for spec in child.children(&mut inner) {
                    if spec.kind() == "import_specifier" {
                        if let Some(name) = spec.child_by_field_name("name") {
                            symbols.push(node_text(name, source));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if import_source.is_empty() {
        return None;
    }

    Some(Import {
        source: import_source,
        symbols,
        line: node.start_position().row + 1,
    })
}
```

- [ ] **Step 2: Write a basic test**

Add at the bottom of `tree_sitter.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_parse_typescript_function() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.ts");
        std::fs::write(&file, "export function hello(name: string): string {\n  return name;\n}\n").unwrap();

        let result = parse_file(&file).unwrap();
        assert_eq!(result.symbols.len(), 1);
        assert_eq!(result.symbols[0].name, "hello");
        assert!(result.symbols[0].exported);
        assert_eq!(result.symbols[0].line, 1);
    }

    #[test]
    fn test_parse_typescript_class() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.ts");
        std::fs::write(&file, "export class UserService {\n  findById(id: string): User {\n    return {} as User;\n  }\n}\n").unwrap();

        let result = parse_file(&file).unwrap();
        let class = result.symbols.iter().find(|s| s.name == "UserService");
        assert!(class.is_some());
    }

    #[test]
    fn test_parse_typescript_import() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.ts");
        std::fs::write(&file, "import { Router, Request } from 'express';\n").unwrap();

        let result = parse_file(&file).unwrap();
        assert_eq!(result.imports.len(), 1);
        assert_eq!(result.imports[0].source, "express");
    }

    #[test]
    fn test_detect_language() {
        assert!(matches!(detect_language(Path::new("foo.ts")), Some(Language::TypeScript)));
        assert!(matches!(detect_language(Path::new("foo.py")), Some(Language::Python)));
        assert!(matches!(detect_language(Path::new("foo.rs")), Some(Language::Rust)));
        assert!(matches!(detect_language(Path::new("foo.go")), Some(Language::Go)));
        assert!(detect_language(Path::new("foo.txt")).is_none());
    }
}
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test knowledge::tree_sitter -- --nocapture 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/knowledge/tree_sitter.rs
git commit -m "feat: add tree-sitter multi-language parser (TS/JS/Python/Rust/Go)"
```

---

## Task 5: Reference Graph + PageRank

**Files:**
- Create: `src-tauri/src/knowledge/reference_graph.rs`

- [ ] **Step 1: Write reference graph builder and PageRank**

Create `src-tauri/src/knowledge/reference_graph.rs`:

```rust
use rusqlite::{Connection, params};
use std::collections::HashMap;

/// Build references from imports and compute PageRank.
/// Call after indexing all files in a project.
pub fn build_and_rank(conn: &Connection) -> Result<(), String> {
    compute_pagerank(conn)?;
    Ok(())
}

/// Compute PageRank on the symbol reference graph.
/// Updates symbols.rank column.
pub fn compute_pagerank(conn: &Connection) -> Result<(), String> {
    // Collect all symbols and their incoming reference counts
    let mut stmt = conn.prepare("SELECT id, name FROM symbols")
        .map_err(|e| format!("Query error: {e}"))?;

    let symbols: Vec<(i64, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| format!("Query error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    if symbols.is_empty() {
        return Ok(());
    }

    let name_to_id: HashMap<String, i64> = symbols.iter()
        .map(|(id, name)| (name.clone(), *id))
        .collect();

    // Build adjacency: who references whom
    let mut stmt = conn.prepare("SELECT to_symbol FROM refs")
        .map_err(|e| format!("Query error: {e}"))?;

    let mut incoming_count: HashMap<i64, f64> = HashMap::new();
    let refs: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Query error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    for to_sym in &refs {
        if let Some(&id) = name_to_id.get(to_sym) {
            *incoming_count.entry(id).or_insert(0.0) += 1.0;
        }
    }

    // Simple PageRank: rank = damping * (incoming_refs / total_refs) + (1 - damping) / N
    let damping = 0.85;
    let n = symbols.len() as f64;
    let total_refs = refs.len().max(1) as f64;

    let tx = conn.unchecked_transaction()
        .map_err(|e| format!("Transaction error: {e}"))?;

    for (id, _name) in &symbols {
        let incoming = incoming_count.get(id).copied().unwrap_or(0.0);
        let rank = damping * (incoming / total_refs) + (1.0 - damping) / n;
        tx.execute("UPDATE symbols SET rank = ?1 WHERE id = ?2", params![rank, id])
            .map_err(|e| format!("Update error: {e}"))?;
    }

    tx.commit().map_err(|e| format!("Commit error: {e}"))?;
    Ok(())
}

/// Insert a reference into the refs table.
pub fn insert_ref(
    conn: &Connection,
    from_file: &str,
    from_symbol: Option<&str>,
    to_symbol: &str,
    to_file: Option<&str>,
    line: usize,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO refs (from_file, from_symbol, to_symbol, to_file, line) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![from_file, from_symbol, to_symbol, to_file, line],
    ).map_err(|e| format!("Insert ref error: {e}"))?;
    Ok(())
}

/// Clear all refs for a given file (before re-indexing).
pub fn clear_file_refs(conn: &Connection, file: &str) -> Result<(), String> {
    conn.execute("DELETE FROM refs WHERE from_file = ?1", params![file])
        .map_err(|e| format!("Delete error: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::knowledge::db::open_with_conn(&conn).ok();
        // Manual schema for test
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS symbols (id INTEGER PRIMARY KEY, file TEXT, name TEXT, kind TEXT, signature TEXT, line INTEGER, end_line INTEGER, exported BOOLEAN DEFAULT FALSE, rank REAL DEFAULT 0.0);
            CREATE TABLE IF NOT EXISTS refs (id INTEGER PRIMARY KEY, from_file TEXT, from_symbol TEXT, to_symbol TEXT, to_file TEXT, line INTEGER);
        ").unwrap();
        conn
    }

    #[test]
    fn test_pagerank_basic() {
        let conn = setup_test_db();

        // Insert symbols
        conn.execute("INSERT INTO symbols (file, name, kind, line) VALUES ('a.ts', 'handleAuth', 'function', 1)", []).unwrap();
        conn.execute("INSERT INTO symbols (file, name, kind, line) VALUES ('b.ts', 'UserService', 'class', 1)", []).unwrap();

        // handleAuth is referenced 3 times, UserService 1 time
        for _ in 0..3 {
            conn.execute("INSERT INTO refs (from_file, to_symbol, line) VALUES ('c.ts', 'handleAuth', 1)", []).unwrap();
        }
        conn.execute("INSERT INTO refs (from_file, to_symbol, line) VALUES ('d.ts', 'UserService', 1)", []).unwrap();

        compute_pagerank(&conn).unwrap();

        let auth_rank: f64 = conn.query_row("SELECT rank FROM symbols WHERE name = 'handleAuth'", [], |r| r.get(0)).unwrap();
        let user_rank: f64 = conn.query_row("SELECT rank FROM symbols WHERE name = 'UserService'", [], |r| r.get(0)).unwrap();

        assert!(auth_rank > user_rank, "handleAuth should rank higher (more refs)");
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test knowledge::reference_graph -- --nocapture 2>&1 | tail -10`
Expected: test passes

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/knowledge/reference_graph.rs
git commit -m "feat: add reference graph builder and PageRank scorer"
```

---

## Task 6: Indexer (Parse → Store → Embed Pipeline)

**Files:**
- Create: `src-tauri/src/knowledge/indexer.rs`

- [ ] **Step 1: Write the indexer that orchestrates parse → store → FTS → embed**

Create `src-tauri/src/knowledge/indexer.rs`:

```rust
use rusqlite::{Connection, params};
use std::path::Path;
use crate::embedding::EmbeddingEngine;
use super::tree_sitter::{self, Symbol, Import};
use super::reference_graph;

/// Index a single file: parse → store symbols/refs → update FTS + embeddings.
pub fn index_file(
    conn: &Connection,
    project_root: &str,
    file_path: &Path,
    embedding: Option<&EmbeddingEngine>,
) -> Result<usize, String> {
    let result = tree_sitter::parse_file(file_path)?;

    // Relative path for storage
    let rel_path = file_path
        .strip_prefix(project_root)
        .unwrap_or(file_path)
        .to_string_lossy()
        .to_string();

    let tx = conn.unchecked_transaction()
        .map_err(|e| format!("Transaction error: {e}"))?;

    // Clear old data for this file
    tx.execute("DELETE FROM symbols WHERE file = ?1", params![rel_path])
        .map_err(|e| format!("Delete symbols error: {e}"))?;
    reference_graph::clear_file_refs(&tx, &rel_path)?;
    tx.execute(
        "DELETE FROM knowledge_fts WHERE file = ?1 AND source_type = 'symbol'",
        params![rel_path],
    ).map_err(|e| format!("Delete FTS error: {e}"))?;

    // Insert symbols
    for sym in &result.symbols {
        let id = insert_symbol(&tx, &rel_path, sym)?;

        // FTS index: "name signature" as content
        let fts_content = format!(
            "{} {}",
            sym.name,
            sym.signature.as_deref().unwrap_or("")
        );
        tx.execute(
            "INSERT INTO knowledge_fts (content, source_type, source_id, file) VALUES (?1, 'symbol', ?2, ?3)",
            params![fts_content, id.to_string(), rel_path],
        ).map_err(|e| format!("FTS insert error: {e}"))?;

        // Embed if engine available
        if let Some(engine) = embedding {
            if let Some(vec) = engine.embed(&fts_content) {
                insert_embedding(&tx, &format!("sym:{id}"), &vec)?;
            }
        }
    }

    // Insert references from imports
    for imp in &result.imports {
        for sym_name in &imp.symbols {
            reference_graph::insert_ref(
                &tx,
                &rel_path,
                None,
                sym_name,
                None, // Resolved later or left unresolved
                imp.line,
            )?;
        }
    }

    tx.commit().map_err(|e| format!("Commit error: {e}"))?;
    Ok(result.symbols.len())
}

fn insert_symbol(conn: &Connection, file: &str, sym: &Symbol) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO symbols (file, name, kind, signature, line, end_line, exported) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            file,
            sym.name,
            sym.kind.as_str(),
            sym.signature,
            sym.line as i64,
            sym.end_line.map(|l| l as i64),
            sym.exported,
        ],
    ).map_err(|e| format!("Insert symbol error: {e}"))?;
    Ok(conn.last_insert_rowid())
}

fn insert_embedding(conn: &Connection, id: &str, vec: &[f32]) -> Result<(), String> {
    // sqlite-vec stores embeddings as raw bytes
    let bytes: Vec<u8> = vec.iter().flat_map(|f| f.to_le_bytes()).collect();
    conn.execute(
        "INSERT OR REPLACE INTO knowledge_vec (id, embedding) VALUES (?1, ?2)",
        params![id, bytes],
    ).map_err(|e| format!("Embed insert error: {e}"))?;
    Ok(())
}

/// Full project index: walk all source files, parse and index each.
pub fn index_project(
    conn: &Connection,
    project_root: &str,
    embedding: Option<&EmbeddingEngine>,
) -> Result<usize, String> {
    let mut total_symbols = 0;
    let root = Path::new(project_root);

    for entry in walkdir(root)? {
        if tree_sitter::detect_language(&entry).is_some() {
            match index_file(conn, project_root, &entry, embedding) {
                Ok(count) => total_symbols += count,
                Err(e) => eprintln!("[knowledge] Skip {}: {e}", entry.display()),
            }
        }
    }

    // Compute PageRank after all files indexed
    reference_graph::build_and_rank(conn)?;

    Ok(total_symbols)
}

/// Walk directory respecting .gitignore patterns.
fn walkdir(root: &Path) -> Result<Vec<std::path::PathBuf>, String> {
    let mut files = Vec::new();
    walk_recursive(root, root, &mut files)?;
    Ok(files)
}

fn walk_recursive(
    root: &Path,
    dir: &Path,
    files: &mut Vec<std::path::PathBuf>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Read dir error: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip common non-source directories
        if path.is_dir() {
            if matches!(
                name.as_str(),
                "node_modules" | ".git" | "target" | "dist" | "build"
                    | ".next" | "__pycache__" | "venv" | ".venv" | "vendor"
                    | ".cache" | "coverage" | ".turbo"
            ) {
                continue;
            }
            walk_recursive(root, &path, files)?;
        } else if path.is_file() {
            files.push(path);
        }
    }
    Ok(())
}
```

- [ ] **Step 2: Verify build**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: compiles

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/knowledge/indexer.rs
git commit -m "feat: add indexer pipeline (parse → store → FTS → embed)"
```

---

## Task 7: Repo Map Generator

**Files:**
- Create: `src-tauri/src/knowledge/repo_map.rs`

- [ ] **Step 1: Write budget-aware repo map generator**

Create `src-tauri/src/knowledge/repo_map.rs`:

```rust
use rusqlite::{Connection, params};
use std::collections::BTreeMap;

/// Generate a markdown repo map from indexed symbols, respecting a token budget.
/// Rough estimate: 1 token ≈ 4 characters.
pub fn generate(conn: &Connection, project_path: &str, budget_tokens: usize) -> Result<String, String> {
    let budget_chars = budget_tokens * 4;

    // Get symbols ordered by rank (highest first), grouped by file
    let mut stmt = conn.prepare(
        "SELECT file, name, kind, signature, line, end_line, exported, rank
         FROM symbols
         ORDER BY rank DESC, file ASC, line ASC"
    ).map_err(|e| format!("Query error: {e}"))?;

    let rows: Vec<(String, String, String, Option<String>, i64, Option<i64>, bool, f64)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
                row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?,
            ))
        })
        .map_err(|e| format!("Query error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    if rows.is_empty() {
        return Ok(format!(
            "# Dorotoring Code Map (auto-generated)\n# Project: {project_path}\n\nNo symbols indexed yet.\n"
        ));
    }

    // Group by file, preserving rank order for file ordering
    let mut file_order: Vec<String> = Vec::new();
    let mut file_symbols: BTreeMap<String, Vec<SymbolEntry>> = BTreeMap::new();

    for (file, name, kind, sig, line, end_line, exported, _rank) in &rows {
        if !file_order.contains(file) {
            file_order.push(file.clone());
        }
        file_symbols.entry(file.clone()).or_default().push(SymbolEntry {
            name: name.clone(),
            kind: kind.clone(),
            signature: sig.clone(),
            line: *line,
            end_line: *end_line,
            exported: *exported,
        });
    }

    // Build the map, stopping when we hit the budget
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    let mut output = format!(
        "# Dorotoring Code Map (auto-generated)\n# Project: {project_path} | Updated: {now}\n\n## Key Symbols\n\n"
    );

    // Get line counts per file
    let mut line_counts: BTreeMap<String, i64> = BTreeMap::new();
    let mut stmt = conn.prepare(
        "SELECT file, MAX(COALESCE(end_line, line)) FROM symbols GROUP BY file"
    ).map_err(|e| format!("Query error: {e}"))?;
    let lc: Vec<(String, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| format!("Query error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    for (f, l) in lc {
        line_counts.insert(f, l);
    }

    for file in &file_order {
        let symbols = match file_symbols.get(file) {
            Some(s) => s,
            None => continue,
        };

        let line_count = line_counts.get(file).copied().unwrap_or(0);
        let mut section = format!("### {file} ({line_count} lines)\n");

        for sym in symbols {
            let prefix = if sym.exported { "export " } else { "  " };
            let sig = sym.signature.as_deref().unwrap_or(&sym.name);
            let line_ref = format!("[L{}]", sym.line);
            section.push_str(&format!("  {prefix}{sig:<60} {line_ref}\n"));
        }
        section.push('\n');

        // Check budget
        if output.len() + section.len() > budget_chars {
            output.push_str("# ... truncated (budget reached)\n");
            break;
        }
        output.push_str(&section);
    }

    Ok(output)
}

struct SymbolEntry {
    name: String,
    kind: String,
    signature: Option<String>,
    line: i64,
    end_line: Option<i64>,
    exported: bool,
}

/// Write repo map to file.
pub fn write_to_file(
    conn: &Connection,
    project_path: &str,
    budget_tokens: usize,
) -> Result<std::path::PathBuf, String> {
    let map = generate(conn, project_path, budget_tokens)?;
    let hash = super::db::project_hash(project_path);
    let dir = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        .join(".dorotoring")
        .join("projects")
        .join(&hash);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Mkdir error: {e}"))?;
    let path = dir.join("repo-map.md");
    std::fs::write(&path, &map).map_err(|e| format!("Write error: {e}"))?;
    Ok(path)
}
```

- [ ] **Step 2: Verify build**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/knowledge/repo_map.rs
git commit -m "feat: add budget-aware repo map generator"
```

---

## Task 8: File Watcher

**Files:**
- Create: `src-tauri/src/knowledge/file_watcher.rs`

- [ ] **Step 1: Write file watcher with debounce**

Create `src-tauri/src/knowledge/file_watcher.rs`:

```rust
use notify::{Watcher, RecursiveMode, Event, EventKind};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::collections::HashSet;
use tokio::sync::mpsc;

/// Start watching a project directory for source file changes.
/// Returns a channel receiver that emits changed file paths (debounced).
pub fn watch_project(
    project_root: &Path,
) -> Result<(notify::RecommendedWatcher, mpsc::Receiver<Vec<PathBuf>>), String> {
    let (tx, rx) = mpsc::channel::<Vec<PathBuf>>(32);
    let root = project_root.to_path_buf();

    let (debounce_tx, mut debounce_rx) = mpsc::channel::<PathBuf>(256);

    // Notify watcher sends raw events
    let watcher_tx = debounce_tx.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {
                    for path in event.paths {
                        if is_source_file(&path) {
                            watcher_tx.blocking_send(path).ok();
                        }
                    }
                }
                _ => {}
            }
        }
    }).map_err(|e| format!("Watcher error: {e}"))?;

    watcher.watch(project_root, RecursiveMode::Recursive)
        .map_err(|e| format!("Watch error: {e}"))?;

    // Debounce task: collect changes for 2 seconds, then emit batch
    tokio::spawn(async move {
        loop {
            let mut changed = HashSet::new();

            // Wait for first event
            match debounce_rx.recv().await {
                Some(path) => { changed.insert(path); }
                None => break,
            }

            // Collect more events for 2 seconds
            let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(2);
            loop {
                match tokio::time::timeout_at(deadline, debounce_rx.recv()).await {
                    Ok(Some(path)) => { changed.insert(path); }
                    _ => break,
                }
            }

            let batch: Vec<PathBuf> = changed.into_iter().collect();
            if !batch.is_empty() {
                tx.send(batch).await.ok();
            }
        }
    });

    Ok((watcher, rx))
}

fn is_source_file(path: &Path) -> bool {
    // Skip non-source directories
    let path_str = path.to_string_lossy();
    if path_str.contains("node_modules")
        || path_str.contains("/.git/")
        || path_str.contains("/target/")
        || path_str.contains("/dist/")
        || path_str.contains("/build/")
        || path_str.contains("__pycache__")
    {
        return false;
    }

    super::tree_sitter::detect_language(path).is_some()
}
```

- [ ] **Step 2: Verify build**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/knowledge/file_watcher.rs
git commit -m "feat: add file watcher with 2s debounce for source files"
```

---

## Task 9: Session Capture

**Files:**
- Create: `src-tauri/src/knowledge/session_capture.rs`

- [ ] **Step 1: Write session capture logic**

Create `src-tauri/src/knowledge/session_capture.rs`:

```rust
use rusqlite::{Connection, params};
use crate::embedding::EmbeddingEngine;

/// Capture a completed agent session into knowledge.db.
pub fn capture_session(
    conn: &Connection,
    session_id: &str,
    agent_id: &str,
    prompt: Option<&str>,
    status: &str,
    files_modified: &[String],
    commits: &[String],
    transcript: Option<&str>,
    started_at: &str,
    ended_at: &str,
    embedding: Option<&EmbeddingEngine>,
) -> Result<(), String> {
    let files_json = serde_json::to_string(files_modified)
        .unwrap_or_else(|_| "[]".to_string());
    let commits_json = serde_json::to_string(commits)
        .unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT OR REPLACE INTO sessions (id, agent_id, prompt, status, files_modified, commits, transcript, started_at, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![session_id, agent_id, prompt, status, files_json, commits_json, transcript, started_at, ended_at],
    ).map_err(|e| format!("Session insert error: {e}"))?;

    // Index in FTS: prompt + commit messages as searchable content
    let mut fts_content = String::new();
    if let Some(p) = prompt {
        fts_content.push_str(p);
        fts_content.push('\n');
    }
    for c in commits {
        fts_content.push_str(c);
        fts_content.push('\n');
    }
    // Add first 2000 chars of transcript for context
    if let Some(t) = transcript {
        let truncated: String = t.chars().take(2000).collect();
        fts_content.push_str(&truncated);
    }

    if !fts_content.is_empty() {
        conn.execute(
            "INSERT INTO knowledge_fts (content, source_type, source_id, file) VALUES (?1, 'session', ?2, '')",
            params![fts_content, session_id],
        ).map_err(|e| format!("Session FTS error: {e}"))?;

        // Embed the session summary
        if let Some(engine) = embedding {
            // Embed the prompt + commits (more focused than full transcript)
            let embed_text = format!(
                "{}\n{}",
                prompt.unwrap_or(""),
                commits.join("\n")
            );
            if let Some(vec) = engine.embed(&embed_text) {
                let bytes: Vec<u8> = vec.iter().flat_map(|f| f.to_le_bytes()).collect();
                conn.execute(
                    "INSERT OR REPLACE INTO knowledge_vec (id, embedding) VALUES (?1, ?2)",
                    params![format!("session:{session_id}"), bytes],
                ).map_err(|e| format!("Session embed error: {e}"))?;
            }
        }
    }

    Ok(())
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/knowledge/session_capture.rs
git commit -m "feat: add session capture to knowledge.db"
```

---

## Task 10: Claude Code Memory Indexation

**Files:**
- Create: `src-tauri/src/knowledge/claude_memory.rs`

- [ ] **Step 1: Write Claude Code memory file indexer**

Create `src-tauri/src/knowledge/claude_memory.rs`:

```rust
use rusqlite::{Connection, params};
use std::path::{Path, PathBuf};
use crate::embedding::EmbeddingEngine;

/// Find the Claude Code memory directory for a project path.
/// Claude Code stores memories at ~/.claude/projects/{encoded-path}/memory/
pub fn find_memory_dir(project_path: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let claude_projects = home.join(".claude").join("projects");

    if !claude_projects.exists() {
        return None;
    }

    // Claude Code encodes paths: /home/user/project → -home-user-project
    let encoded = project_path
        .replace('/', "-")
        .trim_start_matches('-')
        .to_string();

    let memory_dir = claude_projects.join(&encoded).join("memory");
    if memory_dir.exists() {
        Some(memory_dir)
    } else {
        // Try with leading dash (Claude Code convention)
        let memory_dir = claude_projects.join(format!("-{encoded}")).join("memory");
        if memory_dir.exists() {
            Some(memory_dir)
        } else {
            None
        }
    }
}

/// Index all markdown files in a Claude Code memory directory.
pub fn index_memory_dir(
    conn: &Connection,
    memory_dir: &Path,
    embedding: Option<&EmbeddingEngine>,
) -> Result<usize, String> {
    // Clear old claude_memory entries
    conn.execute("DELETE FROM knowledge_fts WHERE source_type = 'claude_memory'", [])
        .map_err(|e| format!("Clear error: {e}"))?;

    let mut count = 0;
    let entries = std::fs::read_dir(memory_dir)
        .map_err(|e| format!("Read dir error: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let filename = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        // Strip frontmatter (--- ... ---) for cleaner indexing
        let cleaned = strip_frontmatter(&content);

        if cleaned.trim().is_empty() {
            continue;
        }

        conn.execute(
            "INSERT INTO knowledge_fts (content, source_type, source_id, file) VALUES (?1, 'claude_memory', ?2, ?3)",
            params![cleaned, filename, filename],
        ).map_err(|e| format!("FTS insert error: {e}"))?;

        // Embed
        if let Some(engine) = embedding {
            if let Some(vec) = engine.embed(&cleaned) {
                let bytes: Vec<u8> = vec.iter().flat_map(|f| f.to_le_bytes()).collect();
                conn.execute(
                    "INSERT OR REPLACE INTO knowledge_vec (id, embedding) VALUES (?1, ?2)",
                    params![format!("claude_memory:{filename}"), bytes],
                ).map_err(|e| format!("Embed error: {e}"))?;
            }
        }

        count += 1;
    }

    Ok(count)
}

fn strip_frontmatter(content: &str) -> String {
    let trimmed = content.trim_start();
    if trimmed.starts_with("---") {
        if let Some(end) = trimmed[3..].find("---") {
            return trimmed[end + 6..].to_string();
        }
    }
    content.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_frontmatter() {
        let input = "---\nname: test\ntype: user\n---\n\nActual content here";
        let result = strip_frontmatter(input);
        assert!(result.contains("Actual content here"));
        assert!(!result.contains("name: test"));
    }

    #[test]
    fn test_strip_frontmatter_no_frontmatter() {
        let input = "Just regular content";
        assert_eq!(strip_frontmatter(input), input);
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test knowledge::claude_memory -- --nocapture 2>&1 | tail -10`
Expected: tests pass

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/knowledge/claude_memory.rs
git commit -m "feat: add Claude Code memory file indexer"
```

---

## Task 11: Hybrid Search

**Files:**
- Create: `src-tauri/src/knowledge/search.rs`

- [ ] **Step 1: Write hybrid FTS5 + embedding search**

Create `src-tauri/src/knowledge/search.rs`:

```rust
use rusqlite::{Connection, params};
use crate::embedding::EmbeddingEngine;

#[derive(Debug, serde::Serialize)]
pub struct SearchResult {
    pub source_type: String,
    pub content: String,
    pub file: Option<String>,
    pub line: Option<i64>,
    pub source_id: String,
    pub relevance: f64,
}

/// Hybrid search: FTS5 (BM25) + embeddings (cosine), fused with alpha weighting.
pub fn search(
    conn: &Connection,
    query: &str,
    source_type_filter: Option<&str>, // "symbol", "session", "claude_memory", or None for all
    max_results: usize,
    embedding: Option<&EmbeddingEngine>,
    alpha: f64, // Weight for embedding score (0.0 = FTS only, 1.0 = embedding only)
) -> Result<Vec<SearchResult>, String> {
    let mut results_map: std::collections::HashMap<String, SearchResult> = std::collections::HashMap::new();

    // FTS5 search
    let fts_query = if let Some(filter) = source_type_filter {
        format!(
            "SELECT content, source_type, source_id, file, rank FROM knowledge_fts WHERE knowledge_fts MATCH ?1 AND source_type = '{filter}' ORDER BY rank LIMIT ?2"
        )
    } else {
        "SELECT content, source_type, source_id, file, rank FROM knowledge_fts WHERE knowledge_fts MATCH ?1 ORDER BY rank LIMIT ?2".to_string()
    };

    let mut stmt = conn.prepare(&fts_query)
        .map_err(|e| format!("FTS query error: {e}"))?;

    let fts_results: Vec<(String, String, String, String, f64)> = stmt
        .query_map(params![query, max_results as i64 * 2], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        })
        .map_err(|e| format!("FTS query error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    // Normalize FTS scores (rank is negative, lower = better)
    let max_fts = fts_results.iter().map(|r| r.4.abs()).fold(0.0f64, f64::max).max(1.0);
    for (content, source_type, source_id, file, rank) in &fts_results {
        let fts_score = 1.0 - (rank.abs() / max_fts); // Normalize to 0-1, higher = better
        let key = format!("{source_type}:{source_id}");

        // Enrich with line number for symbols
        let line = if source_type == "symbol" {
            conn.query_row(
                "SELECT line FROM symbols WHERE id = ?1",
                params![source_id.parse::<i64>().unwrap_or(0)],
                |row| row.get(0),
            ).ok()
        } else {
            None
        };

        results_map.insert(key, SearchResult {
            source_type: source_type.clone(),
            content: content.clone(),
            file: if file.is_empty() { None } else { Some(file.clone()) },
            line,
            source_id: source_id.clone(),
            relevance: (1.0 - alpha) * fts_score,
        });
    }

    // Embedding search (if available)
    if let Some(engine) = embedding {
        if let Some(query_vec) = engine.embed(query) {
            let query_bytes: Vec<u8> = query_vec.iter().flat_map(|f| f.to_le_bytes()).collect();

            // sqlite-vec KNN search
            let mut stmt = conn.prepare(
                "SELECT id, distance FROM knowledge_vec WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2"
            ).map_err(|e| format!("Vec query error: {e}"))?;

            let vec_results: Vec<(String, f64)> = stmt
                .query_map(params![query_bytes, max_results as i64 * 2], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .map_err(|e| format!("Vec query error: {e}"))?
                .filter_map(|r| r.ok())
                .collect();

            // Normalize cosine distances to similarity scores
            let max_dist = vec_results.iter().map(|r| r.1).fold(0.0f64, f64::max).max(0.001);
            for (id, distance) in &vec_results {
                let cosine_score = 1.0 - (distance / max_dist);

                if let Some(result) = results_map.get_mut(id) {
                    // Add embedding score to existing FTS result
                    result.relevance += alpha * cosine_score;
                } else {
                    // Embedding-only result — need to look up content
                    let parts: Vec<&str> = id.splitn(2, ':').collect();
                    if parts.len() == 2 {
                        let source_type = parts[0];
                        let source_id = parts[1];

                        let content = lookup_content(conn, source_type, source_id)
                            .unwrap_or_default();
                        let file = lookup_file(conn, source_type, source_id);
                        let line = if source_type == "sym" {
                            conn.query_row(
                                "SELECT line FROM symbols WHERE id = ?1",
                                params![source_id.parse::<i64>().unwrap_or(0)],
                                |row| row.get(0),
                            ).ok()
                        } else {
                            None
                        };

                        results_map.insert(id.clone(), SearchResult {
                            source_type: match source_type {
                                "sym" => "symbol".to_string(),
                                other => other.to_string(),
                            },
                            content,
                            file,
                            line,
                            source_id: source_id.to_string(),
                            relevance: alpha * cosine_score,
                        });
                    }
                }
            }
        }
    }

    // Sort by relevance descending
    let mut results: Vec<SearchResult> = results_map.into_values().collect();
    results.sort_by(|a, b| b.relevance.partial_cmp(&a.relevance).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(max_results);

    Ok(results)
}

fn lookup_content(conn: &Connection, source_type: &str, source_id: &str) -> Option<String> {
    match source_type {
        "sym" => {
            let id: i64 = source_id.parse().ok()?;
            conn.query_row(
                "SELECT name || ' ' || COALESCE(signature, '') FROM symbols WHERE id = ?1",
                params![id],
                |row| row.get(0),
            ).ok()
        }
        "session" => {
            conn.query_row(
                "SELECT COALESCE(prompt, '') || ' ' || COALESCE(commits, '') FROM sessions WHERE id = ?1",
                params![source_id],
                |row| row.get(0),
            ).ok()
        }
        _ => None,
    }
}

fn lookup_file(conn: &Connection, source_type: &str, source_id: &str) -> Option<String> {
    if source_type == "sym" {
        let id: i64 = source_id.parse().ok()?;
        conn.query_row("SELECT file FROM symbols WHERE id = ?1", params![id], |row| row.get(0)).ok()
    } else {
        None
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/knowledge/search.rs
git commit -m "feat: add hybrid FTS5 + embedding search with score fusion"
```

---

## Task 12: API Endpoints

**Files:**
- Modify: `src-tauri/src/api_server.rs`

- [ ] **Step 1: Add KnowledgeEngine to ApiState**

In `src-tauri/src/api_server.rs`, add to the `ApiState` struct:

```rust
pub knowledge: Arc<KnowledgeEngine>,
```

And add the import:
```rust
use crate::knowledge::KnowledgeEngine;
```

- [ ] **Step 2: Add knowledge routes to the router**

After the existing routes, add:

```rust
// Knowledge Layer — Code Intelligence
.route("/api/code/repo-map", get(code_repo_map))
.route("/api/code/outline", get(code_outline))
.route("/api/code/references", get(code_references))

// Knowledge Layer — Unified Search
.route("/api/knowledge/search", get(knowledge_search))

// Knowledge Layer — Sessions
.route("/api/sessions", get(list_sessions).post(create_session))
.route("/api/sessions/{id}/pin", put(pin_session))

// Knowledge Layer — Events
.route("/api/events", get(list_events).post(create_event))
```

- [ ] **Step 3: Implement code_repo_map handler**

```rust
async fn code_repo_map(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;
    let project = params.get("project").ok_or(StatusCode::BAD_REQUEST)?;
    let budget: usize = params.get("budget").and_then(|b| b.parse().ok()).unwrap_or(2048);

    let conn = state.knowledge.get_conn(project).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let conn = conn.lock().unwrap();
    let map = crate::knowledge::repo_map::generate(&conn, project, budget)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let symbols_count: i64 = conn.query_row("SELECT COUNT(*) FROM symbols", [], |r| r.get(0)).unwrap_or(0);
    let files_count: i64 = conn.query_row("SELECT COUNT(DISTINCT file) FROM symbols", [], |r| r.get(0)).unwrap_or(0);

    Ok(Json(serde_json::json!({
        "map": map,
        "symbols_count": symbols_count,
        "files_count": files_count,
    })))
}
```

- [ ] **Step 4: Implement code_outline handler**

```rust
async fn code_outline(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;
    let file_path = params.get("file").ok_or(StatusCode::BAD_REQUEST)?;

    let path = std::path::Path::new(file_path);
    let lang = crate::knowledge::tree_sitter::detect_language(path)
        .ok_or(StatusCode::BAD_REQUEST)?;

    let result = crate::knowledge::tree_sitter::parse_file(path)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let lines = std::fs::read_to_string(path)
        .map(|s| s.lines().count())
        .unwrap_or(0);

    let symbols: Vec<serde_json::Value> = result.symbols.iter().map(|s| {
        serde_json::json!({
            "kind": s.kind.as_str(),
            "name": s.name,
            "signature": s.signature,
            "line": s.line,
            "end_line": s.end_line,
            "exported": s.exported,
        })
    }).collect();

    Ok(Json(serde_json::json!({
        "path": file_path,
        "lines": lines,
        "language": format!("{lang:?}").to_lowercase(),
        "symbols": symbols,
    })))
}
```

- [ ] **Step 5: Implement code_references handler**

```rust
async fn code_references(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;
    let symbol = params.get("symbol").ok_or(StatusCode::BAD_REQUEST)?;
    let project = params.get("project").ok_or(StatusCode::BAD_REQUEST)?;

    let conn = state.knowledge.get_conn(project).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let conn = conn.lock().unwrap();

    // Find definition
    let definition = conn.query_row(
        "SELECT file, line, kind, signature FROM symbols WHERE name = ?1 LIMIT 1",
        rusqlite::params![symbol],
        |row| Ok(serde_json::json!({
            "file": row.get::<_, String>(0)?,
            "line": row.get::<_, i64>(1)?,
            "kind": row.get::<_, String>(2)?,
            "signature": row.get::<_, Option<String>>(3)?,
        })),
    ).ok();

    // Find references
    let mut stmt = conn.prepare(
        "SELECT from_file, line FROM refs WHERE to_symbol = ?1"
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let references: Vec<serde_json::Value> = stmt
        .query_map(rusqlite::params![symbol], |row| {
            Ok(serde_json::json!({
                "file": row.get::<_, String>(0)?,
                "line": row.get::<_, i64>(1)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Json(serde_json::json!({
        "definition": definition,
        "references": references,
    })))
}
```

- [ ] **Step 6: Implement knowledge_search handler**

```rust
async fn knowledge_search(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;
    let query = params.get("query").ok_or(StatusCode::BAD_REQUEST)?;
    let project = params.get("project").ok_or(StatusCode::BAD_REQUEST)?;
    let type_filter = params.get("type").map(|s| s.as_str()).filter(|s| *s != "all");
    let max_results: usize = params.get("max_results").and_then(|s| s.parse().ok()).unwrap_or(10);

    let conn = state.knowledge.get_conn(project).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let conn = conn.lock().unwrap();

    let embedding = state.knowledge.embedding.try_lock().ok();
    let engine_ref = embedding.as_deref();

    let results = crate::knowledge::search::search(
        &conn, query, type_filter, max_results, engine_ref, 0.5,
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "results": results })))
}
```

- [ ] **Step 7: Implement session and event handlers**

```rust
async fn list_sessions(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;
    let project = params.get("project").ok_or(StatusCode::BAD_REQUEST)?;
    let limit: i64 = params.get("limit").and_then(|s| s.parse().ok()).unwrap_or(20);

    let conn = state.knowledge.get_conn(project).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let conn = conn.lock().unwrap();

    let mut stmt = conn.prepare(
        "SELECT id, agent_id, prompt, status, files_modified, commits, started_at, ended_at, pinned
         FROM sessions ORDER BY started_at DESC LIMIT ?1"
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let sessions: Vec<serde_json::Value> = stmt
        .query_map(rusqlite::params![limit], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "agent_id": row.get::<_, String>(1)?,
                "prompt": row.get::<_, Option<String>>(2)?,
                "status": row.get::<_, String>(3)?,
                "files_modified": row.get::<_, Option<String>>(4)?,
                "commits": row.get::<_, Option<String>>(5)?,
                "started_at": row.get::<_, String>(6)?,
                "ended_at": row.get::<_, Option<String>>(7)?,
                "pinned": row.get::<_, bool>(8)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Json(serde_json::json!({ "sessions": sessions })))
}

async fn create_session(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let project = body["project"].as_str().ok_or(StatusCode::BAD_REQUEST)?;
    let conn = state.knowledge.get_conn(project).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let conn = conn.lock().unwrap();

    let embedding = state.knowledge.embedding.try_lock().ok();
    let engine_ref = embedding.as_deref();

    crate::knowledge::session_capture::capture_session(
        &conn,
        body["id"].as_str().unwrap_or(""),
        body["agent_id"].as_str().unwrap_or(""),
        body["prompt"].as_str(),
        body["status"].as_str().unwrap_or("completed"),
        &body["files_modified"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        &body["commits"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        body["transcript"].as_str(),
        body["started_at"].as_str().unwrap_or(""),
        body["ended_at"].as_str().unwrap_or(""),
        engine_ref,
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "stored": true })))
}

async fn pin_session(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;
    let project = params.get("project").ok_or(StatusCode::BAD_REQUEST)?;

    let conn = state.knowledge.get_conn(project).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let conn = conn.lock().unwrap();

    conn.execute("UPDATE sessions SET pinned = TRUE WHERE id = ?1", rusqlite::params![id])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "pinned": true })))
}

async fn create_event(
    AxumState(state): AxumState<ApiState>,
    Json(body): Json<serde_json::Value>,
) -> Result<impl IntoResponse, StatusCode> {
    // No auth — events can come from hooks
    let project = body["project"].as_str().unwrap_or("");
    if project.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let conn = state.knowledge.get_conn(project).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let conn = conn.lock().unwrap();

    conn.execute(
        "INSERT INTO events (from_agent, to_agent, event_type, payload, tab_id) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            body["from_agent"].as_str().unwrap_or(""),
            body["to_agent"].as_str(),
            body["event_type"].as_str().unwrap_or(""),
            body["payload"].as_str().unwrap_or("{}"),
            body["tab_id"].as_str(),
        ],
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "stored": true })))
}

async fn list_events(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;
    let project = params.get("project").ok_or(StatusCode::BAD_REQUEST)?;
    let since: i64 = params.get("since").and_then(|s| s.parse().ok()).unwrap_or(0);
    let limit: i64 = params.get("limit").and_then(|s| s.parse().ok()).unwrap_or(50);

    let conn = state.knowledge.get_conn(project).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let conn = conn.lock().unwrap();

    let mut stmt = conn.prepare(
        "SELECT seq, from_agent, to_agent, event_type, payload, tab_id, created_at FROM events WHERE seq > ?1 ORDER BY seq ASC LIMIT ?2"
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let events: Vec<serde_json::Value> = stmt
        .query_map(rusqlite::params![since, limit], |row| {
            Ok(serde_json::json!({
                "seq": row.get::<_, i64>(0)?,
                "from_agent": row.get::<_, String>(1)?,
                "to_agent": row.get::<_, Option<String>>(2)?,
                "event_type": row.get::<_, String>(3)?,
                "payload": row.get::<_, String>(4)?,
                "tab_id": row.get::<_, Option<String>>(5)?,
                "created_at": row.get::<_, String>(6)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Json(serde_json::json!({ "events": events })))
}
```

- [ ] **Step 8: Verify build**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/api_server.rs
git commit -m "feat: add knowledge layer API endpoints (code, search, sessions, events)"
```

---

## Task 13: Repo Map Injection at Agent Spawn

**Files:**
- Modify: `src-tauri/src/agent/provider.rs`
- Modify: `src-tauri/src/commands/agent.rs`

- [ ] **Step 1: Add repo_map_file to AgentStartConfig**

In `src-tauri/src/agent/provider.rs`, add to `AgentStartConfig`:
```rust
pub repo_map_file: Option<PathBuf>,
```

- [ ] **Step 2: Append repo map file to Claude command**

In `ClaudeProvider::build_command`, after the existing `system_prompt_file` block, add:
```rust
if let Some(f) = &config.repo_map_file {
    cmd.push("--append-system-prompt-file".into());
    cmd.push(f.to_string_lossy().to_string());
}
```

- [ ] **Step 3: Pass repo map path when building start config**

In `src-tauri/src/commands/agent.rs`, in the `build_start_config` function, after `system_prompt_file`:

```rust
// Generate repo map file path for this project
let repo_map_file = {
    let hash = crate::knowledge::db::project_hash(&agent.cwd);
    let path = dirs::home_dir()
        .map(|h| h.join(".dorotoring").join("projects").join(&hash).join("repo-map.md"))
        .filter(|p| p.exists());
    path
};
```

And include it in the `AgentStartConfig` struct construction:
```rust
AgentStartConfig {
    prompt: prompt.unwrap_or("").to_string(),
    cwd: PathBuf::from(&agent.cwd),
    skip_permissions,
    mcp_config,
    system_prompt_file,
    repo_map_file,
    model: None,
    secondary_paths: agent.secondary_paths.clone(),
    continue_session,
}
```

- [ ] **Step 4: Update test default_config helper**

In `provider.rs` tests, add to `default_config`:
```rust
repo_map_file: None,
```

- [ ] **Step 5: Run tests**

Run: `cd src-tauri && cargo test agent::provider -- --nocapture 2>&1 | tail -10`
Expected: all existing tests pass

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agent/provider.rs src-tauri/src/commands/agent.rs
git commit -m "feat: inject repo map file at agent spawn via --append-system-prompt-file"
```

---

## Task 14: Wire KnowledgeEngine into App Startup

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/api_server.rs` (start function signature)

- [ ] **Step 1: Initialize KnowledgeEngine in lib.rs setup**

In `src-tauri/src/lib.rs`, add to the setup block after existing initializations:

```rust
// Initialize embedding engine
let data_dir = dirs::home_dir()
    .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
    .join(".dorotoring");
let embedding_engine = Arc::new(tokio::sync::Mutex::new(
    embedding::EmbeddingEngine::new(&data_dir)
));
let knowledge_engine = Arc::new(knowledge::KnowledgeEngine::new(
    data_dir, Arc::clone(&embedding_engine)
));
```

And in the setup closure, spawn the embedding init:
```rust
// Initialize embedding engine (background — may download model)
let embed_clone = Arc::clone(&embedding_engine);
tauri::async_runtime::spawn(async move {
    let mut engine = embed_clone.lock().await;
    if let Err(e) = engine.init().await {
        eprintln!("[embedding] Init failed (will retry later): {e}");
    }
});
```

- [ ] **Step 2: Pass KnowledgeEngine to API server**

Update the `api_server::start` call to include the knowledge engine.

- [ ] **Step 3: Register MCP code-intelligence server**

In `commands/orchestrator.rs`, extend `setup_inner` to also register the code-intel MCP server in `~/.claude/mcp.json`.

- [ ] **Step 4: Verify build**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/api_server.rs src-tauri/src/commands/orchestrator.rs
git commit -m "feat: wire KnowledgeEngine into app startup and API server"
```

---

## Task 15: MCP Server — mcp-code-intelligence

**Files:**
- Create: `mcp-code-intelligence/package.json`
- Create: `mcp-code-intelligence/tsconfig.json`
- Create: `mcp-code-intelligence/src/index.ts`
- Create: `mcp-code-intelligence/src/utils/api.ts`
- Create: `mcp-code-intelligence/src/tools/repo-map.ts`
- Create: `mcp-code-intelligence/src/tools/outline.ts`
- Create: `mcp-code-intelligence/src/tools/symbols.ts`
- Create: `mcp-code-intelligence/src/tools/search.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "mcp-code-intelligence",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "dorotoring-code-intel": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc && esbuild dist/index.js --bundle --platform=node --format=esm --outfile=dist/bundle.js --banner:js=\"import{createRequire}from'module';const require=createRequire(import.meta.url);\"",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create utils/api.ts**

```typescript
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const API_URL = process.env.DOROTORING_API_URL || "http://127.0.0.1:31415";
const API_TOKEN_FILE = path.join(os.homedir(), ".dorotoring", "api-token");

function readApiToken(): string | null {
  try {
    if (fs.existsSync(API_TOKEN_FILE)) {
      return fs.readFileSync(API_TOKEN_FILE, "utf-8").trim();
    }
  } catch { /* ignore */ }
  return null;
}

export async function apiRequest(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = `${API_URL}${endpoint}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = readApiToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        (data as { error?: string }).error || `API error: ${response.status}`,
      );
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Create tools/repo-map.ts**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../utils/api.js";

export function registerRepoMapTool(server: McpServer): void {
  server.tool(
    "dorotoring_repo_map",
    "Get a structural map of the project codebase. Shows key symbols (functions, classes, types) ranked by importance with file locations and line numbers. Use this to understand the project structure without exploring files.",
    {
      project: z.string().optional().describe("Project root path (defaults to cwd)"),
      budget: z.number().optional().describe("Max tokens for the map (default 2048)"),
    },
    async ({ project, budget }) => {
      const params = new URLSearchParams();
      if (project) params.set("project", project);
      if (budget) params.set("budget", budget.toString());

      const data = await apiRequest(`/api/code/repo-map?${params}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
```

- [ ] **Step 5: Create tools/outline.ts**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../utils/api.js";

export function registerOutlineTool(server: McpServer): void {
  server.tool(
    "dorotoring_file_outline",
    "Get the skeleton of a file: function signatures, class definitions, types, exports — without the implementation code. Use this instead of reading a full file when you only need to know what's defined. Returns ~90% fewer tokens than reading the whole file.",
    {
      path: z.string().describe("Absolute path to the file"),
    },
    async ({ path }) => {
      const data = await apiRequest(`/api/code/outline?file=${encodeURIComponent(path)}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
```

- [ ] **Step 6: Create tools/symbols.ts**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../utils/api.js";

export function registerSymbolLookupTool(server: McpServer): void {
  server.tool(
    "dorotoring_symbol_lookup",
    "Jump-to-definition and find-references for a symbol. Like a LSP but for agents. Use 'definition' to find where a symbol is defined, 'references' to find all files that import/use it.",
    {
      symbol: z.string().describe("Symbol name to look up"),
      action: z.enum(["definition", "references"]).describe("What to find"),
      project: z.string().optional().describe("Project root path"),
    },
    async ({ symbol, action, project }) => {
      const params = new URLSearchParams({ symbol });
      if (project) params.set("project", project);

      const data = await apiRequest(`/api/code/references?${params}`);

      // Filter response based on action
      const result = data as { definition?: unknown; references?: unknown[] };
      if (action === "definition") {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ definition: result.definition }),
          }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  );
}
```

- [ ] **Step 7: Create tools/search.ts**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../utils/api.js";

export function registerRecallTool(server: McpServer): void {
  server.tool(
    "dorotoring_recall",
    "Search across all project knowledge: code symbols, past agent sessions, and Claude Code memories. Uses hybrid text + semantic search. Returns results ranked by relevance.",
    {
      query: z.string().describe("Search query (natural language or symbol name)"),
      project: z.string().optional().describe("Project root path"),
      type: z.enum(["all", "symbol", "session", "claude_memory"]).optional().describe("Filter by knowledge type"),
      max_results: z.number().optional().describe("Max results (default 10)"),
    },
    async ({ query, project, type: sourceType, max_results }) => {
      const params = new URLSearchParams({ query });
      if (project) params.set("project", project);
      if (sourceType) params.set("type", sourceType);
      if (max_results) params.set("max_results", max_results.toString());

      const data = await apiRequest(`/api/knowledge/search?${params}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
```

- [ ] **Step 8: Create index.ts**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRepoMapTool } from "./tools/repo-map.js";
import { registerOutlineTool } from "./tools/outline.js";
import { registerSymbolLookupTool } from "./tools/symbols.js";
import { registerRecallTool } from "./tools/search.js";

const server = new McpServer({
  name: "dorotoring-code-intel",
  version: "1.0.0",
});

registerRepoMapTool(server);
registerOutlineTool(server);
registerSymbolLookupTool(server);
registerRecallTool(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("dorotoring-code-intel MCP server connected (stdio)");
}

main().catch(console.error);
```

- [ ] **Step 9: Install dependencies and build**

```bash
cd mcp-code-intelligence && npm install && npm run build
```

- [ ] **Step 10: Commit**

```bash
git add mcp-code-intelligence/
git commit -m "feat: add mcp-code-intelligence MCP server with 4 tools"
```

---

## Task 16: Add tail_events to mcp-orchestrator

**Files:**
- Modify: `mcp-orchestrator/src/tools/agents.ts`

- [ ] **Step 1: Add tail_events tool**

In `mcp-orchestrator/src/tools/agents.ts`, add inside the `registerAgentProxy` function:

```typescript
server.tool(
  "tail_events",
  "Get real-time events from other agents running in the same project. Use this to check what other agents are currently doing before modifying shared files. Supports long-poll: if no new events, waits up to timeout seconds.",
  {
    project: z.string().describe("Project root path"),
    since_seq: z.number().optional().describe("Only events after this sequence number"),
    agent_id: z.string().optional().describe("Filter by agent ID"),
    tab_id: z.string().optional().describe("Filter by tab ID"),
    limit: z.number().optional().describe("Max events (default 50)"),
  },
  async ({ project, since_seq, agent_id, tab_id, limit }) => {
    const params = new URLSearchParams({ project });
    if (since_seq !== undefined) params.set("since", since_seq.toString());
    if (agent_id) params.set("agent", agent_id);
    if (tab_id) params.set("tab", tab_id);
    if (limit) params.set("limit", limit.toString());

    const data = await apiRequest(`/api/events?${params}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
    };
  },
);
```

- [ ] **Step 2: Rebuild mcp-orchestrator**

```bash
cd mcp-orchestrator && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add mcp-orchestrator/src/tools/agents.ts
git commit -m "feat: add tail_events MCP tool to orchestrator"
```

---

## Task 17: Auto-Index on Agent Start + Session Capture on Completion

**Files:**
- Modify: `src-tauri/src/commands/agent.rs`

- [ ] **Step 1: Trigger project indexing when agent starts**

In `agent_start`, after the agent is set to `Running`, add:

```rust
// Trigger knowledge layer indexing for this project
let knowledge = state.knowledge.clone();
let cwd = agent.cwd.clone();
tauri::async_runtime::spawn(async move {
    let conn = match knowledge.get_conn(&cwd).await {
        Ok(c) => c,
        Err(e) => { eprintln!("[knowledge] DB open error: {e}"); return; }
    };
    let conn = conn.lock().unwrap();

    let embedding = knowledge.embedding.try_lock().ok();
    let engine_ref = embedding.as_deref();

    match crate::knowledge::indexer::index_project(&conn, &cwd, engine_ref) {
        Ok(count) => {
            eprintln!("[knowledge] Indexed {count} symbols for {cwd}");
            // Generate repo map
            if let Err(e) = crate::knowledge::repo_map::write_to_file(&conn, &cwd, 2048) {
                eprintln!("[knowledge] Repo map error: {e}");
            }
        }
        Err(e) => eprintln!("[knowledge] Index error: {e}"),
    }

    // Index Claude Code memory
    if let Some(mem_dir) = crate::knowledge::claude_memory::find_memory_dir(&cwd) {
        match crate::knowledge::claude_memory::index_memory_dir(&conn, &mem_dir, engine_ref) {
            Ok(count) => eprintln!("[knowledge] Indexed {count} Claude Code memory files"),
            Err(e) => eprintln!("[knowledge] Memory index error: {e}"),
        }
    }
});
```

- [ ] **Step 2: Capture session when agent completes**

In the `hook_status` handler in `api_server.rs`, when status transitions to a terminal state (completed/error), capture the session:

```rust
if matches!(new_state, AgentState::Completed | AgentState::Error) {
    let knowledge = state.knowledge.clone();
    let agent_clone = agent.clone();
    let status_str = status.clone();
    tauri::async_runtime::spawn(async move {
        let conn = match knowledge.get_conn(&agent_clone.cwd).await {
            Ok(c) => c,
            Err(_) => return,
        };
        let conn = conn.lock().unwrap();

        let embedding = knowledge.embedding.try_lock().ok();
        let engine_ref = embedding.as_deref();

        let session_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Prompt is not available from the agent model in v1.
        // Files/commits can be extracted from git in a future iteration.
        // For now, we capture what we have: agent id, status, timestamps.
        crate::knowledge::session_capture::capture_session(
            &conn,
            &session_id,
            &agent_clone.id,
            agent_clone.name.as_deref(), // Use agent name as proxy for prompt
            &status_str,
            &[],  // Files modified — v2: extract via git diff
            &[],  // Commits — v2: extract via git log --since
            None, // Transcript — v2: capture from lastCleanOutput hook
            &agent_clone.created_at,
            &now,
            engine_ref,
        ).ok();
    });
}
```

- [ ] **Step 3: Verify build**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/agent.rs src-tauri/src/api_server.rs
git commit -m "feat: auto-index project on agent start, capture session on completion"
```

---

## Task 18: Settings Integration

**Files:**
- Modify: `src-tauri/src/state.rs` (AppSettings struct)

- [ ] **Step 1: Add knowledge settings to AppSettings**

Add to the `AppSettings` struct:

```rust
#[serde(default = "default_true")]
pub knowledge_enabled: bool,
#[serde(default = "default_repo_map_budget")]
pub repo_map_budget: u32,
#[serde(default)]
pub knowledge_languages: Vec<String>,  // Empty = auto-detect
#[serde(default = "default_reindex_trigger")]
pub reindex_trigger: String,  // "on-save", "on-commit", "manual"
#[serde(default = "default_session_retention")]
pub session_retention_days: u32,

// ... helper functions
fn default_true() -> bool { true }
fn default_repo_map_budget() -> u32 { 2048 }
fn default_reindex_trigger() -> String { "on-save".to_string() }
fn default_session_retention() -> u32 { 90 }
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat: add knowledge layer settings to AppSettings"
```

---

## Task 19: Session Purge at Startup

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add session purge in setup block**

In the setup closure, after knowledge engine init:

```rust
// Purge old sessions at startup
let purge_knowledge = Arc::clone(&knowledge_engine);
tauri::async_runtime::spawn(async move {
    // Get all known project directories
    let projects_dir = dirs::home_dir()
        .map(|h| h.join(".dorotoring").join("projects"));
    if let Some(dir) = projects_dir {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let db_path = entry.path().join("knowledge.db");
                if db_path.exists() {
                    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                        knowledge::db::purge_old_sessions(&conn, 90).ok();
                    }
                }
            }
        }
    }
});
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: purge old sessions at startup (90 day retention)"
```

---

## Task 20: Integration Test

**Files:**
- Modify: `src-tauri/src/knowledge/mod.rs` (add integration test)

- [ ] **Step 1: Write end-to-end test**

Add to `src-tauri/src/knowledge/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_full_pipeline() {
        // Create temp project with TypeScript files
        let dir = TempDir::new().unwrap();
        let src = dir.path().join("src");
        std::fs::create_dir_all(&src).unwrap();

        std::fs::write(src.join("index.ts"), r#"
import { UserService } from './user';
export function main(): void {
    const svc = new UserService();
    svc.findById("123");
}
"#).unwrap();

        std::fs::write(src.join("user.ts"), r#"
export class UserService {
    findById(id: string): User | null {
        return null;
    }
    authenticate(email: string, password: string): boolean {
        return false;
    }
}
export interface User {
    id: string;
    email: string;
}
"#).unwrap();

        // Open knowledge DB
        let project_path = dir.path().to_string_lossy().to_string();
        let conn = db::open(&project_path).unwrap();

        // Index project (no embeddings for test)
        let count = indexer::index_project(&conn, &project_path, None).unwrap();
        assert!(count >= 4, "Should index at least 4 symbols, got {count}");

        // Check symbols exist
        let sym_count: i64 = conn.query_row("SELECT COUNT(*) FROM symbols", [], |r| r.get(0)).unwrap();
        assert!(sym_count >= 4);

        // Check PageRank ran (UserService should rank higher — more referenced)
        let user_rank: f64 = conn.query_row(
            "SELECT rank FROM symbols WHERE name = 'UserService'", [], |r| r.get(0)
        ).unwrap();
        assert!(user_rank > 0.0, "UserService should have positive PageRank");

        // Generate repo map
        let map = repo_map::generate(&conn, &project_path, 2048).unwrap();
        assert!(map.contains("UserService"), "Repo map should include UserService");
        assert!(map.contains("findById"), "Repo map should include findById");

        // FTS search
        let results = search::search(&conn, "UserService", None, 10, None, 0.0).unwrap();
        assert!(!results.is_empty(), "FTS search should find UserService");

        // Session capture
        session_capture::capture_session(
            &conn, "test-session", "agent-1",
            Some("Fix the user service"), "completed",
            &["src/user.ts".to_string()],
            &["fix: handle null user".to_string()],
            Some("I fixed the null check in findById"),
            "2026-03-29T10:00:00Z", "2026-03-29T10:05:00Z",
            None,
        ).unwrap();

        // Search should find the session
        let results = search::search(&conn, "user service fix", None, 10, None, 0.0).unwrap();
        let has_session = results.iter().any(|r| r.source_type == "session");
        assert!(has_session, "Search should find the captured session");
    }
}
```

- [ ] **Step 2: Run integration test**

Run: `cd src-tauri && cargo test knowledge::tests::test_full_pipeline -- --nocapture 2>&1 | tail -20`
Expected: test passes

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/knowledge/mod.rs
git commit -m "test: add knowledge layer integration test"
```
