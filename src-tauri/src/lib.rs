mod commands;
mod pty;
mod state;

pub fn run() {
    let app_state = state::AppState::load();
    let pty_manager = pty::PtyManager::new();

    tauri::Builder::default()
        .manage(app_state)
        .manage(pty_manager)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::agent::agent_list,
            commands::agent::agent_get,
            commands::agent::agent_create,
            commands::agent::agent_start,
            commands::agent::agent_stop,
            commands::agent::agent_remove,
            commands::agent::agent_update,
            commands::agent::agent_send_input,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
