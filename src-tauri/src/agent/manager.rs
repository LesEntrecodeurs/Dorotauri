use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use super::event_bus::{AgentEvent, EventBus};
use super::model::{Agent, AgentId, AgentState, TabId};

pub struct AgentManager {
    agents: Mutex<HashMap<AgentId, Agent>>,
    event_bus: Arc<EventBus>,
    data_dir: PathBuf,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct AgentsFile {
    #[serde(default = "default_schema_version")]
    schema_version: u32,
    agents: HashMap<AgentId, Agent>,
}

fn default_schema_version() -> u32 {
    1
}

impl AgentManager {
    pub fn new(event_bus: Arc<EventBus>, data_dir: PathBuf) -> Self {
        AgentManager {
            agents: Mutex::new(HashMap::new()),
            event_bus,
            data_dir,
        }
    }

    /// Load agents from disk. Sync version for use during app startup
    /// (before tokio runtime is available).
    pub fn load_sync(&self) {
        let path = self.data_dir.join("agents.json");
        if !path.exists() {
            return;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => return,
        };
        let file: AgentsFile = match serde_json::from_str(&content) {
            Ok(f) => f,
            Err(_) => return,
        };
        // try_lock is safe here — called once at startup, no contention
        let mut agents = self.agents.try_lock().expect("load_sync: mutex should be uncontested at startup");
        *agents = file.agents;
    }

    pub async fn load(&self) {
        let path = self.data_dir.join("agents.json");
        if !path.exists() {
            return;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => return,
        };
        let file: AgentsFile = match serde_json::from_str(&content) {
            Ok(f) => f,
            Err(_) => return,
        };
        let mut agents = self.agents.lock().await;
        *agents = file.agents;
    }

    pub async fn save(&self) {
        let agents = self.agents.lock().await;
        let file = AgentsFile {
            schema_version: 2,
            agents: agents.clone(),
        };
        let path = self.data_dir.join("agents.json");
        if let Ok(json) = serde_json::to_string_pretty(&file) {
            let _ = std::fs::write(&path, json);
        }
    }

    pub async fn create(&self, agent: Agent) -> Agent {
        let agent_clone = agent.clone();
        self.agents
            .lock()
            .await
            .insert(agent.id.clone(), agent.clone());
        self.event_bus.emit(AgentEvent::Created {
            agent_id: agent.id.clone(),
            parent_id: agent.parent_id.clone(),
            tab_id: agent.tab_id.clone(),
        });
        self.save().await;
        agent_clone
    }

    pub async fn get(&self, id: &AgentId) -> Option<Agent> {
        self.agents.lock().await.get(id).cloned()
    }

    pub async fn list(&self, tab_id: Option<&TabId>) -> Vec<Agent> {
        let agents = self.agents.lock().await;
        agents
            .values()
            .filter(|a| tab_id.map_or(true, |tid| &a.tab_id == tid))
            .cloned()
            .collect()
    }

    pub async fn remove(&self, id: &AgentId) -> Option<Agent> {
        let removed = self.agents.lock().await.remove(id);
        if removed.is_some() {
            self.event_bus.emit(AgentEvent::Removed {
                agent_id: id.clone(),
            });
            self.save().await;
        }
        removed
    }

    pub async fn set_state(&self, id: &AgentId, new_state: AgentState) -> Result<Agent, String> {
        let mut agents = self.agents.lock().await;
        let agent = agents.get_mut(id).ok_or("agent not found")?;
        let old_state = agent.state.clone();
        old_state.can_transition_to(&new_state)?;

        agent.state = new_state.clone();
        agent.last_activity = chrono::Utc::now().to_rfc3339();
        let agent_clone = agent.clone();

        drop(agents);

        self.event_bus.emit(AgentEvent::StateChanged {
            agent_id: id.clone(),
            old: old_state,
            new: new_state,
        });

        self.save().await;
        Ok(agent_clone)
    }

    pub async fn update<F>(&self, id: &AgentId, updater: F) -> Result<Agent, String>
    where
        F: FnOnce(&mut Agent),
    {
        let mut agents = self.agents.lock().await;
        let agent = agents.get_mut(id).ok_or("agent not found")?;
        updater(agent);
        agent.last_activity = chrono::Utc::now().to_rfc3339();
        let agent_clone = agent.clone();
        drop(agents);
        self.save().await;
        Ok(agent_clone)
    }

    pub fn enforce_tab_visibility(caller: &Agent, target: &Agent) -> Result<(), String> {
        if caller.tab_id != target.tab_id {
            Err(format!(
                "agent '{}' is outside your tab (caller tab: {}, target tab: {})",
                target.id, caller.tab_id, target.tab_id
            ))
        } else {
            Ok(())
        }
    }

    pub fn assign_random_character() -> String {
        const CHARACTERS: &[&str] = &[
            "robot", "ninja", "wizard", "astronaut", "knight", "pirate", "alien", "viking", "frog",
        ];
        let idx = CHARACTERS.len();
        let random_byte = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos() as usize;
        CHARACTERS[random_byte % idx].to_string()
    }

