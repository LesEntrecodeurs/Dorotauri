use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State, WebviewUrl, WebviewWindowBuilder};

use crate::db::VaultDb;
use crate::sftp::{self, HostCredentials, SftpManager, SftpSessionHandle};

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
    pub permissions: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transfer_id: String,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub status: String,
    pub error: Option<String>,
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn simple_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}

fn read_host_creds(db: &State<'_, VaultDb>, host_id: &str) -> Result<HostCredentials, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT hostname, port, username, auth_type, password, key_path FROM sftp_hosts WHERE id = ?1",
        rusqlite::params![host_id],
        |row| {
            Ok(HostCredentials {
                hostname: row.get(0)?,
                port: row.get::<_, i64>(1)? as u16,
                username: row.get(2)?,
                auth_type: row.get(3)?,
                password: row.get(4)?,
                key_path: row.get(5)?,
            })
        },
    )
    .map_err(|e| format!("SFTP host not found: {e}"))
}

fn row_to_host(row: &rusqlite::Row<'_>) -> rusqlite::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "id": row.get::<_, String>(0)?,
        "name": row.get::<_, String>(1)?,
        "hostname": row.get::<_, String>(2)?,
        "port": row.get::<_, i64>(3)?,
        "username": row.get::<_, String>(4)?,
        "authType": row.get::<_, String>(5)?,
        "password": row.get::<_, Option<String>>(6)?,
        "keyPath": row.get::<_, Option<String>>(7)?,
        "createdAt": row.get::<_, String>(8)?,
        "updatedAt": row.get::<_, String>(9)?,
    }))
}

// ── SFTP Host CRUD ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn sftp_list_hosts(db: State<'_, VaultDb>) -> Result<serde_json::Value, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, hostname, port, username, auth_type, password, key_path, created_at, updated_at FROM sftp_hosts ORDER BY name ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| row_to_host(row)).map_err(|e| e.to_string())?;
    let mut hosts = Vec::new();
    for row in rows {
        hosts.push(row.map_err(|e| e.to_string())?);
    }
    Ok(serde_json::json!({ "hosts": hosts }))
}

#[tauri::command]
pub fn sftp_get_host(db: State<'_, VaultDb>, id: String) -> Result<serde_json::Value, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, name, hostname, port, username, auth_type, password, key_path, created_at, updated_at FROM sftp_hosts WHERE id = ?1",
        rusqlite::params![id],
        |row| row_to_host(row),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sftp_create_host(
    db: State<'_, VaultDb>,
    name: String,
    hostname: String,
    port: Option<u16>,
    username: String,
    auth_type: String,
    password: Option<String>,
    key_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let port = port.unwrap_or(22) as i64;
    conn.execute(
        "INSERT INTO sftp_hosts (id, name, hostname, port, username, auth_type, password, key_path, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![id, name, hostname, port, username, auth_type, password, key_path, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "id": id, "name": name, "hostname": hostname, "port": port,
        "username": username, "authType": auth_type, "password": password,
        "keyPath": key_path, "createdAt": now, "updatedAt": now,
    }))
}

