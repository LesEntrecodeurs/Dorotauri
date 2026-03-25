use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::state::{Agent, AgentId};

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

    /// Spawn a background thread that polls every 2 seconds.
    ///
    /// The agents mutex is passed in so the tracker can update `cwd` and
    /// `path_missing` directly.  To minimise lock contention, cwd values are
    /// collected outside the agents lock, and the lock is only held briefly to
    /// apply the changes.
    pub fn start_polling(
        &self,
        app: AppHandle,
        agents: Arc<Mutex<HashMap<AgentId, Agent>>>,
    ) {
        let pids = Arc::clone(&self.pids);

        thread::spawn(move || {
            loop {
                thread::sleep(Duration::from_secs(2));

                // --- Phase 1: collect (pty_id, pid) pairs without holding the agents lock ---
                let pid_snapshot: Vec<(String, u32)> = {
                    pids.lock()
                        .unwrap()
                        .iter()
                        .map(|(k, v)| (k.clone(), *v))
                        .collect()
                };

                // --- Phase 2: resolve cwd for each pid (no locks held) ---
                // We need to map pty_id → agent_id, which requires a brief
                // read of the agents map.
                let pty_to_agent: HashMap<String, (AgentId, String)> = {
                    let locked = agents.lock().unwrap();
                    locked
                        .iter()
                        .filter_map(|(agent_id, agent)| {
                            let pty_id = agent.pty_id.as_ref()?;
                            Some((pty_id.clone(), (agent_id.clone(), agent.cwd.clone())))
                        })
                        .collect()
                };

                // For each registered pty, resolve new cwd outside any lock.
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

                // --- Phase 3: apply updates — briefly acquire agents lock ---
                {
                    let mut locked = agents.lock().unwrap();
                    for (agent_id, new_cwd) in &updates {
                        if let Some(agent) = locked.get_mut(agent_id) {
                            agent.cwd = new_cwd.clone();
                            agent.path_missing = if std::path::Path::new(new_cwd).exists() {
                                None
                            } else {
                                Some(true)
                            };
                        }
                    }
                }

                // --- Phase 4: emit events (no lock needed) ---
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
