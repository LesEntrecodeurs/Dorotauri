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

    #[test]
    fn test_cross_source_integration() {
        // Create a project with TS files
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src");
        std::fs::create_dir_all(&src).unwrap();

        std::fs::write(
            src.join("auth.ts"),
            r#"
export function handleAuth(req: Request, res: Response): void {
    validateToken(req.headers.authorization);
}

function validateToken(token: string): boolean {
    return token.startsWith('Bearer');
}
"#,
        )
        .unwrap();

        let project_path = dir.path().to_string_lossy().to_string();
        let conn = db::open(&project_path).unwrap();

        // 1. Index code
        indexer::index_project(&conn, dir.path(), None).unwrap();

        // 2. Capture a past session
        session_capture::capture_session(
            &conn,
            "session-past",
            "agent-1",
            Some("Implement OAuth token validation"),
            "completed",
            &["src/auth.ts".to_string()],
            &["feat: add token validation".to_string()],
            Some("Added Bearer token check to handleAuth"),
            "2026-03-01T10:00:00Z",
            "2026-03-01T10:30:00Z",
            None,
        )
        .unwrap();

        // 3. Simulate Claude Code memory
        conn.execute(
            "INSERT INTO knowledge_fts (content, source_type, source_id, file) VALUES ('Auth decision: use Bearer tokens with JWT, rotate every 24h', 'claude_memory', 'auth.md', 'auth.md')",
            [],
        )
        .unwrap();

        // 4. Search "token" should find code + session + memory
        let results = search::search(&conn, "token", None, 20, None, 0.0).unwrap();
        assert!(
            results.len() >= 2,
            "Should find multiple results for 'token'"
        );

        // Verify we get different source types
        let source_types: std::collections::HashSet<&str> =
            results.iter().map(|r| r.source_type.as_str()).collect();
        assert!(
            source_types.len() >= 2,
            "Should have at least 2 different source types"
        );

        // 5. Repo map should include auth symbols
        let map = repo_map::generate(&conn, &project_path, 2048).unwrap();
        assert!(
            map.contains("handleAuth"),
            "Repo map should contain handleAuth"
        );

        // 6. Purge should not delete recent session
        let purged = db::purge_old_sessions(&conn, 90).unwrap();
        assert_eq!(purged, 0);

        // 7. Search for session should still work
        let results = search::search(&conn, "OAuth", Some("session"), 10, None, 0.0).unwrap();
        assert!(
            !results.is_empty(),
            "Session search should find OAuth session"
        );
    }

    #[test]
    fn test_reindex_updates_symbols() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src");
        std::fs::create_dir_all(&src).unwrap();

        // Initial file
        let file = src.join("service.ts");
        std::fs::write(&file, "export function oldFunction(): void {}\n").unwrap();

        let project_path = dir.path().to_string_lossy().to_string();
        let conn = db::open(&project_path).unwrap();

        indexer::index_project(&conn, dir.path(), None).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM symbols WHERE name = 'oldFunction'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        // Modify file — replace function
        std::fs::write(&file, "export function newFunction(): void {}\n").unwrap();

        // Re-index single file
        indexer::index_file(&conn, dir.path(), &file, None).unwrap();

        // Old function should be gone, new one should exist
        let old_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM symbols WHERE name = 'oldFunction'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let new_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM symbols WHERE name = 'newFunction'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(old_count, 0, "Old function should be removed");
        assert_eq!(new_count, 1, "New function should be indexed");
    }

    #[test]
    fn test_session_lifecycle() {
        let dir = tempfile::tempdir().unwrap();
        let project_path = dir.path().to_string_lossy().to_string();
        let conn = db::open(&project_path).unwrap();

        // Capture 3 sessions
        for i in 0..3 {
            session_capture::capture_session(
                &conn,
                &format!("sess-{i}"),
                "agent-1",
                Some(&format!("Task {i}")),
                "completed",
                &[format!("file{i}.ts")],
                &[format!("commit {i}")],
                None,
                "2026-03-29T10:00:00Z",
                "2026-03-29T10:05:00Z",
                None,
            )
            .unwrap();
        }

        // All 3 should be searchable
        let results = search::search(&conn, "Task", None, 10, None, 0.0).unwrap();
        assert!(results.len() >= 3);

        // Pin session 0
        conn.execute(
            "UPDATE sessions SET pinned = TRUE WHERE id = 'sess-0'",
            [],
        )
        .unwrap();

        // Force old timestamps for purge testing
        conn.execute(
            "UPDATE sessions SET started_at = '2020-01-01T00:00:00Z' WHERE id != 'sess-0'",
            [],
        )
        .unwrap();

        // Purge should delete 2 unpinned old sessions
        let purged = db::purge_old_sessions(&conn, 1).unwrap();
        assert_eq!(purged, 2);

        // Session 0 (pinned) should survive
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 1);
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
    /// Set of project paths that currently have an active file watcher.
    watching: Mutex<std::collections::HashSet<String>>,
    /// Set of project paths currently being indexed.
    indexing: Mutex<std::collections::HashSet<String>>,
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
            watching: Mutex::new(std::collections::HashSet::new()),
            indexing: Mutex::new(std::collections::HashSet::new()),
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

    /// Returns true if a watcher was registered (caller should spawn one).
    /// Returns false if a watcher is already active for this path (caller should skip).
    pub async fn register_watcher(&self, project_path: &str) -> bool {
        let mut set = self.watching.lock().await;
        set.insert(project_path.to_string())
    }

    /// Returns true if indexing was registered (caller should proceed).
    /// Returns false if indexing is already in progress for this path (caller should skip).
    pub async fn register_indexing(&self, project_path: &str) -> bool {
        let mut set = self.indexing.lock().await;
        set.insert(project_path.to_string())
    }

    pub async fn finish_indexing(&self, project_path: &str) {
        let mut set = self.indexing.lock().await;
        set.remove(project_path);
    }
}
