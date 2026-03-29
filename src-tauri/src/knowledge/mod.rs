pub mod db;
pub mod tree_sitter;
pub mod reference_graph;
pub mod indexer;
pub mod repo_map;
pub mod file_watcher;
pub mod session_capture;
pub mod claude_memory;
// pub mod search;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use rusqlite::Connection;
use tokio::sync::Mutex;

use crate::embedding::EmbeddingEngine;

/// Central knowledge engine that manages per-project SQLite connections and the
/// shared embedding engine.
pub struct KnowledgeEngine {
    connections: Mutex<HashMap<String, Arc<std::sync::Mutex<Connection>>>>,
    pub embedding: Arc<Mutex<EmbeddingEngine>>,
    pub data_dir: PathBuf,
}

impl KnowledgeEngine {
    /// Create a new `KnowledgeEngine`.
    ///
    /// `data_dir` is typically `~/.dorotoring/`.
    /// `embedding` is the shared embedding engine (may or may not be ready).
    pub fn new(data_dir: PathBuf, embedding: Arc<Mutex<EmbeddingEngine>>) -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
            embedding,
            data_dir,
        }
    }

    /// Returns (or opens and caches) the SQLite connection for `project_path`.
    ///
    /// Subsequent calls with the same path return the cached connection.
    pub async fn get_conn(
        &self,
        project_path: &str,
    ) -> Result<Arc<std::sync::Mutex<Connection>>, String> {
        let mut map = self.connections.lock().await;

        if let Some(conn) = map.get(project_path) {
            return Ok(Arc::clone(conn));
        }

        let conn = db::open(project_path)?;
        let arc = Arc::new(std::sync::Mutex::new(conn));
        map.insert(project_path.to_string(), Arc::clone(&arc));
        Ok(arc)
    }
}
