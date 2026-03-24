use crate::db::VaultDb;
use serde_json::json;
use tauri::State;

#[tauri::command]
pub fn vault_list_documents(
    db: State<'_, VaultDb>,
    folder_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut query = "SELECT * FROM documents".to_string();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref fid) = folder_id {
        query.push_str(" WHERE folder_id = ?1");
        params.push(Box::new(fid.clone()));
    }

    query.push_str(" ORDER BY updated_at DESC");

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "content": row.get::<_, String>(2)?,
                "folder_id": row.get::<_, Option<String>>(3)?,
                "author": row.get::<_, String>(4)?,
                "agent_id": row.get::<_, Option<String>>(5)?,
                "tags": row.get::<_, String>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "updated_at": row.get::<_, String>(8)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut documents = Vec::new();
    for row in rows {
        documents.push(row.map_err(|e| e.to_string())?);
    }

    Ok(json!({ "documents": documents }))
}

#[tauri::command]
pub fn vault_get_document(
    db: State<'_, VaultDb>,
    id: String,
) -> Result<serde_json::Value, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let document = conn
        .query_row(
            "SELECT * FROM documents WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "content": row.get::<_, String>(2)?,
                    "folder_id": row.get::<_, Option<String>>(3)?,
                    "author": row.get::<_, String>(4)?,
                    "agent_id": row.get::<_, Option<String>>(5)?,
                    "tags": row.get::<_, String>(6)?,
                    "created_at": row.get::<_, String>(7)?,
                    "updated_at": row.get::<_, String>(8)?,
                }))
            },
        )
        .map_err(|e| e.to_string())?;

    // Fetch attachments
    let mut stmt = conn
        .prepare("SELECT * FROM attachments WHERE document_id = ?1 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let attachments: Vec<serde_json::Value> = stmt
        .query_map(rusqlite::params![id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "document_id": row.get::<_, String>(1)?,
                "filename": row.get::<_, String>(2)?,
                "filepath": row.get::<_, String>(3)?,
                "mimetype": row.get::<_, String>(4)?,
                "size": row.get::<_, i64>(5)?,
                "created_at": row.get::<_, String>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(json!({ "document": document, "attachments": attachments }))
}

#[tauri::command]
pub fn vault_create_document(
    db: State<'_, VaultDb>,
    title: String,
    content: String,
    folder_id: Option<String>,
    author: Option<String>,
    agent_id: Option<String>,
    tags: Option<String>,
) -> Result<serde_json::Value, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let author = author.unwrap_or_else(|| "user".to_string());
    let tags = tags.unwrap_or_else(|| "[]".to_string());

    conn.execute(
        "INSERT INTO documents (id, title, content, folder_id, author, agent_id, tags, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![id, title, content, folder_id, author, agent_id, tags, now, now],
    )
    .map_err(|e| e.to_string())?;

    let document = conn
        .query_row(
            "SELECT * FROM documents WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "content": row.get::<_, String>(2)?,
                    "folder_id": row.get::<_, Option<String>>(3)?,
                    "author": row.get::<_, String>(4)?,
                    "agent_id": row.get::<_, Option<String>>(5)?,
                    "tags": row.get::<_, String>(6)?,
                    "created_at": row.get::<_, String>(7)?,
                    "updated_at": row.get::<_, String>(8)?,
                }))
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(json!({ "success": true, "document": document }))
}