#[tauri::command]
pub fn sftp_update_host(
    db: State<'_, VaultDb>,
    id: String,
    name: String,
    hostname: String,
    port: Option<u16>,
    username: String,
    auth_type: String,
    password: Option<String>,
    key_path: Option<String>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let port = port.unwrap_or(22) as i64;
    conn.execute(
        "UPDATE sftp_hosts SET name=?2, hostname=?3, port=?4, username=?5, auth_type=?6, password=?7, key_path=?8, updated_at=?9 WHERE id=?1",
        rusqlite::params![id, name, hostname, port, username, auth_type, password, key_path, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn sftp_delete_host(db: State<'_, VaultDb>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sftp_hosts WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn sftp_read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {e}"))
}

fn unix_mode_to_string(mode: u32) -> String {
    let mut s = String::with_capacity(10);
    // File type
    s.push(if mode & 0o40000 != 0 { 'd' } else { '-' });
    // Owner
    s.push(if mode & 0o400 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o200 != 0 { 'w' } else { '-' });
    s.push(if mode & 0o100 != 0 { 'x' } else { '-' });
    // Group
    s.push(if mode & 0o040 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o020 != 0 { 'w' } else { '-' });
    s.push(if mode & 0o010 != 0 { 'x' } else { '-' });
    // Other
    s.push(if mode & 0o004 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o002 != 0 { 'w' } else { '-' });
    s.push(if mode & 0o001 != 0 { 'x' } else { '-' });
    s
}

// ── Connection commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_connect(
    host_id: String,
    db: State<'_, VaultDb>,
    sftp_manager: State<'_, Arc<SftpManager>>,
) -> Result<String, String> {
    let creds = read_host_creds(&db, &host_id)?;
    let (sftp_session, ssh_handle) = sftp::connect_sftp(&creds).await?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let handle = SftpSessionHandle {
        session_id: session_id.clone(),
        host_id: host_id.clone(),
        sftp: sftp_session,
        ssh_handle,
    };

    let mut sessions = sftp_manager.sessions.lock().await;
    sessions.insert(session_id.clone(), handle);

    Ok(session_id)
}

#[tauri::command]
pub async fn sftp_disconnect(
    session_id: String,
    sftp_manager: State<'_, Arc<SftpManager>>,
) -> Result<(), String> {
    let mut sessions = sftp_manager.sessions.lock().await;
    if let Some(handle) = sessions.remove(&session_id) {
        let _ = handle.sftp.close().await;
    }
    Ok(())
}

// ── Directory browsing ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_list_dir(
    session_id: String,
    path: String,
    sftp_manager: State<'_, Arc<SftpManager>>,
) -> Result<Vec<SftpEntry>, String> {
    let sessions = sftp_manager.sessions.lock().await;
    let handle = sessions
        .get(&session_id)
        .ok_or("SFTP session not found")?;

    let entries = handle
        .sftp
        .read_dir(&path)
        .await
        .map_err(|e| format!("Failed to list directory: {e}"))?;

    let mut result = Vec::new();
    for entry in entries {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }

        let full_path = if path == "/" {
            format!("/{}", name)
        } else {
            format!("{}/{}", path.trim_end_matches('/'), name)
        };

        let attrs = entry.metadata();
        let is_dir = attrs.is_dir();
        let size = attrs.size.unwrap_or(0);

        let modified = attrs.mtime.map(|t| {
            chrono::DateTime::from_timestamp(t as i64, 0)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default()
        });

        let permissions = attrs.permissions.map(|p| unix_mode_to_string(p));

        result.push(SftpEntry {
            name,
            path: full_path,
            is_dir,
            size,
            modified,
            permissions,
        });
    }

    // Sort: directories first, then alphabetically
    result.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(result)
}

#[tauri::command]
pub fn sftp_list_local_dir(path: String) -> Result<Vec<LocalEntry>, String> {
    let read_dir = std::fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {e}"))?;

    let mut result = Vec::new();
    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry.path().to_string_lossy().to_string();
        let metadata = entry.metadata().map_err(|e| format!("Failed to read metadata: {e}"))?;

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .and_then(|d| chrono::DateTime::from_timestamp(d.as_secs() as i64, 0))
                    .map(|dt| dt.to_rfc3339())
            });

        result.push(LocalEntry {
            name,
            path: full_path,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified,
        });
    }

    result.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(result)
}

