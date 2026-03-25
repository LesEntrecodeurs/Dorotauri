use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub type AgentId = String;
pub type PtyId = String;

// ---------------------------------------------------------------------------
// ProcessState enum — lifecycle state of an agent/terminal process
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProcessState {
    Inactive,
    Running,
    Waiting,
    Error,
    Completed,
    Dormant,
}

impl Default for ProcessState {
    fn default() -> Self {
        ProcessState::Inactive
    }
}

// ---------------------------------------------------------------------------
// Agent — unified agent/terminal primitive
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: AgentId,
    pub process_state: ProcessState,
    pub cwd: String,
    #[serde(default)]
    pub secondary_paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub output: Vec<String>,
    pub last_activity: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pty_id: Option<PtyId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub character: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default)]
    pub skip_permissions: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_line: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kanban_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_missing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obsidian_vault_paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub business_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub business_state_updated_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub business_state_updated_at: Option<String>,
    pub tab_id: String,
    #[serde(default)]
    pub is_super_agent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub super_agent_scope: Option<String>,
    #[serde(default)]
    pub scheduled_task_ids: Vec<String>,
    #[serde(default)]
    pub automation_ids: Vec<String>,
}

impl Default for Agent {
    fn default() -> Self {
        Self {
            id: String::new(),
            process_state: ProcessState::Inactive,
            cwd: String::new(),
            secondary_paths: Vec::new(),
            role: None,
            worktree_path: None,
            branch_name: None,
            skills: Vec::new(),
            output: Vec::new(),
            last_activity: String::new(),
            created_at: String::new(),
            error: None,
            pty_id: None,
            character: None,
            name: None,
            skip_permissions: false,
            provider: None,
            status_line: None,
            local_model: None,
            kanban_task_id: None,
            current_session_id: None,
            path_missing: None,
            obsidian_vault_paths: None,
            business_state: None,
            business_state_updated_by: None,
            business_state_updated_at: None,
            tab_id: "general".to_string(),
            is_super_agent: false,
            super_agent_scope: None,
            scheduled_task_ids: Vec::new(),
            automation_ids: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// AgentsFile — versioned wrapper around the agents HashMap
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsFile {
    pub schema_version: u32,
    pub agents: HashMap<AgentId, Agent>,
}

// ---------------------------------------------------------------------------
// NotificationSounds — nested object within AppSettings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NotificationSounds {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waiting: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub complete: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// CliPaths — mirrors electron/types/index.ts CLIPaths
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliPaths {
    #[serde(default = "default_claude")]
    pub claude: String,
    #[serde(default = "default_codex")]
    pub codex: String,
    #[serde(default = "default_gemini")]
    pub gemini: String,
    #[serde(default = "default_opencode")]
    pub opencode: String,
    #[serde(default = "default_pi")]
    pub pi: String,
    #[serde(default = "default_gws")]
    pub gws: String,
    #[serde(default = "default_gcloud")]
    pub gcloud: String,
    #[serde(default = "default_gh")]
    pub gh: String,
    #[serde(default = "default_node")]
    pub node: String,
    #[serde(default)]
    pub additional_paths: Vec<String>,
}

impl Default for CliPaths {
    fn default() -> Self {
        Self {
            claude: default_claude(),
            codex: default_codex(),
            gemini: default_gemini(),
            opencode: default_opencode(),
            pi: default_pi(),
            gws: default_gws(),
            gcloud: default_gcloud(),
            gh: default_gh(),
            node: default_node(),
            additional_paths: Vec::new(),
        }
    }
}

fn default_claude() -> String {
    "claude".into()
}
fn default_codex() -> String {
    "codex".into()
}
fn default_gemini() -> String {
    "gemini".into()
}
fn default_opencode() -> String {
    "opencode".into()
}
fn default_pi() -> String {
    "pi".into()
}
fn default_gws() -> String {
    "gws".into()
}
fn default_gcloud() -> String {
    "gcloud".into()
}
fn default_gh() -> String {
    "gh".into()
}
fn default_node() -> String {
    "node".into()
}

// ---------------------------------------------------------------------------
// AppSettings — mirrors electron/types/index.ts AppSettings
// All fields use #[serde(default)] so deserializing old config files never fails.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_true")]
    pub notifications_enabled: bool,
    #[serde(default = "default_true")]
    pub notify_on_waiting: bool,
    #[serde(default = "default_true")]
    pub notify_on_complete: bool,
    #[serde(default)]
    pub notify_on_stop: bool,
    #[serde(default = "default_true")]
    pub notify_on_error: bool,
    #[serde(default)]
    pub telegram_enabled: bool,
    #[serde(default)]
    pub telegram_bot_token: String,
    #[serde(default)]
    pub telegram_chat_id: String,
    #[serde(default)]
    pub telegram_auth_token: String,
    #[serde(default)]
    pub telegram_authorized_chat_ids: Vec<String>,
    #[serde(default)]
    pub telegram_require_mention: bool,
    #[serde(default)]
    pub slack_enabled: bool,
    #[serde(default)]
    pub slack_bot_token: String,
    #[serde(default)]
    pub slack_app_token: String,
    #[serde(default)]
    pub slack_signing_secret: String,
    #[serde(default)]
    pub slack_channel_id: String,
    #[serde(default)]
    pub jira_enabled: bool,
    #[serde(default)]
    pub jira_domain: String,
    #[serde(default)]
    pub jira_email: String,
    #[serde(default)]
    pub jira_api_token: String,
    #[serde(default)]
    pub social_data_enabled: bool,
    #[serde(default)]
    pub social_data_api_key: String,
    #[serde(default)]
    pub x_posting_enabled: bool,
    #[serde(default)]
    pub x_api_key: String,
    #[serde(default)]
    pub x_api_secret: String,
    #[serde(default)]
    pub x_access_token: String,
    #[serde(default)]
    pub x_access_token_secret: String,
    #[serde(default)]
    pub tasmania_enabled: bool,
    #[serde(default)]
    pub tasmania_server_path: String,
    #[serde(default)]
    pub gws_enabled: bool,
    #[serde(default)]
    pub gws_skills_installed: bool,
    #[serde(default)]
    pub verbose_mode_enabled: bool,
    #[serde(default = "default_true")]
    pub auto_check_updates: bool,
    #[serde(default)]
    pub cli_paths: CliPaths,
    #[serde(default)]
    pub opencode_enabled: bool,
    #[serde(default)]
    pub opencode_default_model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obsidian_vault_paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notification_sounds: Option<NotificationSounds>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_font_size: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_line_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favorite_projects: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden_projects: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_project_path: Option<String>,
}

fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            notifications_enabled: true,
            notify_on_waiting: true,
            notify_on_complete: true,
            notify_on_stop: false,
            notify_on_error: true,
            telegram_enabled: false,
            telegram_bot_token: String::new(),
            telegram_chat_id: String::new(),
            telegram_auth_token: String::new(),
            telegram_authorized_chat_ids: Vec::new(),
            telegram_require_mention: false,
            slack_enabled: false,
            slack_bot_token: String::new(),
            slack_app_token: String::new(),
            slack_signing_secret: String::new(),
            slack_channel_id: String::new(),
            jira_enabled: false,
            jira_domain: String::new(),
            jira_email: String::new(),
            jira_api_token: String::new(),
            social_data_enabled: false,
            social_data_api_key: String::new(),
            x_posting_enabled: false,
            x_api_key: String::new(),
            x_api_secret: String::new(),
            x_access_token: String::new(),
            x_access_token_secret: String::new(),
            tasmania_enabled: false,
            tasmania_server_path: String::new(),
            gws_enabled: false,
            gws_skills_installed: false,
            verbose_mode_enabled: false,
            auto_check_updates: true,
            cli_paths: CliPaths::default(),
            opencode_enabled: false,
            opencode_default_model: String::new(),
            default_provider: None,
            obsidian_vault_paths: None,
            notification_sounds: None,
            terminal_font_size: None,
            terminal_theme: None,
            status_line_enabled: None,
            favorite_projects: None,
            hidden_projects: None,
            default_project_path: None,
        }
    }
}

