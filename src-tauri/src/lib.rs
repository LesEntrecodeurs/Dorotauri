use std::sync::Arc;
use tauri::Manager;
use dirs;

pub mod api_server;
pub mod business_state;
mod commands;
mod cwd_tracker;
mod db;
pub mod migration;
mod notifications;
mod pty;
mod state;
mod usage_watcher;
mod windows;

/// Writes the embedded super-agent instructions to ~/.dorotoring/ and returns the path.
/// Called before launching any Super Agent to ensure the instructions file is up-to-date.
pub fn ensure_super_agent_instructions() -> Option<std::path::PathBuf> {
    const INSTRUCTIONS: &str =
        include_str!("../../electron/resources/super-agent-instructions.md");
    let path = dirs::home_dir()?
        .join(".dorotoring")
        .join("super-agent-instructions.md");
    std::fs::create_dir_all(path.parent()?).ok()?;
    std::fs::write(&path, INSTRUCTIONS).ok()?;
    Some(path)
}

pub fn run() {
    let app_state = Arc::new(state::AppState::load());
    let pty_manager = Arc::new(pty::PtyManager::new());
    let window_registry = windows::WindowRegistry::new();
    let vault_db = db::VaultDb::open().expect("Failed to initialize vault database");
    let cwd_tracker = Arc::new(cwd_tracker::CwdTracker::new());

    // Clone the agents Arc so the polling thread can share it
    let agents_arc = Arc::clone(&app_state.agents);

    // Clone Arcs for the API server
    let api_app_state = Arc::clone(&app_state);
    let api_pty_manager = Arc::clone(&pty_manager);
    let api_cwd_tracker = Arc::clone(&cwd_tracker);

    tauri::Builder::default()
        .manage(app_state)
        .manage(pty_manager)
        .manage(window_registry)
        .manage(vault_db)
        .manage(cwd_tracker)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // TODO: Enable updater plugin once signing keys are configured
        // .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let registry = app.state::<windows::WindowRegistry>();
            registry.register(
                "main",
                windows::WindowInfo {
                    id: "main".to_string(),
                    window_type: windows::WindowType::Hub,
                    displayed_agents: vec![],
                },
            );

            // Start API server for MCP orchestrator
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(api_server::start(
                api_app_state,
                api_pty_manager,
                api_cwd_tracker,
                handle,
            ));

            // Start the cwd polling thread
            let tracker = app.state::<Arc<cwd_tracker::CwdTracker>>();
            tracker.start_polling(app.handle().clone(), agents_arc);

            // Install statusline script & configure Claude Code
            usage_watcher::ensure_statusline();

            // Start the usage rate-limits watcher
            usage_watcher::start(app.handle().clone());

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
            commands::agent::agent_set_dormant,
            commands::agent::agent_reanimate,
            commands::agent::agent_update_business_state,
            commands::agent::agent_promote_super,
            // PTY commands
            commands::pty::pty_create,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            commands::pty::pty_register,
            commands::pty::pty_lookup,
            commands::pty::pty_pause,
            commands::pty::pty_resume,
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
            // Tab commands
            commands::tab::tab_list,
            commands::tab::tab_create,
            commands::tab::tab_update,
            commands::tab::tab_delete,
            commands::tab::tab_reorder,
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
            // Orchestrator commands
            commands::orchestrator::orchestrator_get_status,
            commands::orchestrator::orchestrator_setup,
            commands::orchestrator::orchestrator_remove,
            // Docker commands
            commands::docker::docker_list_containers,
            commands::docker::docker_start_container,
            commands::docker::docker_stop_container,
            commands::docker::docker_restart_container,
            commands::docker::docker_ensure_running,
            commands::docker::docker_status,
            commands::docker::docker_setup,
            commands::docker::docker_container_stats,
            commands::docker::docker_container_logs,
            commands::docker::docker_exec_shell,
            commands::docker::docker_compose_up,
            commands::docker::docker_compose_down,
            commands::docker::docker_inspect_container,
            commands::docker::docker_list_images,
            commands::docker::docker_remove_image,
            commands::docker::docker_pull_image,
            commands::docker::docker_list_volumes,
            commands::docker::docker_remove_volume,
            commands::docker::docker_prune_volumes,
            commands::docker::docker_list_networks,
            commands::docker::docker_disk_usage,
            commands::docker::docker_system_prune,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
