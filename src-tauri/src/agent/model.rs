use serde::{Deserialize, Serialize};

pub type AgentId = String;
pub type TabId = String;
pub type PtyId = String;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentState {
    Inactive,
    Running,
    Waiting,
    Completed,
    Error,
    Dormant,
}

impl Default for AgentState {
    fn default() -> Self {
        AgentState::Inactive
    }
}

impl AgentState {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            AgentState::Completed | AgentState::Error | AgentState::Inactive | AgentState::Waiting
        )
    }

    pub fn is_active(&self) -> bool {
        matches!(self, AgentState::Running | AgentState::Waiting)
    }

    pub fn can_transition_to(&self, next: &AgentState) -> Result<(), String> {
        if matches!(next, AgentState::Dormant) {
            return Ok(());
        }

        match (self, next) {
            (AgentState::Inactive, AgentState::Running) => Ok(()),
            (AgentState::Running, AgentState::Completed) => Ok(()),
            (AgentState::Running, AgentState::Error) => Ok(()),
            (AgentState::Running, AgentState::Waiting) => Ok(()),
            (AgentState::Waiting, AgentState::Running) => Ok(()),
            (AgentState::Dormant, AgentState::Inactive) => Ok(()),
            (AgentState::Completed, AgentState::Running) => Ok(()),
            (AgentState::Error, AgentState::Running) => Ok(()),
            (AgentState::Running, AgentState::Inactive) => Ok(()),
            (AgentState::Waiting, AgentState::Inactive) => Ok(()),
            _ => Err(format!(
                "invalid state transition: {:?} → {:?}",
                self, next
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Codex,
    Gemini,
    Opencode,
    Pi,
    Local,
}

impl Default for Provider {
    fn default() -> Self {
        Provider::Claude
    }
}

impl Provider {
    pub fn from_str_opt(s: Option<&str>) -> Self {
        match s {
            Some("codex") => Provider::Codex,
            Some("gemini") => Provider::Gemini,
            Some("opencode") => Provider::Opencode,
            Some("pi") => Provider::Pi,
            Some("local") => Provider::Local,
            _ => Provider::Claude,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: AgentId,
    pub name: Option<String>,
    pub provider: Provider,

    pub tab_id: TabId,
    pub parent_id: Option<AgentId>,

    pub state: AgentState,
    pub pty_id: Option<PtyId>,

    pub cwd: String,
    pub secondary_paths: Vec<String>,
    pub skills: Vec<String>,
    pub character: Option<String>,

    pub status_line: Option<String>,
    pub error: Option<String>,

    pub last_activity: String,
    pub created_at: String,

    /// Whether this agent runs with --dangerously-skip-permissions.
    /// Kept in sync with the `__skip_permissions` skills marker.
    #[serde(default)]
    pub skip_permissions: bool,
}

impl Agent {
    pub fn new(id: AgentId, cwd: String, tab_id: TabId) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Agent {
            id,
            name: None,
            provider: Provider::default(),
            tab_id,
            parent_id: None,
            state: AgentState::default(),
            pty_id: None,
            cwd,
            secondary_paths: Vec::new(),
            skills: Vec::new(),
            character: None,
            status_line: None,
            error: None,
            last_activity: now.clone(),
            created_at: now,
            skip_permissions: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_state_default_is_inactive() {
        assert_eq!(AgentState::default(), AgentState::Inactive);
    }

    #[test]
    fn test_valid_state_transitions() {
        assert!(AgentState::Inactive.can_transition_to(&AgentState::Running).is_ok());
        assert!(AgentState::Running.can_transition_to(&AgentState::Completed).is_ok());
        assert!(AgentState::Running.can_transition_to(&AgentState::Error).is_ok());
        assert!(AgentState::Running.can_transition_to(&AgentState::Waiting).is_ok());
        assert!(AgentState::Waiting.can_transition_to(&AgentState::Running).is_ok());
        assert!(AgentState::Running.can_transition_to(&AgentState::Dormant).is_ok());
        assert!(AgentState::Inactive.can_transition_to(&AgentState::Dormant).is_ok());
        assert!(AgentState::Dormant.can_transition_to(&AgentState::Inactive).is_ok());
        assert!(AgentState::Completed.can_transition_to(&AgentState::Running).is_ok());
        assert!(AgentState::Error.can_transition_to(&AgentState::Running).is_ok());
        assert!(AgentState::Running.can_transition_to(&AgentState::Inactive).is_ok());
        assert!(AgentState::Waiting.can_transition_to(&AgentState::Inactive).is_ok());
    }

    #[test]
    fn test_invalid_state_transitions() {
        assert!(AgentState::Inactive.can_transition_to(&AgentState::Completed).is_err());
        assert!(AgentState::Completed.can_transition_to(&AgentState::Waiting).is_err());
        assert!(AgentState::Inactive.can_transition_to(&AgentState::Waiting).is_err());
    }

    #[test]
    fn test_is_terminal() {
        assert!(AgentState::Completed.is_terminal());
        assert!(AgentState::Error.is_terminal());
        assert!(AgentState::Inactive.is_terminal());
        assert!(AgentState::Waiting.is_terminal());
        assert!(!AgentState::Running.is_terminal());
        assert!(!AgentState::Dormant.is_terminal());
    }

    #[test]
    fn test_is_active() {
        assert!(AgentState::Running.is_active());
        assert!(AgentState::Waiting.is_active());
        assert!(!AgentState::Inactive.is_active());
        assert!(!AgentState::Completed.is_active());
    }

    #[test]
    fn test_provider_from_str() {
        assert_eq!(Provider::from_str_opt(Some("claude")), Provider::Claude);
        assert_eq!(Provider::from_str_opt(Some("codex")), Provider::Codex);
        assert_eq!(Provider::from_str_opt(Some("gemini")), Provider::Gemini);
        assert_eq!(Provider::from_str_opt(None), Provider::Claude);
        assert_eq!(Provider::from_str_opt(Some("unknown")), Provider::Claude);
    }

    #[test]
    fn test_agent_serializes_to_camel_case() {
        let agent = Agent::new("a1".into(), "/tmp".into(), "t1".into());
        let json = serde_json::to_value(&agent).unwrap();
        assert!(json.get("tabId").is_some());
        assert!(json.get("parentId").is_some());
        assert!(json.get("statusLine").is_some());
        assert!(json.get("createdAt").is_some());
        // skipPermissions must always be present (defaults to false)
        assert_eq!(json.get("skipPermissions").unwrap(), false);
    }

    #[test]
    fn test_skip_permissions_serializes() {
        let mut agent = Agent::new("a1".into(), "/tmp".into(), "t1".into());
        agent.skip_permissions = true;
        let json = serde_json::to_value(&agent).unwrap();
        assert_eq!(json.get("skipPermissions").unwrap(), true);
    }

    #[test]
    fn test_agent_state_serializes_lowercase() {
        let json = serde_json::to_string(&AgentState::Running).unwrap();
        assert_eq!(json, "\"running\"");
        let json = serde_json::to_string(&AgentState::Inactive).unwrap();
        assert_eq!(json, "\"inactive\"");
    }

}
