use tauri::State;
use crate::pty::PtyManager;

#[tauri::command]
pub fn pty_write(pty_manager: State<'_, PtyManager>, pty_id: String, data: String) -> Result<(), String> {
    pty_manager.write(&pty_id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(pty_manager: State<'_, PtyManager>, pty_id: String, cols: u16, rows: u16) -> Result<(), String> {
    pty_manager.resize(&pty_id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(pty_manager: State<'_, PtyManager>, pty_id: String) -> Result<(), String> {
    pty_manager.kill(&pty_id)
}