// ── File operations ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_download(
    session_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
    app: AppHandle,
    sftp_manager: State<'_, Arc<SftpManager>>,
) -> Result<(), String> {
    let sessions = sftp_manager.sessions.lock().await;
    let handle = sessions.get(&session_id).ok_or("SFTP session not found")?;

    // Get file size for progress
    let attrs = handle.sftp.metadata(&remote_path).await
        .map_err(|e| format!("Failed to stat remote file: {e}"))?;
    let total_bytes = attrs.size.unwrap_or(0);

    // Read the entire file
    let data = handle.sftp.read(&remote_path).await
        .map_err(|e| format!("Failed to read remote file: {e}"))?;

    // Write to local file
    std::fs::write(&local_path, &data)
        .map_err(|e| format!("Failed to write local file: {e}"))?;

    let _ = app.emit("sftp:progress", TransferProgress {
        transfer_id,
        bytes_transferred: total_bytes,
        total_bytes,
        percent: 100.0,
        status: "completed".into(),
        error: None,
    });

    Ok(())
}

#[tauri::command]
pub async fn sftp_upload(
    session_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
    app: AppHandle,
    sftp_manager: State<'_, Arc<SftpManager>>,
) -> Result<(), String> {
    let data = std::fs::read(&local_path)
        .map_err(|e| format!("Failed to read local file: {e}"))?;
    let total_bytes = data.len() as u64;

    let sessions = sftp_manager.sessions.lock().await;
    let handle = sessions.get(&session_id).ok_or("SFTP session not found")?;

    handle.sftp.write(&remote_path, &data).await
        .map_err(|e| format!("Failed to write remote file: {e}"))?;

    let _ = app.emit("sftp:progress", TransferProgress {
        transfer_id,
        bytes_transferred: total_bytes,
        total_bytes,
        percent: 100.0,
        status: "completed".into(),
        error: None,
    });

    Ok(())
}

#[tauri::command]
pub async fn sftp_mkdir(
    session_id: String,
    path: String,
    sftp_manager: State<'_, Arc<SftpManager>>,
) -> Result<(), String> {
    let sessions = sftp_manager.sessions.lock().await;
    let handle = sessions.get(&session_id).ok_or("SFTP session not found")?;

    handle.sftp.create_dir(&path).await
        .map_err(|e| format!("Failed to create directory: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn sftp_delete(
    session_id: String,
    path: String,
    is_dir: bool,
    sftp_manager: State<'_, Arc<SftpManager>>,
) -> Result<(), String> {
    let sessions = sftp_manager.sessions.lock().await;
    let handle = sessions.get(&session_id).ok_or("SFTP session not found")?;

    if is_dir {
        handle.sftp.remove_dir(&path).await
            .map_err(|e| format!("Failed to delete directory: {e}"))?;
    } else {
        handle.sftp.remove_file(&path).await
            .map_err(|e| format!("Failed to delete file: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_rename(
    session_id: String,
    old_path: String,
    new_path: String,
    sftp_manager: State<'_, Arc<SftpManager>>,
) -> Result<(), String> {
    let sessions = sftp_manager.sessions.lock().await;
    let handle = sessions.get(&session_id).ok_or("SFTP session not found")?;

    handle.sftp.rename(&old_path, &new_path).await
        .map_err(|e| format!("Failed to rename: {e}"))?;

    Ok(())
}

// ── Home directory ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_home_dir(
    session_id: String,
    sftp_manager: State<'_, Arc<SftpManager>>,
) -> Result<String, String> {
    let sessions = sftp_manager.sessions.lock().await;
    let handle = sessions.get(&session_id).ok_or("SFTP session not found")?;

    let path = handle.sftp.canonicalize(".")
        .await
        .map_err(|e| format!("Failed to resolve home directory: {e}"))?;

    Ok(path)
}

// ── Window ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn sftp_open_window(
    app: AppHandle,
    host_id: String,
    label: String,
) -> Result<String, String> {
    let window_id = format!("sftp-{}", &uuid::Uuid::new_v4().to_string()[..8]);

    let url = format!(
        "/sftp-browser/{}?label={}",
        simple_encode(&host_id),
        simple_encode(&label),
    );

    WebviewWindowBuilder::new(&app, &window_id, WebviewUrl::App(url.into()))
        .title(format!("SFTP — {}", label))
        .inner_size(1100.0, 700.0)
        .min_inner_size(600.0, 400.0)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(window_id)
}
