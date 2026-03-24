use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

pub type AgentId = String;
pub type PtyId = String;

// ---------------------------------------------------------------------------
// AgentState enum — mirrors TS: 'idle' | 'running' | 'completed' | 'error' | 'waiting'
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentState {
    Idle,
    Running,
    Completed,
    Error,
    Waiting,
}

// ---------------------------------------------------------------------------
// AgentStatus — mirrors electron/types/index.ts AgentStatus
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub id: AgentId,
    pub status: AgentState,
    pub project_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_project_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_task: Option<String>,
    #[serde(default)]
    pub output: Vec<String>,
    pub last_activity: String,
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
    pub last_clean_output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kanban_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_session_id: Option<String>,
    #[serde(default)]
    pub path_missing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obsidian_vault_paths: Option<Vec<String>>,
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
    pub agents: Mutex<HashMap<AgentId, AgentStatus>>,
    pub settings: Mutex<AppSettings>,
}

impl AppState {
    /// Load persisted state from ~/.dorothy/ (same location as the Electron app).
    pub fn load() -> Self {
        let dorothy_dir = dorothy_dir();
        fs::create_dir_all(&dorothy_dir).ok();

        let agents = Self::load_agents(&dorothy_dir);
        let settings = Self::load_settings(&dorothy_dir);

        Self {
            agents: Mutex::new(agents),
            settings: Mutex::new(settings),
        }
    }

    fn load_agents(dir: &PathBuf) -> HashMap<AgentId, AgentStatus> {
        let path = dir.join("agents.json");
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn load_settings(dir: &PathBuf) -> AppSettings {
        let path = dir.join("app-settings.json");
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// Persist agents map to ~/.dorothy/agents.json
    pub fn save_agents(&self) {
        let dir = dorothy_dir();
        let agents = self.agents.lock().unwrap();
        if let Ok(json) = serde_json::to_string_pretty(&*agents) {
            fs::write(dir.join("agents.json"), json).ok();
        }
    }

    /// Persist settings to ~/.dorothy/app-settings.json
    pub fn save_settings(&self) {
        let dir = dorothy_dir();
        let settings = self.settings.lock().unwrap();
        if let Ok(json) = serde_json::to_string_pretty(&*settings) {
            fs::write(dir.join("app-settings.json"), json).ok();
        }
    }
}

/// Canonical Dorothy config directory.
fn dorothy_dir() -> PathBuf {
    dirs::home_dir()
        .expect("could not determine home directory")
        .join(".dorothy")
}
