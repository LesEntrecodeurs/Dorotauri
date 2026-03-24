use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub id: String,
    pub window_type: WindowType,
    pub displayed_agents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum WindowType {
    Hub,
    Console { agent_id: String },
}

pub struct WindowRegistry {
    pub windows: Mutex<HashMap<String, WindowInfo>>,
    pub focused_window: Mutex<Option<String>>,
}

impl WindowRegistry {
    pub fn new() -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
            focused_window: Mutex::new(None),
        }
    }

    pub fn register(&self, id: &str, info: WindowInfo) {
        self.windows.lock().unwrap().insert(id.to_string(), info);
    }

    pub fn unregister(&self, id: &str) {
        self.windows.lock().unwrap().remove(id);
    }

    pub fn find_window_for_agent(&self, agent_id: &str) -> Option<String> {
        let windows = self.windows.lock().unwrap();
        // Prefer pop-out console windows
        for (id, info) in windows.iter() {
            if let WindowType::Console { agent_id: ref aid } = info.window_type {
                if aid == agent_id {
                    return Some(id.clone());
                }
            }
        }
        // Fall back to hub if agent is displayed there
        for (id, info) in windows.iter() {
            if matches!(info.window_type, WindowType::Hub) {
                if info.displayed_agents.contains(&agent_id.to_string()) {
                    return Some(id.clone());
                }
            }
        }
        None
    }

    pub fn has_focus(&self) -> bool {
        self.focused_window.lock().unwrap().is_some()
    }
}
