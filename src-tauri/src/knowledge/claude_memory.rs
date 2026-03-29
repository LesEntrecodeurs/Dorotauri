use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};

use crate::embedding::EmbeddingEngine;

/// Locate Claude Code's memory directory for the given project path.
///
/// Claude Code encodes project paths by replacing `/` with `-`, so
/// `/home/user/project` becomes `-home-user-project`.
///
/// Memory files live at:
/// `~/.claude/projects/{encoded-path}/memory/`
///
/// Both `{encoded}` and `{encoded-without-leading-dash}` are tried.
pub fn find_memory_dir(project_path: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let claude_projects = home.join(".claude").join("projects");

    // Encode: replace '/' with '-'.
    let encoded = project_path.replace('/', "-");

    // Try with leading dash (the typical encoding for absolute paths).
    let candidates = [
        claude_projects.join(&encoded),
        // Without a potential leading dash — covers edge cases.
        claude_projects.join(encoded.trim_start_matches('-')),
    ];

    for candidate in &candidates {
        let memory_dir = candidate.join("memory");
        if memory_dir.is_dir() {
            return Some(memory_dir);
        }
    }

    None
}

/// Index all `.md` files in `memory_dir` into the knowledge FTS table.
///
/// Steps:
/// 1. Delete existing `claude_memory` entries from `knowledge_fts`.
/// 2. Read each `.md` file, strip YAML frontmatter.
/// 3. Insert into `knowledge_fts` with `source_type = 'claude_memory'`.
/// 4. If an embedding engine is available, embed the content and insert into
///    `knowledge_vec` (errors are silently ignored).
///
/// Returns the number of memory files indexed.
pub fn index_memory_dir(
    conn: &Connection,
    memory_dir: &Path,
    embedding: Option<&EmbeddingEngine>,
) -> Result<usize, String> {
    // 1. Clear old claude_memory entries.
    conn.execute(
        "DELETE FROM knowledge_fts WHERE source_type = 'claude_memory'",
        [],
    )
    .map_err(|e| format!("claude_memory: failed to clear old entries: {e}"))?;

    // 2. Read .md files.
    let entries = std::fs::read_dir(memory_dir)
        .map_err(|e| format!("claude_memory: failed to read memory dir: {e}"))?;

    let mut count = 0usize;

    for entry in entries {
        let entry = entry.map_err(|e| format!("claude_memory: directory entry error: {e}"))?;
        let path = entry.path();

        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }

        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue, // skip unreadable files
        };

        let content = strip_frontmatter(&raw);

        if content.trim().is_empty() {
            continue;
        }

        // 3. Insert into FTS.
        conn.execute(
            "INSERT INTO knowledge_fts (content, source_type, source_id, file)
             VALUES (?1, 'claude_memory', ?2, ?3)",
            params![content, filename, path.to_string_lossy().as_ref()],
        )
        .map_err(|e| format!("claude_memory: failed to insert FTS entry for {filename}: {e}"))?;

        // 4. Embed if available (best-effort).
        if let Some(engine) = embedding {
            if engine.is_ready() {
                if let Some(vec) = engine.embed(&content) {
                    let blob: Vec<u8> = vec.iter().flat_map(|f| f.to_le_bytes()).collect();
                    // knowledge_vec may not exist — ignore errors.
                    let _ = conn.execute(
                        "INSERT INTO knowledge_vec (symbol_id, embedding) VALUES (?1, ?2)",
                        params![filename, blob],
                    );
                }
            }
        }

        count += 1;
    }

    Ok(count)
}

/// Strip YAML frontmatter from markdown content.
///
/// Frontmatter is defined as a block delimited by `---` lines at the very
/// start of the document. If no valid frontmatter is found the original
/// string is returned unchanged.
pub fn strip_frontmatter(content: &str) -> String {
    let trimmed = content.trim_start_matches('\n');

    if !trimmed.starts_with("---") {
        return content.to_string();
    }

    // Find the closing `---`.
    // We skip the first line (the opening `---`) and look for the next one.
    let after_open = &trimmed["---".len()..];

    // The closing delimiter must be on its own line.
    if let Some(pos) = find_closing_delimiter(after_open) {
        // pos points to the start of `---` in after_open.
        let rest = &after_open[pos + 3..]; // skip the closing `---`
        rest.trim_start_matches('\n').to_string()
    } else {
        content.to_string()
    }
}

/// Find the byte position of the closing `---` delimiter within `s`.
///
/// Returns `Some(pos)` where `pos` is the index of the `---` that starts on
/// its own line, or `None` if not found.
fn find_closing_delimiter(s: &str) -> Option<usize> {
    let mut offset = 0usize;

    // Must start on a new line.
    // Iterate line by line.
    for line in s.lines() {
        if line.trim() == "---" {
            // Find exact byte position in s.
            let pos = s[offset..].find("---")?;
            return Some(offset + pos);
        }
        offset += line.len() + 1; // +1 for '\n'
    }

    None
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    // --- strip_frontmatter tests (required by spec) ---

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

    #[test]
    fn test_strip_frontmatter_empty_body() {
        let input = "---\ntitle: empty\n---\n";
        let result = strip_frontmatter(input);
        assert!(!result.contains("title: empty"));
    }

    #[test]
    fn test_strip_frontmatter_no_closing_delimiter() {
        // No closing --- → return original.
        let input = "---\ntitle: no close\n\nSome text";
        let result = strip_frontmatter(input);
        assert_eq!(result, input);
    }

    // --- index_memory_dir tests ---

    fn setup_fts_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE VIRTUAL TABLE knowledge_fts USING fts5(
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
    fn test_index_memory_dir_basic() {
        let conn = setup_fts_db();
        let dir = tempfile::tempdir().unwrap();

        std::fs::write(
            dir.path().join("MEMORY.md"),
            "---\ntitle: Memory\n---\n\nThis is a memory entry.",
        )
        .unwrap();

        std::fs::write(dir.path().join("notes.md"), "Some notes without frontmatter.")
            .unwrap();

        let count = index_memory_dir(&conn, dir.path(), None).unwrap();
        assert_eq!(count, 2);

        let fts_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM knowledge_fts WHERE source_type = 'claude_memory'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fts_count, 2);
    }

    #[test]
    fn test_index_memory_dir_clears_old_entries() {
        let conn = setup_fts_db();
        let dir = tempfile::tempdir().unwrap();

        // Seed an old entry.
        conn.execute(
            "INSERT INTO knowledge_fts (content, source_type, source_id, file)
             VALUES ('old content', 'claude_memory', 'old.md', '/old.md')",
            [],
        )
        .unwrap();

        std::fs::write(dir.path().join("new.md"), "New content.").unwrap();

        index_memory_dir(&conn, dir.path(), None).unwrap();

        // Old entry should be gone.
        let old_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM knowledge_fts WHERE source_id = 'old.md'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_count, 0);
    }

    #[test]
    fn test_index_memory_dir_skips_non_md() {
        let conn = setup_fts_db();
        let dir = tempfile::tempdir().unwrap();

        std::fs::write(dir.path().join("notes.txt"), "Not markdown.").unwrap();
        std::fs::write(dir.path().join("memory.md"), "Markdown file.").unwrap();

        let count = index_memory_dir(&conn, dir.path(), None).unwrap();
        assert_eq!(count, 1);
    }
}
