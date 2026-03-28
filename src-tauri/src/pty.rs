use bytes::Bytes;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast;

use crate::state::PtyId;

// ---------------------------------------------------------------------------
// Event payload sent to the frontend for xterm.js consumption
// ---------------------------------------------------------------------------

#[derive(Clone, serde::Serialize)]
pub struct PtyOutputEvent {
    pub agent_id: String,
    pub pty_id: String,
    pub data: Vec<u8>,
}

// ---------------------------------------------------------------------------
// PtyHandle — wraps the master writer and child process for a single PTY
// ---------------------------------------------------------------------------

pub struct PtyHandle {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send>,
    pub agent_id: String,
    pub child_pid: Option<u32>,
    pub paused: Arc<AtomicBool>,
}

// ---------------------------------------------------------------------------
// PtyManager — Tauri-managed state that owns all active PTYs
// ---------------------------------------------------------------------------

pub struct PtyManager {
    pub handles: Mutex<HashMap<PtyId, PtyHandle>>,
    /// Maps an external key (e.g. agentId) to the ptyId that serves it.
    /// Multiple keys can point to the same ptyId (hub + pop-out sharing).
    pub registry: Mutex<HashMap<String, PtyId>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            handles: Mutex::new(HashMap::new()),
            registry: Mutex::new(HashMap::new()),
        }
    }

    /// Spawn a new PTY in `cwd`. Returns the pty_id.
    ///
    /// A background reader thread is started that emits `agent:output` events
    /// containing raw bytes for xterm.js.
    pub fn spawn(
        &self,
        pty_id: &str,
        agent_id: &str,
        cwd: &str,
        app_handle: &AppHandle,
        cols: Option<u16>,
        rows: Option<u16>,
        event_bus_tx: Option<broadcast::Sender<Bytes>>,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();

        let size = PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| format!("failed to open pty: {e}"))?;

        // Spawn a shell inside the PTY
        let mut cmd = CommandBuilder::new("bash");
        cmd.arg("--login");
        cmd.cwd(cwd);

        // Remove CLAUDECODE env var so nested Claude Code sessions can launch
        cmd.env_remove("CLAUDECODE");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("failed to spawn shell: {e}"))?;

        let child_pid = child.process_id().map(|p| p as u32);

        // Writer for sending input to the PTY
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("failed to take writer: {e}"))?;

        // Reader for capturing PTY output
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("failed to clone reader: {e}"))?;

        // Start background reader thread
        let handle = app_handle.clone();
        let pty_id_owned = pty_id.to_string();
        let agent_id_owned = agent_id.to_string();

        let paused = Arc::new(AtomicBool::new(false));
        let paused_clone = Arc::clone(&paused);

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        // Flow control: wait while paused (max 500 iterations = 5s safety)
                        let mut wait_count = 0;
                        while paused_clone.load(Ordering::Relaxed) && wait_count < 500 {
                            thread::sleep(std::time::Duration::from_millis(10));
                            wait_count += 1;
                        }
                        // Auto-resume after safety timeout
                        if wait_count >= 500 {
                            paused_clone.store(false, Ordering::Relaxed);
                        }

                        let data = &buf[..n];

                        // Push to EventBus for WebSocket streaming
                        if let Some(ref tx) = event_bus_tx {
                            let _ = tx.send(Bytes::copy_from_slice(data));
                        }

                        // Emit Tauri event for legacy frontend consumers
                        let event = PtyOutputEvent {
                            agent_id: agent_id_owned.clone(),
                            pty_id: pty_id_owned.clone(),
                            data: data.to_vec(),
                        };
                        if handle.emit("agent:output", event).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // Store the handle (keep master for resize support)
        let pty_handle = PtyHandle {
            master: pair.master,
            writer,
            child,
            agent_id: agent_id.to_string(),
            child_pid,
            paused,
        };

        self.handles
            .lock()
            .unwrap()
            .insert(pty_id.to_string(), pty_handle);

        Ok(())
    }

    /// Write raw bytes to a PTY's stdin.
    pub fn write(&self, pty_id: &str, data: &[u8]) -> Result<(), String> {
        let mut handles = self.handles.lock().unwrap();
        let handle = handles
            .get_mut(pty_id)
            .ok_or_else(|| format!("pty not found: {pty_id}"))?;
        handle
            .writer
            .write_all(data)
            .map_err(|e| format!("write error: {e}"))?;
        handle
            .writer
            .flush()
            .map_err(|e| format!("flush error: {e}"))?;
        Ok(())
    }

    /// Resize a PTY.
    pub fn resize(&self, pty_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let handles = self.handles.lock().unwrap();
        let handle = handles
            .get(pty_id)
            .ok_or_else(|| format!("pty not found: {pty_id}"))?;
        handle
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize error: {e}"))
    }

    /// Kill a PTY process and remove it from the map.
    pub fn kill(&self, pty_id: &str) -> Result<(), String> {
        let mut handles = self.handles.lock().unwrap();
        if let Some(mut handle) = handles.remove(pty_id) {
            // Resume reader thread immediately so it can exit cleanly
            handle.paused.store(false, Ordering::Relaxed);
            handle.child.kill().ok();
        }
        // Also clean up registry entries pointing to this pty
        let mut registry = self.registry.lock().unwrap();
        registry.retain(|_, v| v != pty_id);
        Ok(())
    }

    /// Pause PTY output emission (flow control from frontend).
    pub fn pause(&self, pty_id: &str) -> Result<(), String> {
        let handles = self.handles.lock().unwrap();
        let handle = handles
            .get(pty_id)
            .ok_or_else(|| format!("pty not found: {pty_id}"))?;
        handle.paused.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Resume PTY output emission.
    pub fn resume(&self, pty_id: &str) -> Result<(), String> {
        let handles = self.handles.lock().unwrap();
        let handle = handles
            .get(pty_id)
            .ok_or_else(|| format!("pty not found: {pty_id}"))?;
        handle.paused.store(false, Ordering::Relaxed);
        Ok(())
    }

    /// Register an external key (e.g. agentId) → ptyId mapping.
    pub fn register(&self, key: &str, pty_id: &str) {
        self.registry.lock().unwrap().insert(key.to_string(), pty_id.to_string());
    }

    /// Look up ptyId by external key. Returns None if not registered.
    pub fn lookup(&self, key: &str) -> Option<PtyId> {
        let registry = self.registry.lock().unwrap();
        let pty_id = registry.get(key)?;
        // Verify the PTY still exists
        let handles = self.handles.lock().unwrap();
        if handles.contains_key(pty_id.as_str()) {
            Some(pty_id.clone())
        } else {
            None
        }
    }

    /// Return the child shell PID for a given pty_id, if available.
    pub fn get_child_pid(&self, pty_id: &str) -> Option<u32> {
        let handles = self.handles.lock().unwrap();
        handles.get(pty_id)?.child_pid
    }
}
