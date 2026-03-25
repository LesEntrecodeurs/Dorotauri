use serde::{Deserialize, Serialize};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use crate::pty::PtyManager;

// ── Types ───────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainer {
    pub id: String,
    pub names: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: String,
    pub created_at: String,
    pub project: Option<String>,
    pub service: Option<String>,
    pub config_file: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerStats {
    pub id: String,
    pub cpu_perc: String,
    pub mem_usage: String,
    pub mem_perc: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerStatus {
    pub daemon_ready: bool,
    pub docker_installed: bool,
    pub colima_installed: bool,
    pub colima_running: bool,
    pub binaries_installed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupProgress {
    pub step: String,
    pub progress: u8,
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct RawDockerContainer {
    ID: String,
    Names: String,
    Image: String,
    Status: String,
    State: String,
    Ports: String,
    CreatedAt: String,
    #[serde(default)]
    Labels: String,
}

fn parse_label(labels: &str, key: &str) -> Option<String> {
    labels.split(',').find_map(|pair| {
        let mut parts = pair.splitn(2, '=');
        let k = parts.next()?;
        let v = parts.next()?;
        if k.trim() == key {
            Some(v.trim().to_string())
        } else {
            None
        }
    })
}

impl From<RawDockerContainer> for DockerContainer {
    fn from(raw: RawDockerContainer) -> Self {
        let project = parse_label(&raw.Labels, "com.docker.compose.project");
        let service = parse_label(&raw.Labels, "com.docker.compose.service");
        let config_file = parse_label(&raw.Labels, "com.docker.compose.project.config_files");
        Self {
            id: raw.ID,
            names: raw.Names,
            image: raw.Image,
            status: raw.Status,
            state: raw.State,
            ports: raw.Ports,
            created_at: raw.CreatedAt,
            project,
            service,
            config_file,
        }
    }
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct RawContainerStats {
    ID: String,
    CPUPerc: String,
    MemUsage: String,
    MemPerc: String,
}

// ── Paths ───────────────────────────────────────────────────────────────────

fn runtime_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".dorotauri")
        .join("docker-runtime")
}

fn bin_dir() -> PathBuf {
    runtime_dir().join("bin")
}

fn colima_home() -> PathBuf {
    runtime_dir().join("colima")
}

fn lima_home() -> PathBuf {
    runtime_dir().join("lima")
}

fn find_binary(name: &str) -> Option<PathBuf> {
    // 1. Our managed dir
    let managed = bin_dir().join(name);
    if managed.exists() {
        return Some(managed);
    }
    // 2. System paths
    for dir in &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        let p = PathBuf::from(dir).join(name);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn docker_cmd() -> Command {
    Command::new(
        find_binary("docker")
            .unwrap_or_else(|| PathBuf::from("docker"))
            .to_string_lossy()
            .to_string(),
    )
}

fn colima_cmd() -> Option<Command> {
    find_binary("colima").map(|p| {
        let mut cmd = Command::new(p);
        cmd.env("COLIMA_HOME", colima_home());
        cmd.env("LIMA_HOME", lima_home());
        // Ensure limactl is findable
        if let Some(bin) = find_binary("limactl") {
            if let Some(dir) = bin.parent() {
                let path = std::env::var("PATH").unwrap_or_default();
                cmd.env("PATH", format!("{}:{}", dir.display(), path));
            }
        }
        cmd
    })
}

fn binaries_installed() -> bool {
    let bd = bin_dir();
    bd.join("docker").exists() && bd.join("colima").exists() && bd.join("limactl").exists()
}

// ── Status checks ───────────────────────────────────────────────────────────

fn is_daemon_ready() -> bool {
    docker_cmd()
        .args(["ps", "--format", "{{.ID}}"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn is_colima_running() -> bool {
    colima_cmd()
        .map(|mut cmd| {
            cmd.args(["status"])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

// ── Download helpers ────────────────────────────────────────────────────────

async fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {}", e))?;
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Read failed: {}", e))?;
    std::fs::write(dest, &bytes).map_err(|e| format!("Write failed: {}", e))?;
    Ok(())
}

async fn download_and_extract_tgz(url: &str, dest_dir: &Path) -> Result<(), String> {
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Read failed: {}", e))?;

    std::fs::create_dir_all(dest_dir).map_err(|e| format!("mkdir failed: {}", e))?;

    let decoder = flate2::read::GzDecoder::new(std::io::Cursor::new(&bytes));
    let mut archive = tar::Archive::new(decoder);
    archive
        .unpack(dest_dir)
        .map_err(|e| format!("Extract failed: {}", e))?;

    Ok(())
}

fn make_executable(path: &Path) -> Result<(), String> {
    let mut perms = std::fs::metadata(path)
        .map_err(|e| format!("metadata: {}", e))?
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms).map_err(|e| format!("chmod: {}", e))?;
    Ok(())
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn docker_status() -> DockerStatus {
    let docker_installed = find_binary("docker").is_some();
    let bins_installed = binaries_installed();

    // Fast path: check daemon first. If ready, skip slow colima check.
    let daemon_ready = docker_installed && is_daemon_ready();

    DockerStatus {
        daemon_ready,
        docker_installed,
        colima_installed: if daemon_ready { true } else { find_binary("colima").is_some() },
        colima_running: if daemon_ready { true } else { is_colima_running() },
        binaries_installed: bins_installed,
    }
}

#[tauri::command]
pub async fn docker_setup(app: AppHandle) -> Result<(), String> {
    if binaries_installed() {
        return Ok(());
    }

    let bd = bin_dir();
    std::fs::create_dir_all(&bd).map_err(|e| format!("mkdir failed: {}", e))?;

    // 1. Docker CLI
    if !bd.join("docker").exists() {
        let _ = app.emit("docker:setup-progress", SetupProgress {
            step: "Downloading Docker CLI...".into(),
            progress: 10,
        });

        let tmp = runtime_dir().join("tmp-docker");
        std::fs::create_dir_all(&tmp).ok();
        download_and_extract_tgz(
            "https://download.docker.com/mac/static/stable/aarch64/docker-29.3.1.tgz",
            &tmp,
        )
        .await?;

        // The tgz contains docker/docker
        let src = tmp.join("docker").join("docker");
        if src.exists() {
            std::fs::copy(&src, bd.join("docker"))
                .map_err(|e| format!("copy docker: {}", e))?;
            make_executable(&bd.join("docker"))?;
        }
        std::fs::remove_dir_all(&tmp).ok();
    }

    // 2. Colima
    if !bd.join("colima").exists() {
        let _ = app.emit("docker:setup-progress", SetupProgress {
            step: "Downloading Colima...".into(),
            progress: 40,
        });

        download_file(
            "https://github.com/abiosoft/colima/releases/download/v0.10.1/colima-Darwin-arm64",
            &bd.join("colima"),
        )
        .await?;
        make_executable(&bd.join("colima"))?;
    }

    // 3. Lima (limactl + guest agents)
    if !bd.join("limactl").exists() {
        let _ = app.emit("docker:setup-progress", SetupProgress {
            step: "Downloading Lima VM manager...".into(),
            progress: 65,
        });

        let tmp = runtime_dir().join("tmp-lima");
        std::fs::create_dir_all(&tmp).ok();
        download_and_extract_tgz(
            "https://github.com/lima-vm/lima/releases/download/v2.1.0/lima-2.1.0-Darwin-arm64.tar.gz",
            &tmp,
        )
        .await?;

        // Copy limactl binary
        let limactl_src = tmp.join("bin").join("limactl");
        if limactl_src.exists() {
            std::fs::copy(&limactl_src, bd.join("limactl"))
                .map_err(|e| format!("copy limactl: {}", e))?;
            make_executable(&bd.join("limactl"))?;
        }

        // Copy share/lima (guest agents)
        let share_src = tmp.join("share").join("lima");
        let share_dest = runtime_dir().join("share").join("lima");
        if share_src.exists() {
            std::fs::create_dir_all(&share_dest).ok();
            copy_dir_recursive(&share_src, &share_dest)?;
        }

        std::fs::remove_dir_all(&tmp).ok();
    }

    let _ = app.emit("docker:setup-progress", SetupProgress {
        step: "Setup complete".into(),
        progress: 100,
    });

    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("mkdir: {}", e))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("readdir: {}", e))? {
        let entry = entry.map_err(|e| format!("entry: {}", e))?;
        let ty = entry.file_type().map_err(|e| format!("filetype: {}", e))?;
        let dest_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            std::fs::copy(entry.path(), &dest_path)
                .map_err(|e| format!("copy: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn docker_list_containers() -> Result<Vec<DockerContainer>, String> {
    let output = docker_cmd()
        .args(["ps", "-a", "--format", "{{json .}}"])
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Docker CLI is not installed.".to_string()
            } else {
                format!("Failed to run docker: {}", e)
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("docker ps failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut containers = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<RawDockerContainer>(trimmed) {
            Ok(raw) => containers.push(DockerContainer::from(raw)),
            Err(e) => eprintln!("Failed to parse docker container JSON: {}", e),
        }
    }

    Ok(containers)
}

#[tauri::command]
pub async fn docker_ensure_running() -> Result<String, String> {
    // Already running (any runtime)
    if is_daemon_ready() {
        return Ok("ready".to_string());
    }

    // Try Colima
    if let Some(mut cmd) = colima_cmd() {
        if !is_colima_running() {
            eprintln!("Starting Colima...");
            let output = cmd
                .args(["start"])
                .output()
                .map_err(|e| format!("Failed to start Colima: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Colima start failed: {}", stderr.trim()));
            }
        }

        // Poll until ready (max 120s)
        for i in 0..60 {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if is_daemon_ready() {
                eprintln!("Docker daemon ready via Colima after {}s", (i + 1) * 2);
                return Ok("started".to_string());
            }
        }

        return Err(
            "Colima started but Docker daemon not responding. Try again.".to_string(),
        );
    }

    // Fallback: Docker Desktop
    let launch = Command::new("/usr/bin/open")
        .args(["-ga", "Docker"])
        .output();

    match launch {
        Ok(output) if output.status.success() => {
            for i in 0..60 {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                if is_daemon_ready() {
                    eprintln!(
                        "Docker daemon ready via Docker Desktop after {}s",
                        (i + 1) * 2
                    );
                    return Ok("started".to_string());
                }
            }
            Err("Docker Desktop starting but daemon not ready. Try again.".to_string())
        }
        _ => Err("No Docker runtime found. Setup required.".to_string()),
    }
}

#[tauri::command]
pub fn docker_start_container(id: String) -> Result<(), String> {
    run_docker_action("start", &id)
}

#[tauri::command]
pub fn docker_stop_container(id: String) -> Result<(), String> {
    run_docker_action("stop", &id)
}

#[tauri::command]
pub fn docker_restart_container(id: String) -> Result<(), String> {
    run_docker_action("restart", &id)
}

fn run_docker_action(action: &str, id: &str) -> Result<(), String> {
    let output = docker_cmd()
        .args([action, id])
        .output()
        .map_err(|e| format!("Failed to run docker {}: {}", action, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("docker {} failed: {}", action, stderr.trim()));
    }

    Ok(())
}

// ── Stats ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn docker_container_stats() -> Result<Vec<ContainerStats>, String> {
    let output = docker_cmd()
        .args(["stats", "--no-stream", "--format", "{{json .}}"])
        .output()
        .map_err(|e| format!("Failed to run docker stats: {}", e))?;

    if !output.status.success() {
        return Err("docker stats failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut stats = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(raw) = serde_json::from_str::<RawContainerStats>(trimmed) {
            stats.push(ContainerStats {
                id: raw.ID,
                cpu_perc: raw.CPUPerc,
                mem_usage: raw.MemUsage,
                mem_perc: raw.MemPerc,
            });
        }
    }

    Ok(stats)
}

// ── Logs ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn docker_container_logs(
    id: String,
    pty_id: String,
    pty_manager: State<'_, Arc<PtyManager>>,
    app: AppHandle,
) -> Result<(), String> {
    let docker_bin = find_binary("docker")
        .unwrap_or_else(|| PathBuf::from("docker"))
        .to_string_lossy()
        .to_string();

    // Spawn a PTY running: docker logs -f --tail 200 <id>
    let pty_system = portable_pty::native_pty_system();
    let size = portable_pty::PtySize { rows: 24, cols: 120, pixel_width: 0, pixel_height: 0 };
    let pair = pty_system.openpty(size).map_err(|e| format!("pty open: {e}"))?;

    let mut cmd = portable_pty::CommandBuilder::new(&docker_bin);
    cmd.args(["logs", "-f", "--tail", "200", &id]);

    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn: {e}"))?;
    let writer = pair.master.take_writer().map_err(|e| format!("writer: {e}"))?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| format!("reader: {e}"))?;

    let handle = app.clone();
    let pty_id_clone = pty_id.clone();
    let paused = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let event = crate::pty::PtyOutputEvent {
                        agent_id: format!("docker-logs-{}", pty_id_clone),
                        pty_id: pty_id_clone.clone(),
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

    let pty_handle = crate::pty::PtyHandle {
        master: pair.master,
        writer,
        child,
        agent_id: format!("docker-logs-{}", pty_id),
        child_pid: None,
        paused,
    };

    pty_manager.handles.lock().unwrap().insert(pty_id, pty_handle);
    Ok(())
}

// ── Shell exec ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn docker_exec_shell(
    id: String,
    pty_id: String,
    pty_manager: State<'_, Arc<PtyManager>>,
    app: AppHandle,
) -> Result<(), String> {
    let docker_bin = find_binary("docker")
        .unwrap_or_else(|| PathBuf::from("docker"))
        .to_string_lossy()
        .to_string();

    let pty_system = portable_pty::native_pty_system();
    let size = portable_pty::PtySize { rows: 24, cols: 120, pixel_width: 0, pixel_height: 0 };
    let pair = pty_system.openpty(size).map_err(|e| format!("pty open: {e}"))?;

    let mut cmd = portable_pty::CommandBuilder::new(&docker_bin);
    cmd.args(["exec", "-it", &id, "/bin/sh"]);

    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn: {e}"))?;
    let writer = pair.master.take_writer().map_err(|e| format!("writer: {e}"))?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| format!("reader: {e}"))?;

    let handle = app.clone();
    let pty_id_clone = pty_id.clone();
    let paused = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let event = crate::pty::PtyOutputEvent {
                        agent_id: format!("docker-exec-{}", pty_id_clone),
                        pty_id: pty_id_clone.clone(),
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

    let pty_handle = crate::pty::PtyHandle {
        master: pair.master,
        writer,
        child,
        agent_id: format!("docker-exec-{}", pty_id),
        child_pid: None,
        paused,
    };

    pty_manager.handles.lock().unwrap().insert(pty_id, pty_handle);
    Ok(())
}

// ── Docker Compose ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn docker_compose_up(
    config_file: String,
    pty_id: String,
    pty_manager: State<'_, Arc<PtyManager>>,
    app: AppHandle,
) -> Result<(), String> {
    docker_compose_action("up", &config_file, &pty_id, &pty_manager, &app)
}

#[tauri::command]
pub fn docker_compose_down(
    config_file: String,
    pty_id: String,
    pty_manager: State<'_, Arc<PtyManager>>,
    app: AppHandle,
) -> Result<(), String> {
    docker_compose_action("down", &config_file, &pty_id, &pty_manager, &app)
}

fn docker_compose_action(
    action: &str,
    config_file: &str,
    pty_id: &str,
    pty_manager: &PtyManager,
    app: &AppHandle,
) -> Result<(), String> {
    let docker_bin = find_binary("docker")
        .unwrap_or_else(|| PathBuf::from("docker"))
        .to_string_lossy()
        .to_string();

    let pty_system = portable_pty::native_pty_system();
    let size = portable_pty::PtySize { rows: 24, cols: 120, pixel_width: 0, pixel_height: 0 };
    let pair = pty_system.openpty(size).map_err(|e| format!("pty open: {e}"))?;

    let mut cmd = portable_pty::CommandBuilder::new(&docker_bin);
    match action {
        "up" => cmd.args(["compose", "-f", config_file, "up", "-d"]),
        "down" => cmd.args(["compose", "-f", config_file, "down"]),
        _ => return Err(format!("unknown compose action: {}", action)),
    };

    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn: {e}"))?;
    let writer = pair.master.take_writer().map_err(|e| format!("writer: {e}"))?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| format!("reader: {e}"))?;

    let handle = app.clone();
    let pty_id_owned = pty_id.to_string();
    let paused = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let event = crate::pty::PtyOutputEvent {
                        agent_id: format!("docker-compose-{}", pty_id_owned),
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

    let pty_handle = crate::pty::PtyHandle {
        master: pair.master,
        writer,
        child,
        agent_id: format!("docker-compose-{}", pty_id),
        child_pid: None,
        paused,
    };

    pty_manager.handles.lock().unwrap().insert(pty_id.to_string(), pty_handle);
    Ok(())
}
