use std::collections::HashMap;

use rusqlite::{params, Connection};

use crate::embedding::EmbeddingEngine;

/// A single result from the hybrid search.
#[derive(Debug, serde::Serialize)]
pub struct SearchResult {
    pub source_type: String, // "symbol", "session", "claude_memory"
    pub content: String,     // name+sig for symbols, prompt+commits for sessions, text for memories
    pub file: Option<String>, // For symbols
    pub line: Option<i64>,   // For symbols
    pub source_id: String,   // ID in the source table
    pub relevance: f64,      // Combined score (0-1)
}

/// Intermediate entry used during result merging.
struct Candidate {
    source_type: String,
    content: String,
    file: Option<String>,
    source_id: String,
    fts_score: Option<f64>,
    vec_score: Option<f64>,
}

/// Sanitize a query string for FTS5 MATCH by wrapping each whitespace-delimited
/// token in double quotes, escaping any embedded double quotes.
/// Empty/blank input returns `None` to signal "skip FTS".
fn sanitize_fts_query(query: &str) -> Option<String> {
    let tokens: Vec<String> = query
        .split_whitespace()
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect();
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" "))
    }
}

/// Run a hybrid FTS5 + embedding search over the knowledge base.
///
/// # Parameters
/// - `conn`: an open SQLite connection to the knowledge DB.
/// - `query`: the search query string.
/// - `source_type_filter`: optionally restrict results to one source type
///   ("symbol", "session", or "claude_memory"). Pass `None` for all.
/// - `max_results`: upper bound on results returned.
/// - `embedding`: optional embedding engine; if `None` or not ready, only FTS is used.
/// - `alpha`: mixing weight. `0.0` = FTS only, `1.0` = embedding only, `0.5` = equal mix.
///
/// # Returns
/// A `Vec<SearchResult>` sorted by relevance descending, capped at `max_results`.
pub fn search(
    conn: &Connection,
    query: &str,
    source_type_filter: Option<&str>,
    max_results: usize,
    embedding: Option<&EmbeddingEngine>,
    alpha: f64,
) -> Result<Vec<SearchResult>, String> {
    // Key for the candidate map: (source_type, source_id).
    let mut candidates: HashMap<(String, String), Candidate> = HashMap::new();

    // -----------------------------------------------------------------------
    // 1. FTS5 search
    // -----------------------------------------------------------------------
    let fts_query = match sanitize_fts_query(query) {
        Some(q) => q,
        None => String::new(), // will be skipped below
    };

    if !fts_query.is_empty() {
        let base_sql = if source_type_filter.is_some() {
            "SELECT content, source_type, source_id, file, rank \
             FROM knowledge_fts \
             WHERE knowledge_fts MATCH ?1 AND source_type = ?2 \
             ORDER BY rank \
             LIMIT ?3"
        } else {
            "SELECT content, source_type, source_id, file, rank \
             FROM knowledge_fts \
             WHERE knowledge_fts MATCH ?1 \
             ORDER BY rank \
             LIMIT ?2"
        };

        // We need a raw scores vec so we can normalise afterwards.
        let mut raw: Vec<(String, String, String, Option<String>, f64)> = Vec::new();

        if let Some(filter) = source_type_filter {
            let mut stmt = conn
                .prepare(base_sql)
                .map_err(|e| format!("FTS prepare failed: {e}"))?;
            let rows = stmt
                .query_map(
                    params![fts_query, filter, (max_results * 10) as i64],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, f64>(4)?,
                        ))
                    },
                )
                .map_err(|e| format!("FTS query failed: {e}"))?;
            for row in rows {
                raw.push(row.map_err(|e| format!("FTS row error: {e}"))?);
            }
        } else {
            let mut stmt = conn
                .prepare(base_sql)
                .map_err(|e| format!("FTS prepare failed: {e}"))?;
            let rows = stmt
                .query_map(params![fts_query, (max_results * 10) as i64], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, f64>(4)?,
                    ))
                })
                .map_err(|e| format!("FTS query failed: {e}"))?;
            for row in rows {
                raw.push(row.map_err(|e| format!("FTS row error: {e}"))?);
            }
        }

        // FTS5 rank is negative (lower = better). Normalise to [0, 1].
        // We need the min (most negative = best) and max (least negative).
        if !raw.is_empty() {
            let min_rank = raw.iter().map(|r| r.4).fold(f64::INFINITY, f64::min);
            let max_rank = raw.iter().map(|r| r.4).fold(f64::NEG_INFINITY, f64::max);
            let range = (max_rank - min_rank).abs();

            for (content, source_type, source_id, file, rank) in raw {
                // Normalise: best rank → 1.0, worst rank → 0.0
                let fts_score = if range < 1e-12 {
                    1.0
                } else {
                    (max_rank - rank) / range
                };

                let key = (source_type.clone(), source_id.clone());
                candidates.insert(
                    key,
                    Candidate {
                        source_type,
                        content,
                        file,
                        source_id,
                        fts_score: Some(fts_score),
                        vec_score: None,
                    },
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // 2. Embedding search (optional)
    // -----------------------------------------------------------------------
    if alpha > 0.0 {
        if let Some(engine) = embedding {
            if engine.is_ready() {
                if let Some(query_vec) = engine.embed(query) {
                    let query_bytes: Vec<u8> = query_vec
                        .iter()
                        .flat_map(|f| f.to_le_bytes())
                        .collect();

                    // knowledge_vec may not exist — silently skip on error.
                    let vec_result: Result<Vec<(i64, f64)>, _> = (|| {
                        let mut stmt = conn.prepare(
                            "SELECT id, distance FROM knowledge_vec \
                             WHERE embedding MATCH ? \
                             ORDER BY distance \
                             LIMIT ?",
                        )?;
                        let rows = stmt.query_map(
                            params![query_bytes, (max_results * 10) as i64],
                            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?)),
                        )?;
                        rows.collect()
                    })();

                    if let Ok(vec_rows) = vec_result {
                        if !vec_rows.is_empty() {
                            // Distances are non-negative; smaller = better.
                            // Normalise to [0, 1] similarity (1.0 = closest).
                            let min_dist =
                                vec_rows.iter().map(|r| r.1).fold(f64::INFINITY, f64::min);
                            let max_dist = vec_rows
                                .iter()
                                .map(|r| r.1)
                                .fold(f64::NEG_INFINITY, f64::max);
                            let range = (max_dist - min_dist).abs();

                            for (vec_id, distance) in vec_rows {
                                let vec_score = if range < 1e-12 {
                                    1.0
                                } else {
                                    (max_dist - distance) / range
                                };

                                // Look up the FTS entry for this vector id.
                                // knowledge_vec.id maps to knowledge_fts source_id for symbols.
                                let fts_lookup: Result<(String, String, String, Option<String>), _> =
                                    conn.query_row(
                                        "SELECT content, source_type, source_id, file \
                                         FROM knowledge_fts \
                                         WHERE source_id = ?1 AND source_type = 'symbol' \
                                         LIMIT 1",
                                        params![vec_id.to_string()],
                                        |row| {
                                            Ok((
                                                row.get::<_, String>(0)?,
                                                row.get::<_, String>(1)?,
                                                row.get::<_, String>(2)?,
                                                row.get::<_, Option<String>>(3)?,
                                            ))
                                        },
                                    );

                                if let Ok((content, source_type, source_id, file)) = fts_lookup {
                                    // Apply source_type filter if set.
                                    if let Some(filter) = source_type_filter {
                                        if source_type != filter {
                                            continue;
                                        }
                                    }

                                    let key = (source_type.clone(), source_id.clone());
                                    let entry = candidates.entry(key).or_insert(Candidate {
                                        source_type,
                                        content,
                                        file,
                                        source_id,
                                        fts_score: None,
                                        vec_score: None,
                                    });
                                    entry.vec_score = Some(vec_score);
                                }
                            }
                        }
                    }
                    // If vec_result is Err, skip silently (table may not exist).
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // 3. Merge scores
    // -----------------------------------------------------------------------
    let mut results: Vec<SearchResult> = candidates
        .into_values()
        .map(|c| {
            let relevance = match (c.fts_score, c.vec_score) {
                (Some(f), Some(v)) => (1.0 - alpha) * f + alpha * v,
                (Some(f), None) => (1.0 - alpha) * f,
                (None, Some(v)) => alpha * v,
                (None, None) => 0.0,
            };

            SearchResult {
                source_type: c.source_type,
                content: c.content,
                file: c.file,
                line: None, // enriched below
                source_id: c.source_id,
                relevance,
            }
        })
        .collect();

    // -----------------------------------------------------------------------
    // 4. Enrich: look up line numbers for symbols
    // -----------------------------------------------------------------------
    for result in &mut results {
        if result.source_type == "symbol" {
            if let Ok(id) = result.source_id.parse::<i64>() {
                let line: Result<i64, _> = conn.query_row(
                    "SELECT line FROM symbols WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                );
                result.line = line.ok();
            }
        }
    }

    // -----------------------------------------------------------------------
    // 5. Sort and truncate
    // -----------------------------------------------------------------------
    results.sort_by(|a, b| b.relevance.partial_cmp(&a.relevance).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(max_results);

    Ok(results)
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
            "
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
            CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
                content,
                source_type,
                source_id,
                file
            );
            ",
        )
        .unwrap();
        conn
    }

    fn insert_symbol(conn: &Connection, name: &str, sig: &str, file: &str, line: i64) -> i64 {
        conn.execute(
            "INSERT INTO symbols (file, name, kind, signature, line, exported) VALUES (?1, ?2, 'function', ?3, ?4, 1)",
            params![file, name, sig, line],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        let content = format!("{name} {sig}");
        conn.execute(
            "INSERT INTO knowledge_fts (content, source_type, source_id, file) VALUES (?1, 'symbol', ?2, ?3)",
            params![content, id.to_string(), file],
        )
        .unwrap();
        id
    }

    #[test]
    fn test_fts_only_search() {
        let conn = setup_db();
        insert_symbol(&conn, "authenticate", "fn authenticate(token: &str) -> bool", "auth.rs", 10);
        insert_symbol(&conn, "hash_password", "fn hash_password(pw: &str) -> String", "crypto.rs", 5);

        let results = search(&conn, "authenticate", None, 10, None, 0.0).unwrap();
        assert!(!results.is_empty(), "should find at least one result");
        assert_eq!(results[0].source_type, "symbol");
        assert!(results[0].content.contains("authenticate"));
    }

    #[test]
    fn test_source_type_filter() {
        let conn = setup_db();
        insert_symbol(&conn, "doSomething", "fn doSomething()", "main.rs", 1);
        conn.execute(
            "INSERT INTO sessions (id, agent_id, prompt, status, started_at) VALUES ('s1', 'agent1', 'doSomething task', 'done', '2024-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO knowledge_fts (content, source_type, source_id, file) VALUES ('doSomething task', 'session', 's1', NULL)",
            [],
        )
        .unwrap();

        let results = search(&conn, "doSomething", Some("session"), 10, None, 0.0).unwrap();
        assert!(results.iter().all(|r| r.source_type == "session"));
    }

    #[test]
    fn test_line_enrichment() {
        let conn = setup_db();
        insert_symbol(&conn, "myFunc", "fn myFunc() -> i32", "lib.rs", 42);

        let results = search(&conn, "myFunc", None, 10, None, 0.0).unwrap();
        let sym = results.iter().find(|r| r.source_type == "symbol").unwrap();
        assert_eq!(sym.line, Some(42));
    }

    #[test]
    fn test_max_results_respected() {
        let conn = setup_db();
        for i in 0..20 {
            insert_symbol(
                &conn,
                &format!("func_{i}"),
                &format!("fn func_{i}()"),
                "funcs.rs",
                i,
            );
        }

        let results = search(&conn, "func", None, 5, None, 0.0).unwrap();
        assert!(results.len() <= 5);
    }

    #[test]
    fn test_empty_query_returns_ok() {
        let conn = setup_db();
        let result = search(&conn, "", None, 10, None, 0.0);
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty(), "empty query should return empty results");
    }

    #[test]
    fn test_cross_source_search() {
        let conn = setup_db();

        // Insert a symbol
        conn.execute(
            "INSERT INTO symbols (file, name, kind, signature, line, exported) VALUES ('auth.ts', 'handleAuth', 'function', 'function handleAuth(req, res)', 23, TRUE)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO knowledge_fts (content, source_type, source_id, file) VALUES ('handleAuth function handleAuth(req, res)', 'symbol', '1', 'auth.ts')",
            [],
        )
        .unwrap();

        // Insert a session about auth
        conn.execute(
            "INSERT INTO sessions (id, agent_id, status, started_at) VALUES ('sess-auth', 'a1', 'completed', '2026-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO knowledge_fts (content, source_type, source_id, file) VALUES ('Fixed authentication bug in handleAuth', 'session', 'sess-auth', '')",
            [],
        )
        .unwrap();

        // Insert a Claude memory about auth
        conn.execute(
            "INSERT INTO knowledge_fts (content, source_type, source_id, file) VALUES ('Auth strategy: migrating to OAuth Google', 'claude_memory', 'auth_decisions.md', 'auth_decisions.md')",
            [],
        )
        .unwrap();

        // Search should find all three types
        let results = search(&conn, "auth", None, 10, None, 0.0).unwrap();
        assert!(
            results.len() >= 3,
            "Should find symbol + session + claude_memory, got {}",
            results.len()
        );

        let types: Vec<&str> = results.iter().map(|r| r.source_type.as_str()).collect();
        assert!(types.contains(&"symbol"), "Should contain symbol result");
        assert!(types.contains(&"session"), "Should contain session result");
        assert!(
            types.contains(&"claude_memory"),
            "Should contain claude_memory result"
        );
    }
}
