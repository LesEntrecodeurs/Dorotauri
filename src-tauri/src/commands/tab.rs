use tauri::State;

use crate::state::{AppState, ProcessState, Tab};

// ---------------------------------------------------------------------------
// tab_list — return all tabs in order
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn tab_list(state: State<'_, AppState>) -> Vec<Tab> {
    let tabs = state.tabs.lock().unwrap();
    tabs.clone()
}

// ---------------------------------------------------------------------------
// tab_create — create a new tab (max 6)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn tab_create(state: State<'_, AppState>, name: String) -> Result<Tab, String> {
    let mut tabs = state.tabs.lock().unwrap();

    if tabs.len() >= 6 {
        return Err("Maximum of 6 tabs allowed".to_string());
    }

    let tab = Tab {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        layout: None,
    };

    tabs.push(tab.clone());
    drop(tabs);

    state.save_tabs();

    Ok(tab)
}

// ---------------------------------------------------------------------------
// tab_update — update name and/or layout of an existing tab
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn tab_update(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    layout: Option<serde_json::Value>,
) -> Result<(), String> {
    let mut tabs = state.tabs.lock().unwrap();

    let tab = tabs
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("Tab '{}' not found", id))?;

    if let Some(new_name) = name {
        tab.name = new_name;
    }
    if layout.is_some() {
        tab.layout = layout;
    }

    drop(tabs);

    state.save_tabs();

    Ok(())
}

// ---------------------------------------------------------------------------
// tab_delete — set all agents in the tab to dormant, then remove the tab
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn tab_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    {
        let tabs = state.tabs.lock().unwrap();
        if tabs.len() <= 1 {
            return Err("Cannot delete the last tab".to_string());
        }
        if !tabs.iter().any(|t| t.id == id) {
            return Err(format!("Tab '{}' not found", id));
        }
    }

    // Set all agents belonging to this tab to dormant
    {
        let mut agents = state.agents.lock().unwrap();
        for agent in agents.values_mut() {
            if agent.tab_id == id {
                agent.process_state = ProcessState::Dormant;
            }
        }
    }
    state.save_agents();

    // Remove the tab
    {
        let mut tabs = state.tabs.lock().unwrap();
        tabs.retain(|t| t.id != id);
    }
    state.save_tabs();

    Ok(())
}

// ---------------------------------------------------------------------------
// tab_reorder — reorder tabs according to the provided ordered list of IDs
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn tab_reorder(state: State<'_, AppState>, tab_ids: Vec<String>) -> Result<(), String> {
    let mut tabs = state.tabs.lock().unwrap();

    if tab_ids.len() != tabs.len() {
        return Err("tab_ids length must match current number of tabs".to_string());
    }

    let mut reordered: Vec<Tab> = Vec::with_capacity(tabs.len());
    for id in &tab_ids {
        let tab = tabs
            .iter()
            .find(|t| &t.id == id)
            .ok_or_else(|| format!("Tab '{}' not found", id))?
            .clone();
        reordered.push(tab);
    }

    *tabs = reordered;
    drop(tabs);

    state.save_tabs();

    Ok(())
}
