use rusqlite::{params, Connection};

use crate::embedding::EmbeddingEngine;

/// Capture a completed agent session into the knowledge DB.
///
/// Inserts (or replaces) the session record, updates the FTS index, and
/// optionally embeds a summary into `knowledge_vec`.
///
/// # Arguments
///
/// * `conn` — open SQLite connection for the project
/// * `session_id` — unique session identifier (UUID string)
/// * `agent_id` — identifier of the agent that ran the session
/// * `prompt` — optional initial prompt / task description
/// * `status` — e.g. `"completed"`, `"failed"`, `"running"`
/// * `files_modified` — list of file paths modified during the session
/// * `commits` — list of git commit SHAs / messages produced during the session
/// * `transcript` — optional full transcript text
/// * `started_at` — ISO-8601 timestamp
/// * `ended_at` — ISO-8601 timestamp
/// * `embedding` — optional embedding engine; used when `is_ready()` returns true
#[allow(clippy::too_many_arguments)]
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
    // Serialize slices as JSON arrays.
    let files_json = serde_json::to_string(files_modified)
        .map_err(|e| format!("session_capture: failed to serialize files_modified: {e}"))?;

    let commits_json = serde_json::to_string(commits)
        .map_err(|e| format!("session_capture: failed to serialize commits: {e}"))?;

    // --- 1. Upsert the session row (preserves existing `pinned` value) ---
    conn.execute(
        "INSERT INTO sessions
            (id, agent_id, prompt, status, files_modified, commits, transcript, started_at, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            agent_id = excluded.agent_id,
            prompt = excluded.prompt,
            status = excluded.status,
            files_modified = excluded.files_modified,
            commits = excluded.commits,
            transcript = excluded.transcript,
            started_at = excluded.started_at,
            ended_at = excluded.ended_at",
        params![
            session_id,
            agent_id,
            prompt,
            status,
            files_json,
            commits_json,
            transcript,
            started_at,
            ended_at,
        ],
    )
    .map_err(|e| format!("session_capture: failed to upsert session: {e}"))?;

    // --- 2. Build FTS content ---
    let mut fts_parts: Vec<&str> = Vec::new();

    if let Some(p) = prompt {
        fts_parts.push(p);
    }

    // All commit messages.
    for commit in commits {
        fts_parts.push(commit.as_str());
    }

    // First 2000 chars of transcript.
    let transcript_prefix;
    if let Some(t) = transcript {
        transcript_prefix = t.chars().take(2000).collect::<String>();
        fts_parts.push(&transcript_prefix);
    }

    let fts_content = fts_parts.join("\n");

    // Remove old FTS entry for this session, then insert fresh.
    conn.execute(
        "DELETE FROM knowledge_fts WHERE source_type = 'session' AND source_id = ?1",
        params![session_id],
    )
    .map_err(|e| format!("session_capture: failed to delete old FTS entry: {e}"))?;

    conn.execute(
        "INSERT INTO knowledge_fts (content, source_type, source_id, file)
         VALUES (?1, 'session', ?2, '')",
        params![fts_content, session_id],
    )
    .map_err(|e| format!("session_capture: failed to insert FTS entry: {e}"))?;

    // --- 3. Embed and insert into knowledge_vec (best-effort) ---
    if let Some(engine) = embedding {
        if engine.is_ready() {
            let embed_text = format!(
                "{}\n{}",
                prompt.unwrap_or(""),
                commits.join("\n")
            );

            if let Some(vec) = engine.embed(&embed_text) {
                let blob: Vec<u8> = vec.iter().flat_map(|f| f.to_le_bytes()).collect();

                // knowledge_vec may not exist — ignore errors silently.
                let _ = conn.execute(
                    "INSERT INTO knowledge_vec (id, embedding) VALUES (?1, ?2)",
                    params![session_id, blob],
                );
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
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
            CREATE VIRTUAL TABLE knowledge_fts USING fts5(
                content,
                source_type,
                source_id,
                file
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_capture_session_basic() {
        let conn = setup_db();

        capture_session(
            &conn,
            "sess-1",
            "agent-1",
            Some("Fix the login bug"),
            "completed",
            &["src/auth.rs".to_string()],
            &["abc123 fix auth".to_string()],
            Some("Session transcript goes here"),
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:05:00Z",
            None,
        )
        .unwrap();

        // Session row inserted.
        let status: String = conn
            .query_row(
                "SELECT status FROM sessions WHERE id = 'sess-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "completed");

        // FTS row inserted.
        let fts_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM knowledge_fts WHERE source_type = 'session' AND source_id = 'sess-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fts_count, 1);
    }

    #[test]
    fn test_capture_session_replace() {
        let conn = setup_db();

        // Insert once.
        capture_session(
            &conn,
            "sess-2",
            "agent-1",
            Some("Initial task"),
            "running",
            &[],
            &[],
            None,
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
            None,
        )
        .unwrap();

        // Replace with updated status.
        capture_session(
            &conn,
            "sess-2",
            "agent-1",
            Some("Initial task"),
            "completed",
            &["src/main.rs".to_string()],
            &[],
            None,
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:10:00Z",
            None,
        )
        .unwrap();

        let status: String = conn
            .query_row(
                "SELECT status FROM sessions WHERE id = 'sess-2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "completed");

        // FTS should have exactly one entry for sess-2.
        let fts_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM knowledge_fts WHERE source_id = 'sess-2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fts_count, 1);
    }

    #[test]
    fn test_capture_session_files_as_json() {
        let conn = setup_db();

        capture_session(
            &conn,
            "sess-3",
            "agent-1",
            None,
            "completed",
            &["a.rs".to_string(), "b.rs".to_string()],
            &[],
            None,
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:01:00Z",
            None,
        )
        .unwrap();

        let files_json: String = conn
            .query_row(
                "SELECT files_modified FROM sessions WHERE id = 'sess-3'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        let files: Vec<String> = serde_json::from_str(&files_json).unwrap();
        assert_eq!(files, vec!["a.rs", "b.rs"]);
    }

    #[test]
    fn test_capture_preserves_pinned() {
        let conn = setup_db();

        // Insert and pin
        capture_session(
            &conn,
            "s1",
            "a1",
            Some("task"),
            "completed",
            &[],
            &[],
            None,
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:01:00Z",
            None,
        )
        .unwrap();
        conn.execute("UPDATE sessions SET pinned = TRUE WHERE id = 's1'", [])
            .unwrap();

        // Re-capture (update status)
        capture_session(
            &conn,
            "s1",
            "a1",
            Some("task updated"),
            "failed",
            &[],
            &[],
            None,
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:02:00Z",
            None,
        )
        .unwrap();

        // Pinned should still be true
        let pinned: bool = conn
            .query_row("SELECT pinned FROM sessions WHERE id = 's1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(pinned, "Pinned flag should be preserved on re-capture");

        // Status should be updated
        let status: String = conn
            .query_row("SELECT status FROM sessions WHERE id = 's1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(status, "failed");
    }
}
