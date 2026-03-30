use std::collections::BTreeMap;
use std::path::PathBuf;

use chrono::Utc;
use rusqlite::Connection;

use crate::knowledge::db::project_hash;

/// Row returned by the symbols query.
struct SymbolRow {
    file: String,
    name: String,
    kind: String,
    signature: Option<String>,
    line: i64,
    exported: bool,
}

/// Generate a budget-aware markdown repo map from indexed symbols.
///
/// Symbols are ordered by rank DESC, then file ASC, then line ASC.
/// The output is truncated once `output.len() > budget_tokens * 4`
/// (1 token ≈ 4 chars).
pub fn generate(
    conn: &Connection,
    project_path: &str,
    budget_tokens: usize,
) -> Result<String, String> {
    let budget_chars = budget_tokens * 4;

    // Query symbols ordered by rank DESC, file ASC, line ASC.
    let mut stmt = conn
        .prepare(
            "SELECT file, name, kind, signature, line, exported
             FROM symbols
             ORDER BY rank DESC, file ASC, line ASC",
        )
        .map_err(|e| format!("repo_map: prepare symbols query failed: {e}"))?;

    let rows: Vec<SymbolRow> = stmt
        .query_map([], |row| {
            Ok(SymbolRow {
                file: row.get(0)?,
                name: row.get(1)?,
                kind: row.get(2)?,
                signature: row.get(3)?,
                line: row.get(4)?,
                exported: row.get(5)?,
            })
        })
        .map_err(|e| format!("repo_map: query failed: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    // Group symbols by file, preserving rank-based insertion order for the files
    // encountered first.
    let mut file_order: Vec<String> = Vec::new();
    let mut by_file: BTreeMap<String, Vec<SymbolRow>> = BTreeMap::new();

    for row in rows {
        if !by_file.contains_key(&row.file) {
            file_order.push(row.file.clone());
        }
        by_file.entry(row.file.clone()).or_default().push(row);
    }

    // Sort each file's symbols by line ascending (they come out of the query
    // ranked, but within a file we want line order in the output).
    for syms in by_file.values_mut() {
        syms.sort_by_key(|s| s.line);
    }

    // Query MAX line per file for the "(N lines)" header.
    let mut line_counts: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();
    {
        let mut stmt2 = conn
            .prepare(
                "SELECT file, MAX(COALESCE(end_line, line))
                 FROM symbols
                 GROUP BY file",
            )
            .map_err(|e| format!("repo_map: line count query failed: {e}"))?;

        let pairs: Vec<(String, i64)> = stmt2
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| format!("repo_map: line count query_map failed: {e}"))?
            .filter_map(|r| r.ok())
            .collect();

        for (file, max_line) in pairs {
            line_counts.insert(file, max_line);
        }
    }

    // Build the markdown output.
    let timestamp = Utc::now().format("%Y-%m-%d %H:%M:%S UTC");
    let mut output = format!(
        "# Dorotoring Code Map (auto-generated)\n\
         # Project: {project_path} | Updated: {timestamp}\n\
         \n\
         ## Key Symbols\n"
    );

    for file in &file_order {
        if output.len() > budget_chars {
            break;
        }

        let syms = match by_file.get(file) {
            Some(s) => s,
            None => continue,
        };

        let max_line = line_counts.get(file).copied().unwrap_or(0);
        let section_header = format!("\n### {file} ({max_line} lines)\n");
        output.push_str(&section_header);

        for sym in syms {
            if output.len() > budget_chars {
                break;
            }

            let display = format_symbol(sym);
            output.push_str(&display);
        }
    }

    Ok(output)
}

/// Format a single symbol row into a repo-map line.
fn format_symbol(sym: &SymbolRow) -> String {
    let prefix = if sym.exported { "export " } else { "" };

    let decl = match sym.kind.as_str() {
        "class" => format!("{prefix}class {}", sym.name),
        "interface" => format!("{prefix}interface {}", sym.name),
        "type" => format!("{prefix}type {}", sym.name),
        _ => {
            // function / method / variable — prefer the full signature.
            if let Some(sig) = &sym.signature {
                format!("{prefix}{}", sig)
            } else {
                format!("{prefix}{}", sym.name)
            }
        }
    };

    // Pad to ~60 chars for alignment, then append the line reference.
    format!("  {:<60} [L{}]\n", decl, sym.line)
}

/// Generate the repo map and write it to
/// `~/.dorotoring/projects/{hash}/repo-map.md`.
///
/// Returns the path to the written file.
pub fn write_to_file(
    conn: &Connection,
    project_path: &str,
    budget_tokens: usize,
) -> Result<PathBuf, String> {
    let map = generate(conn, project_path, budget_tokens)?;

    let hash = project_hash(project_path);
    let out_dir = dirs::home_dir()
        .ok_or("Could not determine home directory")?
        .join(".dorotoring")
        .join("projects")
        .join(&hash);

    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("repo_map: failed to create output directory: {e}"))?;

    let out_path = out_dir.join("repo-map.md");

    std::fs::write(&out_path, map)
        .map_err(|e| format!("repo_map: failed to write repo-map.md: {e}"))?;

    Ok(out_path)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE symbols (
                id INTEGER PRIMARY KEY,
                file TEXT NOT NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                signature TEXT,
                line INTEGER NOT NULL,
                end_line INTEGER,
                exported BOOLEAN DEFAULT FALSE,
                rank REAL DEFAULT 0.0
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_generate_empty_db() {
        let conn = setup_db();
        let result = generate(&conn, "/test/project", 4096).unwrap();
        assert!(result.contains("# Dorotoring Code Map"));
        assert!(result.contains("/test/project"));
        assert!(result.contains("## Key Symbols"));
    }

    #[test]
    fn test_generate_with_symbols() {
        let conn = setup_db();
        conn.execute_batch(
            "INSERT INTO symbols (file, name, kind, signature, line, end_line, exported, rank)
             VALUES ('src/main.rs', 'main', 'function', 'fn main()', 1, 10, 1, 1.0);
             INSERT INTO symbols (file, name, kind, signature, line, end_line, exported, rank)
             VALUES ('src/lib.rs', 'helper', 'function', 'fn helper() -> u32', 5, 15, 0, 0.5);",
        )
        .unwrap();

        let result = generate(&conn, "/project", 4096).unwrap();
        assert!(result.contains("src/main.rs"));
        assert!(result.contains("main"));
        assert!(result.contains("[L1]"));
    }

    #[test]
    fn test_generate_respects_budget() {
        let conn = setup_db();
        // Insert many symbols
        for i in 0..100 {
            conn.execute(
                "INSERT INTO symbols (file, name, kind, signature, line, exported, rank)
                 VALUES (?1, ?2, 'function', ?3, ?4, 1, 1.0)",
                params![
                    format!("src/file{i}.ts"),
                    format!("func{i}"),
                    format!("function func{i}()"),
                    i,
                ],
            )
            .unwrap();
        }

        // Very small budget: 10 tokens = 40 chars — header alone exceeds this,
        // but the generator will still produce the header.
        let result = generate(&conn, "/project", 10).unwrap();
        // Should be far shorter than an unrestricted map.
        let full = generate(&conn, "/project", 100_000).unwrap();
        assert!(result.len() < full.len());
    }
}
