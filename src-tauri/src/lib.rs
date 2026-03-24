use tauri::Manager;

mod commands;
mod db;
mod notifications;
mod pty;
mod state;
mod windows;

pub fn run() {
    let app_state = state::AppState::load();
    let pty_manager = pty::PtyManager::new();
    let window_registry = windows::WindowRegistry::new();
    let vault_db = db::VaultDb::open().expect("Failed to initialize vault database");

    tauri::Builder::default()
        .manage(app_state)
        .manage(pty_manager)
        .manage(window_registry)
        .manage(vault_db)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // TODO: Enable updater plugin once signing keys are configured
        // .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let registry = app.state::<windows::WindowRegistry>();
            registry.register(
                "main",
                windows::WindowInfo {
                    id: "main".to_string(),
                    window_type: windows::WindowType::Hub,
                    displayed_agents: vec![],
                },
            );
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(focused) => {
                let registry = window.state::<windows::WindowRegistry>();
                let mut fw = registry.focused_window.lock().unwrap();
                if *focused {
                    *fw = Some(window.label().to_string());
                } else if fw.as_deref() == Some(window.label()) {
                    *fw = None;
                }
            }
            tauri::WindowEvent::Destroyed => {
                let registry = window.state::<windows::WindowRegistry>();
                registry.unregister(window.label());
            }
            _ => {}
        })
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
            commands::pty::pty_create,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            commands::pty::pty_register,
            commands::pty::pty_lookup,
            // Settings commands
            commands::settings::app_settings_get,
            commands::settings::app_settings_save,
            // Memory commands
            commands::memory::memory_list_projects,
            commands::memory::memory_read_file,
            commands::memory::memory_write_file,
            commands::memory::memory_create_file,
            // Layout commands
            commands::layout::layout_get,
            commands::layout::layout_save,
            // Shell/filesystem commands
            commands::shell::projects_list,
            // Window commands
            commands::window::window_popout,
            commands::window::window_dock,
            commands::window::window_focus,
            commands::window::window_list,
            commands::window::notification_navigate,
            // Vault commands
            commands::vault::vault_list_documents,
            commands::vault::vault_get_document,
            commands::vault::vault_create_document,
            commands::vault::vault_update_document,
            commands::vault::vault_delete_document,
            commands::vault::vault_search,
            commands::vault::vault_list_folders,
            commands::vault::vault_create_folder,
            commands::vault::vault_delete_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