#[tauri::command]
pub fn vault_update_document(
    db: State<'_, VaultDb>,
    id: String,
    title: Option<String>,
    content: Option<String>,
    folder_id: Option<String>,
    tags: Option<String>,
) -> Result<serde_json::Value, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Check document exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM documents WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if !exists {
        return Err("Document not found".to_string());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let mut updates = vec!["updated_at = ?1".to_string()];
    let mut param_index = 2u32;
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref t) = title {
        updates.push(format!("title = ?{}", param_index));
        params.push(Box::new(t.clone()));
        param_index += 1;
    }
    if let Some(ref c) = content {
        updates.push(format!("content = ?{}", param_index));
        params.push(Box::new(c.clone()));
        param_index += 1;
    }
    if let Some(ref t) = tags {
        updates.push(format!("tags = ?{}", param_index));
        params.push(Box::new(t.clone()));
        param_index += 1;
    }
    if let Some(ref f) = folder_id {
        updates.push(format!("folder_id = ?{}", param_index));
        params.push(Box::new(f.clone()));
        param_index += 1;
    }

    // Add the id as the last parameter
    let _ = param_index;
    params.push(Box::new(id.clone()));
    let id_index = params.len();

    let sql = format!(
        "UPDATE documents SET {} WHERE id = ?{}",
        updates.join(", "),
        id_index
    );

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, param_refs.as_slice())
        .map_err(|e| e.to_string())?;

    let document = conn
        .query_row(
            "SELECT * FROM documents WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "content": row.get::<_, String>(2)?,
                    "folder_id": row.get::<_, Option<String>>(3)?,
                    "author": row.get::<_, String>(4)?,
                    "agent_id": row.get::<_, Option<String>>(5)?,
                    "tags": row.get::<_, String>(6)?,
                    "created_at": row.get::<_, String>(7)?,
                    "updated_at": row.get::<_, String>(8)?,
                }))
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(json!({ "success": true, "document": document }))
}

#[tauri::command]
pub fn vault_delete_document(db: State<'_, VaultDb>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Delete associated attachment files from disk
    let mut stmt = conn
        .prepare("SELECT filepath FROM attachments WHERE document_id = ?1")
        .map_err(|e| e.to_string())?;
    let filepaths: Vec<String> = stmt
        .query_map(rusqlite::params![id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for filepath in filepaths {
        let _ = std::fs::remove_file(&filepath);
    }

    // CASCADE will delete attachments; then delete the document
    conn.execute(
        "DELETE FROM documents WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn vault_search(
    db: State<'_, VaultDb>,
    query: String,
) -> Result<serde_json::Value, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT d.*, snippet(documents_fts, 1, '<mark>', '</mark>', '...', 40) as snippet
             FROM documents_fts fts
             JOIN documents d ON d.rowid = fts.rowid
             WHERE documents_fts MATCH ?1
             ORDER BY rank
             LIMIT 20",
        )
        .map_err(|e| e.to_string())?;

    let results: Vec<serde_json::Value> = stmt
        .query_map(rusqlite::params![query], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "content": row.get::<_, String>(2)?,
                "folder_id": row.get::<_, Option<String>>(3)?,
                "author": row.get::<_, String>(4)?,
                "agent_id": row.get::<_, Option<String>>(5)?,
                "tags": row.get::<_, String>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "updated_at": row.get::<_, String>(8)?,
                "snippet": row.get::<_, String>(9)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(json!({ "results": results }))
}

#[tauri::command]
pub fn vault_list_folders(db: State<'_, VaultDb>) -> Result<serde_json::Value, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT * FROM folders ORDER BY name")
        .map_err(|e| e.to_string())?;

    let folders: Vec<serde_json::Value> = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "parent_id": row.get::<_, Option<String>>(2)?,
                "created_at": row.get::<_, String>(3)?,
                "updated_at": row.get::<_, String>(4)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(json!({ "folders": folders }))
}

#[tauri::command]
pub fn vault_create_folder(
    db: State<'_, VaultDb>,
    name: String,
    parent_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO folders (id, name, parent_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, name, parent_id, now, now],
    )
    .map_err(|e| e.to_string())?;

    let folder = conn
        .query_row(
            "SELECT * FROM folders WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "parent_id": row.get::<_, Option<String>>(2)?,
                    "created_at": row.get::<_, String>(3)?,
                    "updated_at": row.get::<_, String>(4)?,
                }))
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(json!({ "success": true, "folder": folder }))
}

#[tauri::command]
pub fn vault_delete_folder(db: State<'_, VaultDb>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Move documents in this folder to root (no folder)
    conn.execute(
        "UPDATE documents SET folder_id = NULL WHERE folder_id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;

    // CASCADE will handle subfolders
    conn.execute(
        "DELETE FROM folders WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
