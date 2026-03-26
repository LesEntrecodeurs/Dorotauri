use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorStatus {
    pub running: bool,
}

#[tauri::command]
pub fn orchestrator_get_status() -> OrchestratorStatus {
    OrchestratorStatus { running: false }
}

#[tauri::command]
pub fn orchestrator_setup() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn orchestrator_remove() -> Result<(), String> {
    Ok(())
}
