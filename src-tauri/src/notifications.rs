use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use crate::windows::WindowRegistry;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InAppNotification {
    pub agent_id: String,
    pub title: String,
    pub body: String,
    pub notification_type: String, // "complete", "error", "waiting"
}

pub fn notify_agent_event(
    app: &AppHandle,
    registry: &WindowRegistry,
    agent_id: &str,
    agent_name: &str,
    notification_type: &str, // "complete", "error", "waiting"
) {
    let title = match notification_type {
        "complete" => format!("{} completed", agent_name),
        "error" => format!("{} encountered an error", agent_name),
        "waiting" => format!("{} needs input", agent_name),
        _ => format!("{} — {}", agent_name, notification_type),
    };
    let body = match notification_type {
        "complete" => "Agent has finished its task.".to_string(),
        "error" => "Agent stopped with an error.".to_string(),
        "waiting" => "Agent is waiting for your input.".to_string(),
        _ => String::new(),
    };

    if registry.has_focus() {
        // App is focused — emit in-app notification
        let _ = app.emit("notification:in-app", InAppNotification {
            agent_id: agent_id.to_string(),
            title,
            body,
            notification_type: notification_type.to_string(),
        });
    } else {
        // App not focused — OS notification
        let _ = app.notification()
            .builder()
            .title(&title)
            .body(&body)
            .show();
    }
}
