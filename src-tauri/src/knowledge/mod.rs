pub mod db;
pub mod tree_sitter;
pub mod reference_graph;
pub mod indexer;
pub mod repo_map;
pub mod file_watcher;
pub mod session_capture;
pub mod claude_memory;
pub mod search;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_full_pipeline() {
        // 1. Create temp project with TypeScript files
        let dir = tempfile::tempdir().unwrap();
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

        // 2. Open knowledge DB for this temp project
        let project_path = dir.path().to_string_lossy().to_string();
        let conn = db::open(&project_path).unwrap();

        // 3. Index the project (no embeddings)
        let count = indexer::index_project(&conn, dir.path(), None).unwrap();
        assert!(count >= 4, "Should index at least 4 symbols, got {count}");

        // 4. Verify symbols exist
        let sym_count: i64 = conn.query_row("SELECT COUNT(*) FROM symbols", [], |r| r.get(0)).unwrap();
        assert!(sym_count >= 4, "Should have at least 4 symbols in DB");

        // 5. Verify PageRank ran
        let user_rank: f64 = conn.query_row(
            "SELECT rank FROM symbols WHERE name = 'UserService'", [], |r| r.get(0)
        ).unwrap();
        assert!(user_rank > 0.0, "UserService should have positive PageRank");

        // 6. Generate repo map
        let map = repo_map::generate(&conn, &project_path, 2048).unwrap();
        assert!(map.contains("UserService"), "Repo map should contain UserService");
        assert!(map.contains("findById"), "Repo map should contain findById");

        // 7. FTS search for symbols
        let results = search::search(&conn, "UserService", None, 10, None, 0.0).unwrap();
        assert!(!results.is_empty(), "FTS search should find UserService");
        assert_eq!(results[0].source_type, "symbol");

        // 8. Capture a session
        session_capture::capture_session(
            &conn, "test-session-1", "agent-1",
            Some("Fix the user service"), "completed",
            &["src/user.ts".to_string()],
            &["fix: handle null user".to_string()],
            Some("I fixed the null check in findById"),
            "2026-03-29T10:00:00Z", "2026-03-29T10:05:00Z",
            None,
        ).unwrap();

        // 9. Search should find both symbols and sessions
        // Use "UserService" which appears in symbol names and in the session transcript.
        let results = search::search(&conn, "UserService", None, 10, None, 0.0).unwrap();
        let has_symbol = results.iter().any(|r| r.source_type == "symbol");
        assert!(has_symbol, "Search should find symbol results");

        // Verify session search separately — search on the session prompt text.
        let session_results = search::search(&conn, "fix", None, 10, None, 0.0).unwrap();
        let has_session = session_results.iter().any(|r| r.source_type == "session");
        assert!(has_session, "Search should find session results");

        // 10. Verify session purge (should not purge recent sessions)
        let purged = db::purge_old_sessions(&conn, 90).unwrap();
        assert_eq!(purged, 0, "Should not purge a session from today");
    }
}

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
