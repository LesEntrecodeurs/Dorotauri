use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::db::VaultDb;
use crate::pty::PtyManager;

// ── Helpers ─────────────────────────────────────────────────────────────────

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

fn row_to_host(row: &rusqlite::Row<'_>) -> rusqlite::Result<serde_json::Value> {
    Ok(json!({
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

// ── CRUD ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn ssh_list_hosts(db: State<'_, VaultDb>) -> Result<serde_json::Value, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, hostname, port, username, auth_type, password, key_path, created_at, updated_at FROM ssh_hosts ORDER BY name ASC")
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| row_to_host(row)).map_err(|e| e.to_string())?;

    let mut hosts = Vec::new();
    for row in rows {
        hosts.push(row.map_err(|e| e.to_string())?);
    }

    Ok(json!({ "hosts": hosts }))
}

#[tauri::command]
pub fn ssh_get_host(db: State<'_, VaultDb>, id: String) -> Result<serde_json::Value, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, name, hostname, port, username, auth_type, password, key_path, created_at, updated_at FROM ssh_hosts WHERE id = ?1",
        rusqlite::params![id],
        |row| row_to_host(row),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ssh_create_host(
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
        "INSERT INTO ssh_hosts (id, name, hostname, port, username, auth_type, password, key_path, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![id, name, hostname, port, username, auth_type, password, key_path, now, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(json!({
        "id": id,
        "name": name,
        "hostname": hostname,
        "port": port,
        "username": username,
        "authType": auth_type,
        "password": password,
        "keyPath": key_path,
        "createdAt": now,
        "updatedAt": now,
    }))
}

#[tauri::command]
pub fn ssh_update_host(
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
        "UPDATE ssh_hosts SET name=?2, hostname=?3, port=?4, username=?5, auth_type=?6, password=?7, key_path=?8, updated_at=?9 WHERE id=?1",
        rusqlite::params![id, name, hostname, port, username, auth_type, password, key_path, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn ssh_delete_host(db: State<'_, VaultDb>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM ssh_hosts WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Read file (for CSV import) ───────────────────────────────────────────────

#[tauri::command]
pub fn ssh_read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {e}"))
}

// ── Open SSH window ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn ssh_open_window(
    app: AppHandle,
    pty_id: String,
    label: String,
    password: Option<String>,
) -> Result<String, String> {
    let window_id = format!("ssh-{}", &uuid::Uuid::new_v4().to_string()[..8]);

    // Encode params in the URL for the standalone SSH terminal route
    let pw = password.unwrap_or_default();
    let url = format!(
        "/ssh-terminal/{}?label={}&pw={}",
        simple_encode(&pty_id),
        simple_encode(&label),
        simple_encode(&pw),
    );

    WebviewWindowBuilder::new(&app, &window_id, WebviewUrl::App(url.into()))
        .title(format!("SSH — {}", label))
        .inner_size(900.0, 600.0)
        .min_inner_size(400.0, 300.0)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(window_id)
}

// ── Connect ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn ssh_connect(
    host_id: String,
    pty_id: String,
    db: State<'_, VaultDb>,
    pty_manager: State<'_, Arc<PtyManager>>,
    app: AppHandle,
) -> Result<String, String> {
    // Read host from DB
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let (hostname, port, username, auth_type, password, key_path): (String, i64, String, String, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT hostname, port, username, auth_type, password, key_path FROM ssh_hosts WHERE id = ?1",
            rusqlite::params![host_id],
            |row| Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            )),
        )
        .map_err(|e| format!("Host not found: {e}"))?;
    drop(conn);

    // Spawn a real interactive bash shell via PtyManager (proven to work with xterm.js)
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/tmp"));
    pty_manager.spawn(
        &pty_id,
        &format!("ssh-{}", pty_id),
        &home.to_string_lossy(),
        &app,
        Some(120),
        Some(24),
        None,
    )?;

    // Build SSH command with `exec` so bash replaces itself with SSH.
    // This avoids double echo (bash echo + remote echo).
    // Force TERM=xterm-256color so remote hosts always recognize the terminal type.
    let mut ssh_cmd = String::from("TERM=xterm-256color exec ssh -o StrictHostKeyChecking=accept-new");
    ssh_cmd.push_str(&format!(" -p {}", port));

    if auth_type == "key" {
        if let Some(ref kp) = key_path {
            ssh_cmd.push_str(&format!(" -i {}", shell_escape(kp)));
        }
    }

    ssh_cmd.push_str(&format!(" {}@{}", username, hostname));
    ssh_cmd.push('\n');

    // Small delay to let the shell initialize, then send the SSH command
    let pty_mgr = Arc::clone(&pty_manager);
    let pty_id_clone = pty_id.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        let _ = pty_mgr.write(&pty_id_clone, ssh_cmd.as_bytes());
    });

    // Return password to frontend so it can auto-fill when prompted
    let pw = if auth_type == "password" { password.unwrap_or_default() } else { String::new() };
    Ok(pw)
}

/// Simple shell escaping for paths with spaces
fn shell_escape(s: &str) -> String {
    if s.contains(' ') || s.contains('\'') {
        format!("'{}'", s.replace('\'', "'\\''"))
    } else {
        s.to_string()
    }
}
