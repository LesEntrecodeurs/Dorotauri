use tauri::State;
use crate::state::{AppState, AppSettings};

#[tauri::command]
pub fn app_settings_get(state: State<'_, AppState>) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn app_settings_save(state: State<'_, AppState>, settings: AppSettings) -> serde_json::Value {
    *state.settings.lock().unwrap() = settings;
    state.save_settings();
    serde_json::json!({ "success": true })
}
