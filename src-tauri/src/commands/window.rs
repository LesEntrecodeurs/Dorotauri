use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

use crate::windows::{WindowInfo, WindowRegistry, WindowType};

#[tauri::command]
pub fn window_popout(
    app_handle: tauri::AppHandle,
    registry: State<'_, WindowRegistry>,
    agent_id: String,
) -> Result<String, String> {
    let window_id = format!("console-{}", &Uuid::new_v4().to_string()[..8]);
    let url = format!("/console/{}", agent_id);

    WebviewWindowBuilder::new(&app_handle, &window_id, WebviewUrl::App(url.into()))
        .title(format!(
            "Dorothy — Agent {}",
            &agent_id[..8.min(agent_id.len())]
        ))
        .inner_size(900.0, 600.0)
        .min_inner_size(400.0, 300.0)
        .build()
        .map_err(|e| e.to_string())?;

    registry.register(
        &window_id,
        WindowInfo {
            id: window_id.clone(),
            window_type: WindowType::Console { agent_id },
            displayed_agents: vec![],
        },
    );

    Ok(window_id)
}

#[tauri::command]
pub fn window_dock(
    app_handle: tauri::AppHandle,
    registry: State<'_, WindowRegistry>,
    window_id: String,
) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window(&window_id) {
        window.close().map_err(|e| e.to_string())?;
    }
    registry.unregister(&window_id);
    Ok(())
}

#[tauri::command]
pub fn window_focus(app_handle: tauri::AppHandle, window_id: String) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window(&window_id) {
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn window_list(registry: State<'_, WindowRegistry>) -> Vec<WindowInfo> {
    registry.windows.lock().unwrap().values().cloned().collect()
}

#[tauri::command]
pub fn notification_navigate(
    app_handle: tauri::AppHandle,
    registry: State<'_, WindowRegistry>,
    agent_id: String,
) -> Result<(), String> {
    if let Some(window_id) = registry.find_window_for_agent(&agent_id) {
        if let Some(window) = app_handle.get_webview_window(&window_id) {
            window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