// ---------------------------------------------------------------------------
// AppState — top-level Tauri managed state
// ---------------------------------------------------------------------------

pub struct AppState {
    pub agents: Arc<Mutex<HashMap<AgentId, Agent>>>,
    pub settings: Mutex<AppSettings>,
}

impl AppState {
    /// Load persisted state from ~/.dorotauri/ (same location as the Electron app).
    pub fn load() -> Self {
        let dorotauri_dir = dorotauri_dir();
        fs::create_dir_all(&dorotauri_dir).ok();

        let agents = Self::load_agents(&dorotauri_dir);
        let settings = Self::load_settings(&dorotauri_dir);

        Self {
            agents: Arc::new(Mutex::new(agents)),
            settings: Mutex::new(settings),
        }
    }

    fn load_agents(dir: &PathBuf) -> HashMap<AgentId, Agent> {
        let path = dir.join("agents.json");
        let raw = match fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => return HashMap::new(),
        };

        // Try to parse as the new versioned AgentsFile format first
        if let Ok(file) = serde_json::from_str::<AgentsFile>(&raw) {
            return file.agents;
        }

        // Fall back: try the old bare HashMap<AgentId, serde_json::Value> and migrate
        if let Ok(old_map) =
            serde_json::from_str::<HashMap<String, serde_json::Value>>(&raw)
        {
            match crate::migration::migrate_v0_to_v1(old_map, &path) {
                Ok(agents) => return agents,
                Err(e) => {
                    eprintln!("[state] migration failed: {e}; attempting to load backup as dormant agents");
                    let backup_path = path.with_extension("v0.backup");
                    if let Ok(backup_raw) = fs::read_to_string(&backup_path) {
                        if let Ok(backup_map) =
                            serde_json::from_str::<HashMap<String, serde_json::Value>>(&backup_raw)
                        {
                            let dormant_agents: HashMap<AgentId, Agent> = backup_map
                                .into_iter()
                                .filter_map(|(id, value)| {
                                    let cwd = value
                                        .get("projectPath")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let name = value
                                        .get("name")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string());
                                    let agent = Agent {
                                        id: id.clone(),
                                        cwd,
                                        name,
                                        process_state: ProcessState::Dormant,
                                        tab_id: "general".to_string(),
                                        ..Default::default()
                                    };
                                    Some((id, agent))
                                })
                                .collect();
                            eprintln!(
                                "[state] loaded {} dormant agent(s) from backup",
                                dormant_agents.len()
                            );
                            return dormant_agents;
                        }
                    }
                    eprintln!("[state] backup not readable; starting with empty agent list");
                }
            }
        }

        HashMap::new()
    }

    fn load_settings(dir: &PathBuf) -> AppSettings {
        let path = dir.join("app-settings.json");
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// Persist agents map to ~/.dorotauri/agents.json (wrapped in AgentsFile)
    pub fn save_agents(&self) {
        let dir = dorotauri_dir();
        let agents = self.agents.lock().unwrap();
        let file = AgentsFile {
            schema_version: 1,
            agents: agents.clone(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&file) {
            fs::write(dir.join("agents.json"), json).ok();
        }
    }

    /// Persist settings to ~/.dorotauri/app-settings.json
    pub fn save_settings(&self) {
        let dir = dorotauri_dir();
        let settings = self.settings.lock().unwrap();
        if let Ok(json) = serde_json::to_string_pretty(&*settings) {
            fs::write(dir.join("app-settings.json"), json).ok();
        }
    }
}

/// Canonical Dorotauri config directory.
fn dorotauri_dir() -> PathBuf {
    dirs::home_dir()
        .expect("could not determine home directory")
        .join(".dorotauri")
}
