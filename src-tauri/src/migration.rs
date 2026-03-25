use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::state::{Agent, AgentId, ProcessState};

/// Maximum number of output lines to carry forward during migration.
const MAX_OUTPUT_LINES: usize = 10_000;

/// Migrate a v0 agents file (bare `HashMap<id, Value>`) to the v1 `Agent` model.
///
/// Steps:
/// 1. Write a `.v0.backup` file next to the source path.
/// 2. Convert each old agent value into the new `Agent` struct.
/// 3. Return the resulting map so the caller can persist it as `AgentsFile { schema_version: 1, ... }`.
///
/// On any failure the function returns `Err` and the caller falls back gracefully.
pub fn migrate_v0_to_v1(
    old_map: HashMap<String, serde_json::Value>,
    agents_path: &Path,
) -> Result<HashMap<AgentId, Agent>, String> {
    // ------------------------------------------------------------------
    // 1. Create backup
    // ------------------------------------------------------------------
    let backup_path = agents_path.with_extension("v0.backup");
    let raw = fs::read_to_string(agents_path)
        .map_err(|e| format!("could not read agents file for backup: {e}"))?;
    fs::write(&backup_path, &raw)
        .map_err(|e| format!("could not write backup to {}: {e}", backup_path.display()))?;

    // ------------------------------------------------------------------
    // 2. Convert each agent
    // ------------------------------------------------------------------
    let now = chrono::Utc::now().to_rfc3339();
    let mut new_map: HashMap<AgentId, Agent> = HashMap::new();

    for (id, value) in old_map {
        let agent = convert_v0_agent(&id, &value, &now);
        new_map.insert(id, agent);
    }

    Ok(new_map)
}

/// Convert a single v0 agent JSON value into the new `Agent` struct.
fn convert_v0_agent(id: &str, v: &serde_json::Value, now: &str) -> Agent {
    // Helper closures
    let str_field = |key: &str| -> Option<String> {
        v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
    };
    let bool_field = |key: &str| -> bool {
        v.get(key).and_then(|x| x.as_bool()).unwrap_or(false)
    };
    let str_vec_field = |key: &str| -> Vec<String> {
        v.get(key)
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|e| e.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    };

    // cwd: projectPath → cwd
    let cwd = str_field("projectPath").unwrap_or_default();

    // secondary_paths: secondaryProjectPath (single string) → Vec
    let secondary_paths = match str_field("secondaryProjectPath") {
        Some(s) if !s.is_empty() => vec![s],
        _ => Vec::new(),
    };

    // Output buffer — cap at MAX_OUTPUT_LINES
    let output: Vec<String> = {
        let full = str_vec_field("output");
        if full.len() > MAX_OUTPUT_LINES {
            full[full.len() - MAX_OUTPUT_LINES..].to_vec()
        } else {
            full
        }
    };

    // status_line: carry statusLine forward; merge lastCleanOutput if statusLine absent
    let status_line = str_field("statusLine").or_else(|| str_field("lastCleanOutput"));

    // lastActivity → both last_activity and created_at (best available timestamp)
    let last_activity = str_field("lastActivity").unwrap_or_else(|| now.to_string());
    let created_at = last_activity.clone();

    // All agents become Dormant after migration (no PTY survives restart)
    Agent {
        id: id.to_string(),
        process_state: ProcessState::Dormant,
        cwd,
        secondary_paths,
        role: None,
        worktree_path: str_field("worktreePath"),
        branch_name: str_field("branchName"),
        skills: str_vec_field("skills"),
        output,
        last_activity,
        created_at,
        error: str_field("error"),
        pty_id: None, // PTY never survives restart
        character: str_field("character"),
        name: str_field("name"),
        skip_permissions: bool_field("skipPermissions"),
        provider: str_field("provider"),
        status_line,
        local_model: str_field("localModel"),
        kanban_task_id: str_field("kanbanTaskId"),
        current_session_id: str_field("currentSessionId"),
        path_missing: None,
        obsidian_vault_paths: v
            .get("obsidianVaultPaths")
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|e| e.as_str().map(|s| s.to_string()))
                    .collect()
            }),
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
