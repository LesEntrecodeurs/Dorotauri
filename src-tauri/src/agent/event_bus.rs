use bytes::Bytes;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::broadcast;

use super::model::{AgentId, AgentState, TabId};

const GLOBAL_CHANNEL_CAPACITY: usize = 256;
const PTY_CHANNEL_CAPACITY: usize = 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    Created {
        agent_id: AgentId,
        parent_id: Option<AgentId>,
        tab_id: TabId,
    },
    StateChanged {
        agent_id: AgentId,
        old: AgentState,
        new: AgentState,
    },
    Removed {
        agent_id: AgentId,
    },
    StatusLineUpdated {
        agent_id: AgentId,
        line: String,
    },
}

pub struct EventBus {
    global_tx: broadcast::Sender<AgentEvent>,
    pty_channels: Mutex<HashMap<AgentId, broadcast::Sender<Bytes>>>,
}

impl EventBus {
    pub fn new() -> Self {
        let (global_tx, _) = broadcast::channel(GLOBAL_CHANNEL_CAPACITY);
        EventBus {
            global_tx,
            pty_channels: Mutex::new(HashMap::new()),
        }
    }

    pub fn emit(&self, event: AgentEvent) {
        let _ = self.global_tx.send(event);
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<AgentEvent> {
        self.global_tx.subscribe()
    }

    pub fn create_pty_channel(&self, agent_id: &AgentId) -> broadcast::Sender<Bytes> {
        let (tx, _) = broadcast::channel(PTY_CHANNEL_CAPACITY);
        let tx_clone = tx.clone();
        self.pty_channels
            .lock()
            .unwrap()
            .insert(agent_id.clone(), tx);
        tx_clone
    }

    pub fn remove_pty_channel(&self, agent_id: &AgentId) {
        self.pty_channels.lock().unwrap().remove(agent_id);
    }

    pub fn subscribe_pty(&self, agent_id: &AgentId) -> Option<broadcast::Receiver<Bytes>> {
        self.pty_channels
            .lock()
            .unwrap()
            .get(agent_id)
            .map(|tx| tx.subscribe())
    }

    pub fn push_pty_output(&self, agent_id: &AgentId, data: Bytes) -> bool {
        if let Some(tx) = self.pty_channels.lock().unwrap().get(agent_id) {
            let _ = tx.send(data);
            true
        } else {
            false
        }
    }

    pub fn has_pty_channel(&self, agent_id: &AgentId) -> bool {
        self.pty_channels.lock().unwrap().contains_key(agent_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_emit_with_no_subscribers_does_not_panic() {
        let bus = EventBus::new();
        bus.emit(AgentEvent::Removed {
            agent_id: "a1".into(),
        });
    }

    #[test]
    fn test_subscribe_receives_events() {
        let bus = EventBus::new();
        let mut rx = bus.subscribe_events();

        bus.emit(AgentEvent::Created {
            agent_id: "a1".into(),
            parent_id: None,
            tab_id: "t1".into(),
        });

        let event = rx.try_recv().unwrap();
        match event {
            AgentEvent::Created { agent_id, .. } => assert_eq!(agent_id, "a1"),
            _ => panic!("unexpected event type"),
        }
    }

    #[test]
    fn test_multiple_subscribers_receive_same_event() {
        let bus = EventBus::new();
        let mut rx1 = bus.subscribe_events();
        let mut rx2 = bus.subscribe_events();

        bus.emit(AgentEvent::Removed {
            agent_id: "a1".into(),
        });

        assert!(rx1.try_recv().is_ok());
        assert!(rx2.try_recv().is_ok());
    }

    #[test]
    fn test_pty_channel_lifecycle() {
        let bus = EventBus::new();

        assert!(!bus.has_pty_channel(&"a1".into()));
        assert!(bus.subscribe_pty(&"a1".into()).is_none());

        let _tx = bus.create_pty_channel(&"a1".into());
        assert!(bus.has_pty_channel(&"a1".into()));

        let mut rx = bus.subscribe_pty(&"a1".into()).unwrap();
        bus.push_pty_output(&"a1".into(), Bytes::from("hello"));
        let data = rx.try_recv().unwrap();
        assert_eq!(data, Bytes::from("hello"));

        bus.remove_pty_channel(&"a1".into());
        assert!(!bus.has_pty_channel(&"a1".into()));
    }

    #[test]
    fn test_push_pty_output_returns_false_when_no_channel() {
        let bus = EventBus::new();
        assert!(!bus.push_pty_output(&"nonexistent".into(), Bytes::from("data")));
    }

    #[test]
    fn test_agent_event_serializes_as_snake_case_tagged() {
        let event = AgentEvent::StateChanged {
            agent_id: "a1".into(),
            old: AgentState::Inactive,
            new: AgentState::Running,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "state_changed");
        assert_eq!(json["agent_id"], "a1");
        assert_eq!(json["old"], "inactive");
        assert_eq!(json["new"], "running");
    }
}
