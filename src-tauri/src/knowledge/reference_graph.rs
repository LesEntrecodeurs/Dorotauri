use rusqlite::{params, Connection};

/// Insert one reference row into the `refs` table.
pub fn insert_ref(
    conn: &Connection,
    from_file: &str,
    from_symbol: Option<&str>,
    to_symbol: &str,
    to_file: Option<&str>,
    line: Option<usize>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO refs (from_file, from_symbol, to_symbol, to_file, line)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            from_file,
            from_symbol,
            to_symbol,
            to_file,
            line.map(|l| l as i64),
        ],
    )
    .map_err(|e| format!("insert_ref failed: {e}"))?;
    Ok(())
}

/// Delete all refs where from_file = file.
pub fn clear_file_refs(conn: &Connection, file: &str) -> Result<(), String> {
    conn.execute("DELETE FROM refs WHERE from_file = ?1", params![file])
        .map_err(|e| format!("clear_file_refs failed: {e}"))?;
    Ok(())
}

/// Compute a simplified PageRank-like score for all symbols.
///
/// This is NOT true iterative PageRank — it's a single-pass in-degree
/// centrality metric with damping factor. Symbols referenced more often
/// get higher scores. Adequate for v1 repo map ranking; a proper iterative
/// implementation can replace this later without changing the interface.
///
/// Algorithm:
///   rank = damping * (incoming / total_refs) + (1 - damping) / N
/// where damping = 0.85, N = total number of symbols.
pub fn compute_pagerank(conn: &Connection) -> Result<(), String> {
    const DAMPING: f64 = 0.85;

    // 1. Count all symbols.
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM symbols", [], |row| row.get(0))
        .map_err(|e| format!("compute_pagerank: count symbols failed: {e}"))?;

    if n == 0 {
        return Ok(());
    }

    // 2. Count total refs.
    let total_refs: i64 = conn
        .query_row("SELECT COUNT(*) FROM refs", [], |row| row.get(0))
        .map_err(|e| format!("compute_pagerank: count refs failed: {e}"))?;

    // 3. Gather all symbol names and their incoming reference counts.
    //    We join symbols with the count of refs pointing to each symbol name.
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.name,
                    COALESCE(r.cnt, 0) AS incoming
             FROM symbols s
             LEFT JOIN (
                 SELECT to_symbol, COUNT(*) AS cnt
                 FROM refs
                 GROUP BY to_symbol
             ) r ON r.to_symbol = s.name",
        )
        .map_err(|e| format!("compute_pagerank: prepare failed: {e}"))?;

    struct Row {
        id: i64,
        incoming: i64,
    }

    let rows: Vec<Row> = stmt
        .query_map([], |row| {
            Ok(Row {
                id: row.get(0)?,
                incoming: row.get(2)?,
            })
        })
        .map_err(|e| format!("compute_pagerank: query failed: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    // 4. Update ranks in a transaction.
    let base_rank = (1.0 - DAMPING) / (n as f64);

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("compute_pagerank: begin transaction failed: {e}"))?;

    for row in &rows {
        let rank = if total_refs > 0 {
            DAMPING * (row.incoming as f64 / total_refs as f64) + base_rank
        } else {
            base_rank
        };

        tx.execute(
            "UPDATE symbols SET rank = ?1 WHERE id = ?2",
            params![rank, row.id],
        )
        .map_err(|e| format!("compute_pagerank: update failed: {e}"))?;
    }

    tx.commit()
        .map_err(|e| format!("compute_pagerank: commit failed: {e}"))?;

    Ok(())
}

/// Convenience wrapper: compute PageRank and update symbol ranks.
pub fn build_and_rank(conn: &Connection) -> Result<(), String> {
    compute_pagerank(conn)
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
            CREATE TABLE symbols (
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
            CREATE TABLE refs (
                id INTEGER PRIMARY KEY,
                from_file TEXT NOT NULL,
                from_symbol TEXT,
                to_symbol TEXT NOT NULL,
                to_file TEXT,
                line INTEGER
            );
            ",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_pagerank_basic() {
        let conn = setup_db();

        // Insert 2 symbols
        conn.execute(
            "INSERT INTO symbols (file, name, kind, line) VALUES ('a.ts', 'handleAuth', 'function', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO symbols (file, name, kind, line) VALUES ('b.ts', 'UserService', 'class', 1)",
            [],
        )
        .unwrap();

        // Insert 3 refs to handleAuth, 1 ref to UserService
        for i in 0..3 {
            insert_ref(&conn, "other.ts", None, "handleAuth", None, Some(i + 1)).unwrap();
        }
        insert_ref(&conn, "another.ts", None, "UserService", None, Some(1)).unwrap();

        // Run pagerank
        build_and_rank(&conn).unwrap();

        // Check results
        let handle_rank: f64 = conn
            .query_row(
                "SELECT rank FROM symbols WHERE name = 'handleAuth'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        let user_rank: f64 = conn
            .query_row(
                "SELECT rank FROM symbols WHERE name = 'UserService'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert!(
            handle_rank > user_rank,
            "handleAuth ({handle_rank}) should have higher rank than UserService ({user_rank})"
        );
    }

    #[test]
    fn test_clear_file_refs() {
        let conn = setup_db();

        insert_ref(&conn, "a.ts", None, "foo", None, None).unwrap();
        insert_ref(&conn, "a.ts", None, "bar", None, None).unwrap();
        insert_ref(&conn, "b.ts", None, "baz", None, None).unwrap();

        clear_file_refs(&conn, "a.ts").unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM refs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "Only b.ts ref should remain");
    }
}
