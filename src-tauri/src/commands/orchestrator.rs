use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const MCP_SERVER_NAME: &str = "claude-mgr-orchestrator";

#[derive(Serialize)]
pub struct OrchestratorStatus {
    pub configured: bool,
}

#[derive(Serialize)]
pub struct OrchestratorSetupResult {
    pub success: bool,
}

fn mcp_config_path() -> PathBuf {
    dirs::home_dir()
        .expect("could not determine home directory")
        .join(".claude")
        .join("mcp.json")
}

/// Resolve the path to the MCP orchestrator bundle.js
fn bundle_path() -> Option<PathBuf> {
    // 1. Env override (dev)
    if let Ok(p) = std::env::var("DOROTORING_MCP_BUNDLE") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }

    // 2. Relative to current exe (production)
    if let Ok(exe) = std::env::current_exe() {
        for ancestor in exe.ancestors().skip(1) {
            let candidate = ancestor
                .join("mcp-orchestrator")
                .join("dist")
                .join("bundle.js");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    // 3. Fallback: dev workspace
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("mcp-orchestrator").join("dist").join("bundle.js"));
    if let Some(ref p) = dev {
        if p.exists() {
            return Some(p.clone());
        }
    }

    None
}

// --- Testable inner functions ---

pub(crate) fn get_status_inner(config_path: &Path) -> bool {
    fs::read_to_string(config_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("mcpServers")?.get(MCP_SERVER_NAME).cloned())
        .is_some()
}

pub(crate) fn setup_inner(config_path: &Path, bundle: &Path) -> Result<(), String> {
    let mut config: serde_json::Value = fs::read_to_string(config_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    config["mcpServers"][MCP_SERVER_NAME] = serde_json::json!({
        "command": "node",
        "args": [bundle.to_string_lossy()]
    });

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(config_path, format!("{}\n", json)).map_err(|e| e.to_string())
}

pub(crate) fn remove_inner(config_path: &Path) -> Result<(), String> {
    let mut config: serde_json::Value = fs::read_to_string(config_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if let Some(servers) = config.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
        servers.remove(MCP_SERVER_NAME);
    }

    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(config_path, format!("{}\n", json)).map_err(|e| e.to_string())
}

/// Auto-setup the MCP orchestrator at app startup.
pub fn ensure_orchestrator_setup() -> Result<(), String> {
    let bundle = bundle_path().ok_or("MCP orchestrator bundle not found")?;
    let config_path = mcp_config_path();
    if !get_status_inner(&config_path) {
        setup_inner(&config_path, &bundle)?;
    }
    crate::api_server::ensure_api_token();
    Ok(())
}

// --- Tauri command wrappers ---

#[tauri::command]
pub fn orchestrator_get_status() -> OrchestratorStatus {
    OrchestratorStatus {
        configured: get_status_inner(&mcp_config_path()),
    }
}

#[tauri::command]
pub fn orchestrator_setup() -> Result<OrchestratorSetupResult, String> {
    let bundle = bundle_path().ok_or("MCP orchestrator bundle not found")?;
    setup_inner(&mcp_config_path(), &bundle)?;
    Ok(OrchestratorSetupResult { success: true })
}

#[tauri::command]
pub fn orchestrator_remove() -> Result<OrchestratorSetupResult, String> {
    remove_inner(&mcp_config_path())?;
    Ok(OrchestratorSetupResult { success: true })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_config() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mcp.json");
        (dir, path)
    }

    fn fake_bundle(dir: &tempfile::TempDir) -> PathBuf {
        let p = dir.path().join("bundle.js");
        fs::write(&p, "// fake").unwrap();
        p
    }

    #[test]
    fn test_setup_creates_valid_mcp_json() {
        let (dir, config_path) = temp_config();
        let bundle = fake_bundle(&dir);

        setup_inner(&config_path, &bundle).unwrap();

        let raw = fs::read_to_string(&config_path).unwrap();
        let val: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let server = &val["mcpServers"]["claude-mgr-orchestrator"];
        assert_eq!(server["command"], "node");
        assert!(server["args"][0].as_str().unwrap().contains("bundle.js"));
    }

    #[test]
    fn test_setup_preserves_existing_servers() {
        let (dir, config_path) = temp_config();
        let bundle = fake_bundle(&dir);

        let existing = serde_json::json!({
            "mcpServers": {
                "other-server": { "command": "python", "args": ["server.py"] }
            }
        });
        fs::write(&config_path, serde_json::to_string_pretty(&existing).unwrap()).unwrap();

        setup_inner(&config_path, &bundle).unwrap();

        let raw = fs::read_to_string(&config_path).unwrap();
        let val: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(
            val["mcpServers"]["other-server"].is_object(),
            "existing server was deleted"
        );
        assert!(
            val["mcpServers"]["claude-mgr-orchestrator"].is_object(),
            "new server not added"
        );
    }

    #[test]
    fn test_remove_cleans_entry() {
        let (dir, config_path) = temp_config();
        let bundle = fake_bundle(&dir);

        setup_inner(&config_path, &bundle).unwrap();
        remove_inner(&config_path).unwrap();

        let raw = fs::read_to_string(&config_path).unwrap();
        let val: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(
            val["mcpServers"]["claude-mgr-orchestrator"].is_null(),
            "entry not removed"
        );
        assert!(val.is_object());
    }

    #[test]
    fn test_get_status_configured() {
        let (dir, config_path) = temp_config();
        let bundle = fake_bundle(&dir);

        setup_inner(&config_path, &bundle).unwrap();
        assert!(get_status_inner(&config_path));
    }

    #[test]
    fn test_get_status_not_configured() {
        let (_dir, config_path) = temp_config();
        assert!(!get_status_inner(&config_path));

        fs::write(&config_path, "{}").unwrap();
        assert!(!get_status_inner(&config_path));
    }
}
