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
            // Agent commands
            commands::agent::agent_list,
            commands::agent::agent_get,
            commands::agent::agent_create,
            commands::agent::agent_start,
            commands::agent::agent_stop,
            commands::agent::agent_remove,
            commands::agent::agent_update,
            commands::agent::agent_send_input,
            // PTY commands
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            // Settings commands
            commands::settings::app_settings_get,
            commands::settings::app_settings_save,
            // Memory commands
            commands::memory::memory_list_projects,
            commands::memory::memory_read_file,
            commands::memory::memory_write_file,
            commands::memory::memory_create_file,
            // Shell/filesystem commands
            commands::shell::projects_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
