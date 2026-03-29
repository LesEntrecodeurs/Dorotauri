use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};

use crate::embedding::EmbeddingEngine;
use crate::knowledge::reference_graph;
use crate::knowledge::tree_sitter::parse_file;

/// Directories to skip when walking the project tree.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    "__pycache__",
    "venv",
    ".venv",
    "vendor",
    ".cache",
    "coverage",
    ".turbo",
];

/// Walk a directory recursively, returning all file paths.
///
/// Skips the directories listed in `SKIP_DIRS`.
pub fn walkdir(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    walk_inner(root, &mut files)?;
    Ok(files)
}

fn walk_inner(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory {}: {e}", dir.display()))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Directory entry error: {e}"))?;
        let path = entry.path();

        if path.is_dir() {
            let dir_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");

            if SKIP_DIRS.contains(&dir_name) {
                continue;
            }

            walk_inner(&path, files)?;
        } else if path.is_file() {
            files.push(path);
        }
    }

    Ok(())
}

/// Index a single file: parse, store symbols/refs, update FTS, optionally embed.
///
/// Returns the number of symbols indexed.
pub fn index_file(
    conn: &Connection,
    project_root: &Path,
    file_path: &Path,
    embedding: Option<&EmbeddingEngine>,
) -> Result<usize, String> {
    // Parse the file — skip unsupported files silently.
    let parsed = match parse_file(file_path) {
        Ok(p) => p,
        Err(_) => return Ok(0),
    };

    // Compute relative path from project root.
    let rel_path = file_path
        .strip_prefix(project_root)
        .unwrap_or(file_path)
        .to_string_lossy()
        .to_string();

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("index_file: begin transaction failed: {e}"))?;

    // Delete old symbols for this file.
    tx.execute("DELETE FROM symbols WHERE file = ?1", params![rel_path])
        .map_err(|e| format!("index_file: delete symbols failed: {e}"))?;

    // Delete old refs for this file.
    tx.execute("DELETE FROM refs WHERE from_file = ?1", params![rel_path])
        .map_err(|e| format!("index_file: delete refs failed: {e}"))?;

    // Delete old FTS entries for this file.
    tx.execute(
        "DELETE FROM knowledge_fts WHERE file = ?1 AND source_type = 'symbol'",
        params![rel_path],
    )
    .map_err(|e| format!("index_file: delete FTS failed: {e}"))?;

    let symbol_count = parsed.symbols.len();

    // Insert new symbols and FTS entries.
    for sym in &parsed.symbols {
        tx.execute(
            "INSERT INTO symbols (file, name, kind, signature, line, end_line, exported)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                rel_path,
                sym.name,
                sym.kind.as_str(),
                sym.signature,
                sym.line as i64,
                sym.end_line.map(|l| l as i64),
                sym.exported,
            ],
        )
        .map_err(|e| format!("index_file: insert symbol failed: {e}"))?;

        let sym_id = tx.last_insert_rowid();

        // FTS content: "name signature"
        let fts_content = match &sym.signature {
            Some(sig) => format!("{} {}", sym.name, sig),
            None => sym.name.clone(),
        };

        tx.execute(
            "INSERT INTO knowledge_fts (content, source_type, source_id, file)
             VALUES (?1, 'symbol', ?2, ?3)",
            params![fts_content, sym_id.to_string(), rel_path],
        )
        .map_err(|e| format!("index_file: insert FTS failed: {e}"))?;

        // Embed if engine is available — silently skip failures.
        if let Some(engine) = embedding {
            if engine.is_ready() {
                if let Some(vec) = engine.embed(&fts_content) {
                    // knowledge_vec may not exist; ignore errors.
                    let blob: Vec<u8> = vec
                        .iter()
                        .flat_map(|f| f.to_le_bytes())
                        .collect();

                    let _ = tx.execute(
                        "INSERT INTO knowledge_vec (symbol_id, embedding) VALUES (?1, ?2)",
                        params![sym_id, blob],
                    );
                }
            }
        }
    }

    // Insert refs from imports.
    for import in &parsed.imports {
        for imported_sym in &import.symbols {
            tx.execute(
                "INSERT INTO refs (from_file, from_symbol, to_symbol, to_file, line)
                 VALUES (?1, NULL, ?2, NULL, ?3)",
                params![rel_path, imported_sym, import.line as i64],
            )
            .map_err(|e| format!("index_file: insert ref failed: {e}"))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("index_file: commit failed: {e}"))?;

    Ok(symbol_count)
}

/// Index all source files in a project directory.
///
/// Walks the directory recursively (skipping ignored dirs), calls `index_file`
/// for each supported file, then runs PageRank.
///
/// Returns the total number of symbols indexed.
pub fn index_project(
    conn: &Connection,
    project_root: &Path,
    embedding: Option<&EmbeddingEngine>,
) -> Result<usize, String> {
    let files = walkdir(project_root)?;

    let mut total = 0usize;

    for file in &files {
        let count = index_file(conn, project_root, file, embedding)?;
        total += count;
    }

    // Compute PageRank after all files are indexed.
    reference_graph::build_and_rank(conn)?;

    Ok(total)
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
            CREATE VIRTUAL TABLE knowledge_fts USING fts5(
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

    #[test]
    fn test_index_file_typescript() {
        let conn = setup_db();
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("hello.ts");
        std::fs::write(
            &file,
            "export function greet(name: string): string { return name; }\n",
        )
        .unwrap();

        let count = index_file(&conn, dir.path(), &file, None).unwrap();
        assert_eq!(count, 1, "should index 1 symbol");

        let sym_name: String = conn
            .query_row("SELECT name FROM symbols WHERE file = 'hello.ts'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(sym_name, "greet");
    }

    #[test]
    fn test_index_project_skips_node_modules() {
        let conn = setup_db();
        let dir = tempfile::tempdir().unwrap();

        // Supported file
        std::fs::write(
            dir.path().join("main.ts"),
            "export function main() {}\n",
        )
        .unwrap();

        // File inside node_modules — must be skipped
        let nm = dir.path().join("node_modules");
        std::fs::create_dir_all(&nm).unwrap();
        std::fs::write(nm.join("lib.ts"), "export function hidden() {}\n").unwrap();

        let total = index_project(&conn, dir.path(), None).unwrap();
        // Only main.ts symbol should be indexed
        assert!(total >= 1, "at least main.ts symbol");

        let names: Vec<String> = {
            let mut stmt = conn.prepare("SELECT name FROM symbols").unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        assert!(!names.contains(&"hidden".to_string()), "hidden should be skipped");
    }

    #[test]
    fn test_index_file_inserts_fts() {
        let conn = setup_db();
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("svc.ts");
        std::fs::write(&file, "export class UserService {}\n").unwrap();

        index_file(&conn, dir.path(), &file, None).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM knowledge_fts WHERE source_type = 'symbol'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(count >= 1, "FTS should have at least one entry");
    }
}
