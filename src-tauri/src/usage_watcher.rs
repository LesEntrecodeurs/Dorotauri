use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const USAGE_FILE: &str = "/tmp/dorotoring-usage.json";
const POLL_INTERVAL: Duration = Duration::from_secs(3);

fn dorotoring_dir() -> PathBuf {
    dirs::home_dir()
        .expect("could not determine home directory")
        .join(".dorotoring")
}

fn claude_settings_path() -> PathBuf {
    dirs::home_dir()
        .expect("could not determine home directory")
        .join(".claude")
        .join("settings.json")
}

/// The bash statusline script that Claude Code pipes status JSON into.
/// It both renders the terminal status bar AND writes rate_limits to a
/// file so the Dorotoring sidebar can display usage bars.
const STATUSLINE_SCRIPT: &str = include_str!("statusline.sh");
const HOOKS_SCRIPT: &str = include_str!("hooks.sh");

/// Install the statusline script and configure Claude Code to use it.
/// Called once at app startup — idempotent.
pub fn ensure_statusline() {
    let script_path = dorotoring_dir().join("statusline.sh");

    // Write / update the script
    if let Some(parent) = script_path.parent() {
        fs::create_dir_all(parent).ok();
    }
    if fs::write(&script_path, STATUSLINE_SCRIPT).is_err() {
        return;
    }
    // Make executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755)).ok();
    }

    // Configure Claude Code settings.json
    let settings_path = claude_settings_path();
    let mut settings: serde_json::Value = fs::read_to_string(&settings_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    let script_path_str = script_path.to_string_lossy().to_string();

    // Only write if not already configured or pointing to a different script
    let needs_update = settings
        .get("statusLine")
        .and_then(|sl| sl.get("command"))
        .and_then(|c| c.as_str())
        .map_or(true, |c| c != script_path_str);

    if needs_update {
        settings["statusLine"] = serde_json::json!({
            "type": "command",
            "command": script_path_str,
            "padding": 1
        });

        if let Some(parent) = settings_path.parent() {
            fs::create_dir_all(parent).ok();
        }
        if let Ok(json) = serde_json::to_string_pretty(&settings) {
            fs::write(&settings_path, format!("{}\n", json)).ok();
        }
    }
}

/// Install the hooks script and configure Claude Code to call it on PreToolUse and Stop events.
/// Called once at app startup — idempotent, merges with existing hooks.
pub fn ensure_hooks() {
    let hooks_path = dorotoring_dir().join("hooks.sh");

    // Write / update the hooks script
    if let Some(parent) = hooks_path.parent() {
        fs::create_dir_all(parent).ok();
    }
    if fs::write(&hooks_path, HOOKS_SCRIPT).is_err() {
        return;
    }
    // Make executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hooks_path, fs::Permissions::from_mode(0o755)).ok();
    }

    let hooks_path_str = hooks_path.to_string_lossy().to_string();

    // Events and the status argument to pass: PreToolUse → "running", Stop → "completed"
    let events: &[(&str, &str)] = &[("PreToolUse", "running"), ("Stop", "completed")];

    let settings_path = claude_settings_path();
    let mut settings: serde_json::Value = fs::read_to_string(&settings_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if !install_hooks(&mut settings, &hooks_path_str, events) {
        return; // already up to date
    }

    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).ok();
    }
    if let Ok(json) = serde_json::to_string_pretty(&settings) {
        fs::write(&settings_path, format!("{}\n", json)).ok();
    }
}

/// Merge Dorotoring hook entries into the settings JSON.
/// Returns true if any change was made.
fn install_hooks(
    settings: &mut serde_json::Value,
    hooks_path: &str,
    events: &[(&str, &str)],
) -> bool {
    let mut changed = false;

    if settings.get("hooks").is_none() {
        settings["hooks"] = serde_json::json!({});
    }

    for (event, status) in events {
        let command = format!("{hooks_path} {status}");

        // Check if this exact command is already registered for this event
        let already_present = settings["hooks"]
            .get(event)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter().any(|entry| {
                    entry
                        .get("hooks")
                        .and_then(|h| h.as_array())
                        .map(|hooks| {
                            hooks.iter().any(|hook| {
                                hook.get("command")
                                    .and_then(|c| c.as_str())
                                    .map(|c| c == command)
                                    .unwrap_or(false)
                            })
                        })
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);

        if !already_present {
            let entry = serde_json::json!({
                "matcher": "",
                "hooks": [{ "type": "command", "command": command }]
            });

            if let Some(arr) = settings["hooks"][event].as_array_mut() {
                arr.push(entry);
            } else {
                settings["hooks"][*event] = serde_json::json!([entry]);
            }

            changed = true;
        }
    }

    changed
}

#[derive(Clone, Serialize, Debug)]
pub struct RateLimitWindow {
    pub used_percentage: Option<f64>,
    pub resets_at: Option<i64>,
}

#[derive(Clone, Serialize, Debug)]
pub struct RateLimitsPayload {
    pub five_hour: Option<RateLimitWindow>,
    pub seven_day: Option<RateLimitWindow>,
    pub ts: Option<i64>,
}

/// Start a background thread that watches `/tmp/dorotoring-usage.json`
/// and emits `usage:rate-limits` events when it changes.
pub fn start(app_handle: AppHandle) {
    thread::spawn(move || {
        let mut last_modified: Option<SystemTime> = None;

        loop {
            thread::sleep(POLL_INTERVAL);

            let mtime = fs::metadata(USAGE_FILE)
                .and_then(|m| m.modified())
                .ok();

            // Only read & emit when the file has actually changed
            if mtime == last_modified {
                continue;
            }
            last_modified = mtime;

            let payload = match fs::read_to_string(USAGE_FILE) {
                Ok(content) => parse_usage(&content),
                Err(_) => continue,
            };

            if let Some(payload) = payload {
                let _ = app_handle.emit("usage:rate-limits", payload);
            }
        }
    });
}

fn parse_usage(content: &str) -> Option<RateLimitsPayload> {
    let v: serde_json::Value = serde_json::from_str(content).ok()?;
    let rl = v.get("rate_limits")?;

    let parse_window = |key: &str| -> Option<RateLimitWindow> {
        let w = rl.get(key)?;
        Some(RateLimitWindow {
            used_percentage: w.get("used_percentage").and_then(|v| v.as_f64()),
            resets_at: w.get("resets_at").and_then(|v| v.as_i64()),
        })
    };

    Some(RateLimitsPayload {
        five_hour: parse_window("five_hour"),
        seven_day: parse_window("seven_day"),
        ts: v.get("ts").and_then(|v| v.as_i64()),
    })
}
