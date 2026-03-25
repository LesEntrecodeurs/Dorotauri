use std::sync::Arc;
use tauri::{AppHandle, State};
use crate::pty::PtyManager;

/// Create a standalone PTY (not tied to an agent). Used by quick terminals,
/// skill install dialogs, plugin install dialogs, etc.
#[tauri::command]
pub fn pty_create(
    pty_manager: State<'_, Arc<PtyManager>>,
    app_handle: AppHandle,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    let pty_id = uuid::Uuid::new_v4().to_string();
    let working_dir = cwd.unwrap_or_else(|| {
        std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
    });
    pty_manager.spawn(&pty_id, &pty_id, &working_dir, &app_handle, cols, rows)?;
    Ok(pty_id)
}

#[tauri::command]
pub fn pty_write(pty_manager: State<'_, Arc<PtyManager>>, pty_id: String, data: String) -> Result<(), String> {
    pty_manager.write(&pty_id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(pty_manager: State<'_, Arc<PtyManager>>, pty_id: String, cols: u16, rows: u16) -> Result<(), String> {
    pty_manager.resize(&pty_id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(pty_manager: State<'_, Arc<PtyManager>>, pty_id: String) -> Result<(), String> {
    pty_manager.kill(&pty_id)
}

/// Register a key (e.g. agentId) → ptyId mapping so other windows can find the PTY.
#[tauri::command]
pub fn pty_register(pty_manager: State<'_, Arc<PtyManager>>, key: String, pty_id: String) {
    pty_manager.register(&key, &pty_id);
}

/// Look up ptyId by key (e.g. agentId). Returns the ptyId if found and still alive.
#[tauri::command]
pub fn pty_lookup(pty_manager: State<'_, Arc<PtyManager>>, key: String) -> Option<String> {
    pty_manager.lookup(&key)
}
