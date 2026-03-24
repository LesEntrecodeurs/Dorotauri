use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};

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
}

// ---------------------------------------------------------------------------
// PtyManager — Tauri-managed state that owns all active PTYs
// ---------------------------------------------------------------------------

pub struct PtyManager {
    pub handles: Mutex<HashMap<PtyId, PtyHandle>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            handles: Mutex::new(HashMap::new()),
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

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("failed to spawn shell: {e}"))?;

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

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let event = PtyOutputEvent {
                            agent_id: agent_id_owned.clone(),
                            pty_id: pty_id_owned.clone(),
                            data: buf[..n].to_vec(),
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
            handle.child.kill().ok();
        }
        Ok(())
    }
}
