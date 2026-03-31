use std::sync::Mutex;

pub struct VaultDb {
    pub conn: Mutex<rusqlite::Connection>,
}

impl VaultDb {
    pub fn open() -> Result<Self, String> {
        let dorotoring_dir = dirs::home_dir()
            .ok_or("Could not determine home directory")?
            .join(".dorotoring");

        // Ensure the .dorotoring directory exists
        std::fs::create_dir_all(&dorotoring_dir).map_err(|e| e.to_string())?;

        let path = dorotoring_dir.join("vault.db");
        let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;

        // Enable WAL mode and foreign keys
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
        ",
        )
        .map_err(|e| e.to_string())?;

        // Create tables
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
                author TEXT NOT NULL DEFAULT 'user',
                agent_id TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                filename TEXT NOT NULL,
                filepath TEXT NOT NULL,
                mimetype TEXT NOT NULL,
                size INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ssh_hosts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                hostname TEXT NOT NULL,
                port INTEGER NOT NULL DEFAULT 22,
                username TEXT NOT NULL,
                auth_type TEXT NOT NULL DEFAULT 'password',
                password TEXT,
                key_path TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sftp_hosts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                hostname TEXT NOT NULL,
                port INTEGER NOT NULL DEFAULT 22,
                username TEXT NOT NULL,
                auth_type TEXT NOT NULL DEFAULT 'password',
                password TEXT,
                key_path TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ssh_host_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#6366f1',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        ",
        )
        .map_err(|e| e.to_string())?;

        // Migration: add group_id column to ssh_hosts
        let has_group_id: bool = conn
            .prepare("SELECT group_id FROM ssh_hosts LIMIT 0")
            .is_ok();
        if !has_group_id {
            conn.execute_batch(
                "ALTER TABLE ssh_hosts ADD COLUMN group_id TEXT REFERENCES ssh_host_groups(id) ON DELETE SET NULL;",
            )
            .map_err(|e| e.to_string())?;
        }

        // Create FTS table if not exists
        let fts_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='documents_fts'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if !fts_exists {
            conn.execute_batch(
                "
                CREATE VIRTUAL TABLE documents_fts USING fts5(
                    title, content, tags,
                    content='documents', content_rowid='rowid'
                );

                -- Populate FTS from existing documents
                INSERT INTO documents_fts(rowid, title, content, tags)
                    SELECT rowid, title, content, tags FROM documents;
            ",
            )
            .map_err(|e| e.to_string())?;
        }

        // Create triggers for FTS sync
        conn.execute_batch(
            "
            CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
                INSERT INTO documents_fts(rowid, title, content, tags)
                    VALUES (new.rowid, new.title, new.content, new.tags);
            END;

            CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
                INSERT INTO documents_fts(documents_fts, rowid, title, content, tags)
                    VALUES ('delete', old.rowid, old.title, old.content, old.tags);
            END;

            CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
                INSERT INTO documents_fts(documents_fts, rowid, title, content, tags)
                    VALUES ('delete', old.rowid, old.title, old.content, old.tags);
                INSERT INTO documents_fts(rowid, title, content, tags)
                    VALUES (new.rowid, new.title, new.content, new.tags);
            END;
        ",
        )
        .map_err(|e| e.to_string())?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}
