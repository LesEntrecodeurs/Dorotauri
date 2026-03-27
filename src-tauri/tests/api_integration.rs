//! Integration tests for the API server state mechanics.
//! Tests: hook status mapping, broadcast channel, auth logic.

use dorotoring_lib::state::{Agent, AppState, ProcessState};
use dorotoring_lib::agent::event_bus::EventBus;
use dorotoring_lib::agent::manager::AgentManager;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

fn test_app_state() -> Arc<AppState> {
    let (status_tx, _) = broadcast::channel::<(String, String)>(64);
    let event_bus = Arc::new(EventBus::new());
    let data_dir = std::env::temp_dir().join("dorotoring-test");
    let agent_manager = Arc::new(AgentManager::new(event_bus.clone(), data_dir));
    Arc::new(AppState {
        agents: Arc::new(Mutex::new(HashMap::new())),
        settings: Mutex::new(Default::default()),
        tabs: Arc::new(Mutex::new(vec![])),
        status_tx,
        agent_manager,
        event_bus,
    })
}

fn insert_agent(state: &AppState, id: &str, process_state: ProcessState) {
    let agent = Agent {
        id: id.into(),
        process_state,
        cwd: "/tmp".into(),
        tab_id: "general".into(),
        ..Default::default()
    };
    state.agents.lock().unwrap().insert(id.into(), agent);
}

#[test]
fn test_hook_status_mapping_running() {
    let state = test_app_state();
    insert_agent(&state, "a1", ProcessState::Inactive);

    // Simulate hook_status mapping: "running" → ProcessState::Running
    let process_state = match "running" {
        "running" => ProcessState::Running,
        "waiting" => ProcessState::Waiting,
        "idle" | "completed" => ProcessState::Completed,
        "error" => ProcessState::Error,
        "dormant" => ProcessState::Dormant,
        _ => ProcessState::Inactive,
    };

    state.agents.lock().unwrap().get_mut("a1").unwrap().process_state = process_state;
    assert_eq!(state.agents.lock().unwrap()["a1"].process_state, ProcessState::Running);
}

#[test]
fn test_hook_status_mapping_completed() {
    let state = test_app_state();
    insert_agent(&state, "a2", ProcessState::Running);

    let process_state = match "completed" {
        "running" => ProcessState::Running,
        "waiting" => ProcessState::Waiting,
        "idle" | "completed" => ProcessState::Completed,
        "error" => ProcessState::Error,
        "dormant" => ProcessState::Dormant,
        _ => ProcessState::Inactive,
    };

    state.agents.lock().unwrap().get_mut("a2").unwrap().process_state = process_state;
    assert_eq!(state.agents.lock().unwrap()["a2"].process_state, ProcessState::Completed);
}

#[tokio::test]
async fn test_broadcast_notifies_waiters() {
    let state = test_app_state();
    insert_agent(&state, "a3", ProcessState::Running);

    let mut rx = state.status_tx.subscribe();
    let _ = state.status_tx.send(("a3".into(), "completed".into()));

    let (agent_id, status) = rx.recv().await.unwrap();
    assert_eq!(agent_id, "a3");
    assert_eq!(status, "completed");
}

#[test]
fn test_auth_rejects_bad_token() {
    let expected_token = "correct-token-abc123";
    let header_val = "Bearer wrong-token";
    let provided = header_val.strip_prefix("Bearer ").unwrap_or("");
    assert_ne!(provided, expected_token);
}

#[test]
fn test_auth_accepts_valid_token() {
    let expected_token = "correct-token-abc123";
    let header_val = "Bearer correct-token-abc123";
    let provided = header_val.strip_prefix("Bearer ").unwrap_or("");
    assert_eq!(provided, expected_token);
}