    pub async fn set_status_line(&self, id: &AgentId, line: String) {
        let mut agents = self.agents.lock().await;
        if let Some(agent) = agents.get_mut(id) {
            agent.status_line = Some(line.clone());
        }
        drop(agents);

        self.event_bus.emit(AgentEvent::StatusLineUpdated {
            agent_id: id.clone(),
            line,
        });
        self.save().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    async fn test_manager() -> (AgentManager, Arc<EventBus>) {
        let bus = Arc::new(EventBus::new());
        let dir = tempdir().unwrap();
        let mgr = AgentManager::new(bus.clone(), dir.path().to_path_buf());
        (mgr, bus)
    }

    #[tokio::test]
    async fn test_create_and_get() {
        let (mgr, _bus) = test_manager().await;
        let agent = Agent::new("a1".into(), "/tmp".into(), "t1".into());
        mgr.create(agent.clone()).await;

        let found = mgr.get(&"a1".into()).await;
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, "a1");
    }

    #[tokio::test]
    async fn test_create_emits_event() {
        let (mgr, bus) = test_manager().await;
        let mut rx = bus.subscribe_events();

        let agent = Agent::new("a1".into(), "/tmp".into(), "t1".into());
        mgr.create(agent).await;

        let event = rx.try_recv().unwrap();
        match event {
            AgentEvent::Created { agent_id, .. } => assert_eq!(agent_id, "a1"),
            _ => panic!("expected Created event"),
        }
    }

    #[tokio::test]
    async fn test_list_all() {
        let (mgr, _) = test_manager().await;
        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;
        mgr.create(Agent::new("a2".into(), "/tmp".into(), "t2".into())).await;

        let all = mgr.list(None).await;
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn test_list_filtered_by_tab() {
        let (mgr, _) = test_manager().await;
        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;
        mgr.create(Agent::new("a2".into(), "/tmp".into(), "t2".into())).await;

        let filtered = mgr.list(Some(&"t1".into())).await;
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "a1");
    }

    #[tokio::test]
    async fn test_remove() {
        let (mgr, bus) = test_manager().await;
        let mut rx = bus.subscribe_events();

        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;
        let _ = rx.try_recv();

        let removed = mgr.remove(&"a1".into()).await;
        assert!(removed.is_some());
        assert!(mgr.get(&"a1".into()).await.is_none());

        let event = rx.try_recv().unwrap();
        match event {
            AgentEvent::Removed { agent_id } => assert_eq!(agent_id, "a1"),
            _ => panic!("expected Removed event"),
        }
    }

    #[tokio::test]
    async fn test_set_state_valid_transition() {
        let (mgr, _) = test_manager().await;
        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;

        let agent = mgr.set_state(&"a1".into(), AgentState::Running).await;
        assert!(agent.is_ok());
        assert_eq!(agent.unwrap().state, AgentState::Running);
    }

    #[tokio::test]
    async fn test_set_state_invalid_transition() {
        let (mgr, _) = test_manager().await;
        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;

        let result = mgr.set_state(&"a1".into(), AgentState::Completed).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_set_state_emits_event() {
        let (mgr, bus) = test_manager().await;
        let mut rx = bus.subscribe_events();
        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;
        let _ = rx.try_recv();

        mgr.set_state(&"a1".into(), AgentState::Running).await.unwrap();

        let event = rx.try_recv().unwrap();
        match event {
            AgentEvent::StateChanged { old, new, .. } => {
                assert_eq!(old, AgentState::Inactive);
                assert_eq!(new, AgentState::Running);
            }
            _ => panic!("expected StateChanged event"),
        }
    }

    #[test]
    fn test_enforce_tab_visibility_same_tab() {
        let caller = Agent::new("s1".into(), "/tmp".into(), "t1".into());
        let target = Agent::new("a1".into(), "/tmp".into(), "t1".into());

        assert!(AgentManager::enforce_tab_visibility(&caller, &target).is_ok());
    }

    #[test]
    fn test_enforce_tab_visibility_different_tab() {
        let caller = Agent::new("s1".into(), "/tmp".into(), "t1".into());
        let target = Agent::new("a1".into(), "/tmp".into(), "t2".into());

        assert!(AgentManager::enforce_tab_visibility(&caller, &target).is_err());
    }

    #[test]
    fn test_assign_random_character_is_valid() {
        let character = AgentManager::assign_random_character();
        const CHARACTERS: &[&str] = &[
            "robot", "ninja", "wizard", "astronaut", "knight", "pirate", "alien", "viking", "frog",
        ];
        assert!(CHARACTERS.contains(&character.as_str()));
    }

    #[tokio::test]
    async fn test_set_status_line() {
        let (mgr, bus) = test_manager().await;
        let mut rx = bus.subscribe_events();
        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;
        let _ = rx.try_recv();

        mgr.set_status_line(&"a1".into(), "task done".into()).await;

        let agent = mgr.get(&"a1".into()).await.unwrap();
        assert_eq!(agent.status_line, Some("task done".into()));

        let event = rx.try_recv().unwrap();
        match event {
            AgentEvent::StatusLineUpdated { line, .. } => assert_eq!(line, "task done"),
            _ => panic!("expected StatusLineUpdated event"),
        }
    }

    #[tokio::test]
    async fn test_persistence_round_trip() {
        let dir = tempdir().unwrap();
        let bus = Arc::new(EventBus::new());

        {
            let mgr = AgentManager::new(bus.clone(), dir.path().to_path_buf());
            mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;
        }

        {
            let mgr = AgentManager::new(bus.clone(), dir.path().to_path_buf());
            mgr.load().await;
            let agent = mgr.get(&"a1".into()).await;
            assert!(agent.is_some());
            assert_eq!(agent.unwrap().id, "a1");
        }
    }
}
