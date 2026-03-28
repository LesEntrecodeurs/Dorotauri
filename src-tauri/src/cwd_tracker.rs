use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::agent::manager::AgentManager;
use crate::agent::model::AgentId;

// ---------------------------------------------------------------------------
// Event payload emitted when an agent's cwd changes
// ---------------------------------------------------------------------------

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CwdChangedEvent {
    pub agent_id: String,
    pub cwd: String,
}

// ---------------------------------------------------------------------------
// CwdTracker — polls /proc/<pid>/cwd for each registered PTY's shell process
// ---------------------------------------------------------------------------

pub struct CwdTracker {
    /// Maps pty_id → child PID of the shell process.
    pids: Arc<Mutex<HashMap<String, u32>>>,
}

impl CwdTracker {
    pub fn new() -> Self {
        Self {
            pids: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Register a PTY's child shell PID so it gets polled.
    pub fn register(&self, pty_id: &str, pid: u32) {
        self.pids
            .lock()
            .unwrap()
            .insert(pty_id.to_string(), pid);
    }

    /// Stop tracking a PTY (e.g. when agent is stopped or dormant).
    pub fn unregister(&self, pty_id: &str) {
        self.pids.lock().unwrap().remove(pty_id);
    }

    // -------------------------------------------------------------------------
    // Platform-specific cwd resolution
    // -------------------------------------------------------------------------

    #[cfg(target_os = "linux")]
    fn get_cwd(pid: u32) -> Option<String> {
        std::fs::read_link(format!("/proc/{}/cwd", pid))
            .ok()
            .map(|p| p.to_string_lossy().to_string())
    }

    #[cfg(target_os = "macos")]
    fn get_cwd(pid: u32) -> Option<String> {
        // Stub: use `lsof -p <pid> -Fn -d cwd` and parse the 'n' line.
        let output = std::process::Command::new("lsof")
            .args(["-p", &pid.to_string(), "-Fn", "-d", "cwd"])
            .output()
            .ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        // lsof output has lines like:
        //   p<pid>
        //   fcwd
        //   n<path>
        for line in stdout.lines() {
            if let Some(path) = line.strip_prefix('n') {
                return Some(path.to_string());
            }
        }
        None
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    fn get_cwd(_pid: u32) -> Option<String> {
        None
    }

    // -------------------------------------------------------------------------
    // Polling loop
    // -------------------------------------------------------------------------

    /// Spawn an async task that polls every 2 seconds.
    ///
    /// Updates agent `cwd` in the AgentManager and persists changes to disk.
    pub fn start_polling(
        &self,
        app: AppHandle,
        agent_manager: Arc<AgentManager>,
    ) {
        let pids = Arc::clone(&self.pids);

        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;

                // --- Phase 1: collect (pty_id, pid) pairs ---
                let pid_snapshot: Vec<(String, u32)> = {
                    pids.lock()
                        .unwrap()
                        .iter()
                        .map(|(k, v)| (k.clone(), *v))
                        .collect()
                };

                if pid_snapshot.is_empty() {
                    continue;
                }

                // --- Phase 2: build pty_id → (agent_id, old_cwd) map from AgentManager ---
                let all_agents = agent_manager.list(None).await;
                let pty_to_agent: HashMap<String, (AgentId, String)> = all_agents
                    .into_iter()
                    .filter_map(|agent| {
                        let pty_id = agent.pty_id.clone()?;
                        Some((pty_id, (agent.id, agent.cwd)))
                    })
                    .collect();

                // --- Phase 3: resolve cwd for each pid and detect changes ---
                let mut updates: Vec<(AgentId, String)> = Vec::new();

                for (pty_id, pid) in &pid_snapshot {
                    let new_cwd = match Self::get_cwd(*pid) {
                        Some(c) => c,
                        None => continue,
                    };

                    if let Some((agent_id, old_cwd)) = pty_to_agent.get(pty_id) {
                        if new_cwd != *old_cwd {
                            updates.push((agent_id.clone(), new_cwd));
                        }
                    }
                }

                if updates.is_empty() {
                    continue;
                }

                // --- Phase 4: apply updates via AgentManager (persists to disk) ---
                for (agent_id, new_cwd) in &updates {
                    let cwd = new_cwd.clone();
                    let _ = agent_manager
                        .update(agent_id, |agent| {
                            agent.cwd = cwd;
                        })
                        .await;
                }

                // --- Phase 5: emit events to frontend ---
                for (agent_id, new_cwd) in updates {
                    let event = CwdChangedEvent {
                        agent_id: agent_id.clone(),
                        cwd: new_cwd,
                    };
                    app.emit("agent:cwd-changed", event).ok();
                }
            }
        });
    }
}
