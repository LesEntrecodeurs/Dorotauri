use std::path::PathBuf;

use rusqlite::Connection;
use sha2::{Digest, Sha256};

/// Returns the first 12 hex characters of the SHA-256 hash of `project_path`.
pub fn project_hash(project_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(project_path.as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..6]) // 6 bytes → 12 hex chars
}

/// Returns the path to the knowledge DB for the given project.
/// `~/.dorotoring/projects/{hash}/knowledge.db`
pub fn db_path_for_project(project_path: &str) -> PathBuf {
    let hash = project_hash(project_path);
    dirs::home_dir()
        .expect("Could not determine home directory")
        .join(".dorotoring")
        .join("projects")
        .join(hash)
        .join("knowledge.db")
}

/// Schema version managed via PRAGMA user_version.
const SCHEMA_VERSION: u32 = 1;

const MIGRATION_V1: &str = "
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
";

/// Opens (or creates) the SQLite knowledge DB for the given project path.
///
/// Sets WAL mode, foreign keys, and busy_timeout pragmas, then runs schema
/// migrations as needed.
pub fn open(project_path: &str) -> Result<Connection, String> {
    let db_path = db_path_for_project(project_path);

    // Ensure the parent directory exists.
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create knowledge DB directory: {e}"))?;
    }

    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open knowledge DB at {}: {e}", db_path.display()))?;

    // Set connection pragmas.
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        ",
    )
    .map_err(|e| format!("Failed to set pragmas: {e}"))?;

    // Run migrations based on user_version.
    let version: u32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| format!("Failed to read user_version: {e}"))?;

    if version < SCHEMA_VERSION {
        conn.execute_batch(MIGRATION_V1)
            .map_err(|e| format!("Migration v1 failed: {e}"))?;

        conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
            .map_err(|e| format!("Failed to set user_version: {e}"))?;
    }

    // Best-effort: try to load sqlite-vec for vector search
    try_load_sqlite_vec(&conn);

    Ok(conn)
}

/// Try to load the sqlite-vec extension and create the knowledge_vec table.
/// This is best-effort — if the extension is not available, vector search
/// is silently disabled and only FTS5 search works.
pub fn try_load_sqlite_vec(conn: &Connection) -> bool {
    let ext_dir = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        .join(".dorotoring")
        .join("extensions");

    let ext_name = if cfg!(target_os = "macos") {
        "vec0.dylib"
    } else {
        "vec0.so"
    };
    let ext_path = ext_dir.join(ext_name);

    if !ext_path.exists() {
        return false;
    }

    unsafe {
        if conn.load_extension(&ext_path, None::<&str>).is_err() {
            return false;
        }
    }

    // Create the vec table if it doesn't exist
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
            id TEXT PRIMARY KEY,
            embedding float[384]
        )",
    )
    .is_ok()
}

/// Deletes sessions older than `retention_days` days (excluding pinned sessions),
/// and removes orphaned FTS entries for those sessions.
///
/// Returns the number of sessions deleted.
pub fn purge_old_sessions(conn: &Connection, retention_days: u32) -> Result<usize, String> {
    // Guard: retention_days=0 would delete everything; treat as "keep all".
    if retention_days == 0 {
        return Ok(0);
    }
    let cutoff_modifier = format!("-{retention_days} days");

    let deleted: usize = conn
        .execute(
            "DELETE FROM sessions WHERE pinned = FALSE AND started_at < datetime('now', ?1)",
            rusqlite::params![cutoff_modifier],
        )
        .map_err(|e| format!("Failed to purge old sessions: {e}"))?;

    // Clean FTS entries for sessions that no longer exist.
    conn.execute_batch(
        "DELETE FROM knowledge_fts
         WHERE source_type = 'session'
           AND source_id NOT IN (SELECT id FROM sessions)",
    )
    .map_err(|e| format!("Failed to clean FTS after session purge: {e}"))?;

    Ok(deleted)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_hash_deterministic() {
        let h1 = project_hash("/home/user/project");
        let h2 = project_hash("/home/user/project");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 12); // 6 bytes = 12 hex chars
    }

    #[test]
    fn test_project_hash_different_paths() {
        let h1 = project_hash("/home/user/project-a");
        let h2 = project_hash("/home/user/project-b");
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_open_creates_tables() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let conn = open(&project).unwrap();

        // Check all tables exist
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"symbols".to_string()));
        assert!(tables.contains(&"refs".to_string()));
        assert!(tables.contains(&"sessions".to_string()));
        assert!(tables.contains(&"events".to_string()));
    }

    #[test]
    fn test_open_sets_wal_mode() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let conn = open(&project).unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
    }

    #[test]
    fn test_open_schema_version() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let conn = open(&project).unwrap();
        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn test_open_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let _conn1 = open(&project).unwrap();
        let conn2 = open(&project).unwrap(); // Should not fail on re-open
        let version: u32 = conn2
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn test_purge_old_sessions_skips_pinned() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let conn = open(&project).unwrap();

        // Insert an old session (pinned)
        conn.execute(
            "INSERT INTO sessions (id, agent_id, status, started_at, pinned) VALUES ('s1', 'a1', 'completed', '2020-01-01T00:00:00Z', TRUE)",
            [],
        )
        .unwrap();

        // Insert an old session (not pinned)
        conn.execute(
            "INSERT INTO sessions (id, agent_id, status, started_at, pinned) VALUES ('s2', 'a1', 'completed', '2020-01-01T00:00:00Z', FALSE)",
            [],
        )
        .unwrap();

        let deleted = purge_old_sessions(&conn, 1).unwrap();
        assert_eq!(deleted, 1); // Only s2 deleted

        // s1 should still exist
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_purge_zero_retention_keeps_all() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let conn = open(&project).unwrap();

        conn.execute(
            "INSERT INTO sessions (id, agent_id, status, started_at, pinned) VALUES ('s1', 'a1', 'completed', '2020-01-01T00:00:00Z', FALSE)",
            [],
        ).unwrap();

        // retention_days=0 should NOT delete anything
        let deleted = purge_old_sessions(&conn, 0).unwrap();
        assert_eq!(deleted, 0, "retention_days=0 should not delete sessions");
    }

    #[test]
    fn test_purge_keeps_recent_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let conn = open(&project).unwrap();

        // Insert a recent session
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO sessions (id, agent_id, status, started_at, pinned) VALUES ('s1', 'a1', 'completed', ?1, FALSE)",
            rusqlite::params![now],
        )
        .unwrap();

        let deleted = purge_old_sessions(&conn, 90).unwrap();
        assert_eq!(deleted, 0);
    }
}
