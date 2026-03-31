use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use crate::pty::PtyManager;

// ── Async helper ────────────────────────────────────────────────────────────

async fn blocking<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("task failed: {e}"))?
}

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
    let bin_name = if is_windows() && !name.ends_with(".exe") {
        format!("{}.exe", name)
    } else {
        name.to_string()
    };

    // 1. Our managed dir
    let managed = bin_dir().join(&bin_name);
    if managed.exists() {
        return Some(managed);
    }

    // 2. System paths
    if is_windows() {
        // Common Docker install paths on Windows
        for dir in &[
            "C:\\Program Files\\Docker\\Docker\\resources\\bin",
            "C:\\Program Files\\Docker\\cli-plugins",
        ] {
            let p = PathBuf::from(dir).join(&bin_name);
            if p.exists() {
                return Some(p);
            }
        }
    } else {
        for dir in &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            let p = PathBuf::from(dir).join(&bin_name);
            if p.exists() {
                return Some(p);
            }
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
        let home = colima_home();
        // Ensure Colima home and cache directories exist
        let _ = std::fs::create_dir_all(&home);
        let cache_dir = dirs::cache_dir()
            .unwrap_or_else(|| home.clone())
            .join("colima");
        let _ = std::fs::create_dir_all(&cache_dir);

        cmd.env("COLIMA_HOME", home);
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
    let docker_name = docker_binary_name();
    if needs_vm() {
        // macOS needs docker + colima + limactl
        bd.join(docker_name).exists() && bd.join("colima").exists() && bd.join("limactl").exists()
    } else {
        // Linux/Windows only need docker CLI
        bd.join(docker_name).exists()
    }
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

async fn download_and_extract_archive(url: &str, dest_dir: &Path) -> Result<(), String> {
    if url.ends_with(".zip") {
        return download_and_extract_zip(url, dest_dir).await;
    }
    download_and_extract_tgz(url, dest_dir).await
}

async fn download_and_extract_zip(url: &str, dest_dir: &Path) -> Result<(), String> {
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| format!("Read failed: {}", e))?;

    std::fs::create_dir_all(dest_dir).map_err(|e| format!("mkdir failed: {}", e))?;

    let tmp_zip = dest_dir.join("__tmp.zip");
    std::fs::write(&tmp_zip, &bytes).map_err(|e| format!("Write zip: {}", e))?;

    // Use system unzip
    let output = Command::new("tar")
        .args(["-xf", &tmp_zip.to_string_lossy(), "-C", &dest_dir.to_string_lossy()])
        .output()
        .or_else(|_| {
            Command::new("powershell")
                .args(["-Command", &format!(
                    "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                    tmp_zip.display(), dest_dir.display()
                )])
                .output()
        })
        .map_err(|e| format!("Extract zip: {}", e))?;

    std::fs::remove_file(&tmp_zip).ok();

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Extract zip failed: {}", stderr.trim()));
    }

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

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), String> {
    let mut perms = std::fs::metadata(path)
        .map_err(|e| format!("metadata: {}", e))?
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms).map_err(|e| format!("chmod: {}", e))?;
    Ok(())
}

#[cfg(windows)]
fn make_executable(_path: &Path) -> Result<(), String> {
    Ok(()) // Not needed on Windows
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn docker_status() -> Result<DockerStatus, String> {
    blocking(|| {
        let docker_installed = find_binary("docker").is_some();
        let bins_installed = binaries_installed();
        let daemon_ready = docker_installed && is_daemon_ready();

        Ok(DockerStatus {
            daemon_ready,
            docker_installed,
            colima_installed: if daemon_ready { true } else { find_binary("colima").is_some() },
            colima_running: if daemon_ready { true } else { is_colima_running() },
            binaries_installed: bins_installed,
        })
    }).await
}

fn is_windows() -> bool {
    cfg!(target_os = "windows")
}

fn needs_vm() -> bool {
    // Only macOS needs a VM (Colima/Lima). Linux and Windows run Docker natively.
    cfg!(target_os = "macos")
}

fn docker_cli_url() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    { "https://download.docker.com/mac/static/stable/aarch64/docker-29.3.1.tgz" }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    { "https://download.docker.com/mac/static/stable/x86_64/docker-29.3.1.tgz" }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    { "https://download.docker.com/linux/static/stable/x86_64/docker-29.3.1.tgz" }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    { "https://download.docker.com/linux/static/stable/aarch64/docker-29.3.1.tgz" }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    { "https://download.docker.com/win/static/stable/x86_64/docker-29.3.1.zip" }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    { "https://download.docker.com/win/static/stable/x86_64/docker-29.3.1.zip" }
}

fn colima_url() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    { "https://github.com/abiosoft/colima/releases/download/v0.10.1/colima-Darwin-arm64" }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    { "https://github.com/abiosoft/colima/releases/download/v0.10.1/colima-Darwin-amd64" }
    #[cfg(not(target_os = "macos"))]
    { "" } // Not needed on Linux/Windows
}

fn lima_url() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    { "https://github.com/lima-vm/lima/releases/download/v2.1.0/lima-2.1.0-Darwin-arm64.tar.gz" }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    { "https://github.com/lima-vm/lima/releases/download/v2.1.0/lima-2.1.0-Darwin-x86_64.tar.gz" }
    #[cfg(not(target_os = "macos"))]
    { "" } // Not needed on Linux/Windows
}

fn docker_binary_name() -> &'static str {
    if is_windows() { "docker.exe" } else { "docker" }
}

#[tauri::command]
pub async fn docker_setup(app: AppHandle) -> Result<(), String> {
    if binaries_installed() {
        return Ok(());
    }

    let bd = bin_dir();
    std::fs::create_dir_all(&bd).map_err(|e| format!("mkdir failed: {}", e))?;

    // 1. Docker CLI (all platforms)
    let docker_name = docker_binary_name();
    if !bd.join(docker_name).exists() {
        let _ = app.emit("docker:setup-progress", SetupProgress {
            step: "Downloading Docker CLI...".into(),
            progress: 10,
        });

        let tmp = runtime_dir().join("tmp-docker");
        std::fs::create_dir_all(&tmp).map_err(|e| format!("mkdir tmp-docker: {}", e))?;
        download_and_extract_archive(docker_cli_url(), &tmp).await?;

        // The archive contains docker/docker (or docker/docker.exe on Windows)
        let src = tmp.join("docker").join(docker_name);
        if src.exists() {
            std::fs::copy(&src, bd.join(docker_name))
                .map_err(|e| format!("copy docker: {}", e))?;
            if !is_windows() {
                make_executable(&bd.join(docker_name))?;
            }
        }
        std::fs::remove_dir_all(&tmp).ok();
    }

    // Linux/Windows: Docker runs natively — no need for Colima/Lima
    if !needs_vm() {
        let _ = app.emit("docker:setup-progress", SetupProgress {
            step: "Setup complete".into(),
            progress: 100,
        });
        return Ok(());
    }

    // 2. Colima (macOS only)
    if !bd.join("colima").exists() {
        let _ = app.emit("docker:setup-progress", SetupProgress {
            step: "Downloading Colima...".into(),
            progress: 40,
        });

        download_file(colima_url(), &bd.join("colima")).await?;
        make_executable(&bd.join("colima"))?;
    }

    // 3. Lima (macOS only — limactl + guest agents)
    if !bd.join("limactl").exists() {
        let _ = app.emit("docker:setup-progress", SetupProgress {
            step: "Downloading Lima VM manager...".into(),
            progress: 65,
        });

        let tmp = runtime_dir().join("tmp-lima");
        std::fs::create_dir_all(&tmp).map_err(|e| format!("mkdir tmp-lima: {}", e))?;
        download_and_extract_archive(lima_url(), &tmp).await?;

        let limactl_src = tmp.join("bin").join("limactl");
        if limactl_src.exists() {
            std::fs::copy(&limactl_src, bd.join("limactl"))
                .map_err(|e| format!("copy limactl: {}", e))?;
            make_executable(&bd.join("limactl"))?;
        }

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
pub async fn docker_list_containers() -> Result<Vec<DockerContainer>, String> {
    blocking(|| {
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
    }).await
}

#[tauri::command]
pub async fn docker_ensure_running(app: AppHandle) -> Result<String, String> {
    // Already running (any runtime)
    if is_daemon_ready() {
        return Ok("ready".to_string());
    }

    let emit_progress = |step: &str, progress: u8| {
        let _ = app.emit("docker:setup-progress", SetupProgress {
            step: step.into(),
            progress,
        });
    };

    // Try Colima
    if let Some(mut cmd) = colima_cmd() {
        if !is_colima_running() {
            emit_progress("Starting Docker VM (first launch may take a few minutes)...", 15);
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

        // Poll until ready (max 300s — first launch creates the VM from scratch)
        emit_progress("Waiting for Docker daemon to be ready...", 40);
        let max_polls = 150; // 150 × 2s = 300s
        for i in 0..max_polls {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if is_daemon_ready() {
                eprintln!("Docker daemon ready via Colima after {}s", (i + 1) * 2);
                emit_progress("Docker is ready!", 100);
                return Ok("started".to_string());
            }
            // Update progress bar (40 → 95 over the polling period)
            let pct = 40 + ((i as u16 * 55) / max_polls as u16) as u8;
            if i % 5 == 0 {
                emit_progress("Waiting for Docker daemon to be ready...", pct);
            }
        }

        return Err(
            "Colima started but Docker daemon not responding after 5 minutes. Check system resources and try again.".to_string(),
        );
    }

    // Fallback: Docker Desktop (macOS or Windows)
    emit_progress("Starting Docker Desktop...", 15);
    let launch = if is_windows() {
        Command::new("cmd")
            .args(["/C", "start", "", "Docker Desktop"])
            .output()
    } else {
        Command::new("/usr/bin/open")
            .args(["-ga", "Docker"])
            .output()
    };

    match launch {
        Ok(output) if output.status.success() => {
            emit_progress("Waiting for Docker Desktop to be ready...", 40);
            let max_polls = 150;
            for i in 0..max_polls {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                if is_daemon_ready() {
                    eprintln!(
                        "Docker daemon ready via Docker Desktop after {}s",
                        (i + 1) * 2
                    );
                    emit_progress("Docker is ready!", 100);
                    return Ok("started".to_string());
                }
                let pct = 40 + ((i as u16 * 55) / max_polls as u16) as u8;
                if i % 5 == 0 {
                    emit_progress("Waiting for Docker Desktop to be ready...", pct);
                }
            }
            Err("Docker Desktop starting but daemon not ready after 5 minutes. Try again.".to_string())
        }
        _ => Err("No Docker runtime found. Setup required.".to_string()),
    }
}

#[tauri::command]
pub async fn docker_start_container(id: String) -> Result<(), String> {
    blocking(move || run_docker_action("start", &id)).await
}

#[tauri::command]
pub async fn docker_stop_container(id: String) -> Result<(), String> {
    blocking(move || run_docker_action("stop", &id)).await
}

#[tauri::command]
pub async fn docker_restart_container(id: String) -> Result<(), String> {
    blocking(move || run_docker_action("restart", &id)).await
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
pub async fn docker_container_stats() -> Result<Vec<ContainerStats>, String> {
    blocking(|| {
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
    }).await
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
        event_bus_tx: std::sync::Arc::new(std::sync::Mutex::new(None)),
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
        event_bus_tx: std::sync::Arc::new(std::sync::Mutex::new(None)),
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
        event_bus_tx: std::sync::Arc::new(std::sync::Mutex::new(None)),
    };

    pty_manager.handles.lock().unwrap().insert(pty_id.to_string(), pty_handle);
    Ok(())
}

// ── Inspect ─────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerMount {
    pub source: String,
    pub destination: String,
    pub mode: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerNetwork {
    pub name: String,
    pub ip_address: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerDetail {
    pub id: String,
    pub env: Vec<String>,
    pub mounts: Vec<ContainerMount>,
    pub networks: Vec<ContainerNetwork>,
    pub restart_policy: String,
    pub cmd: Vec<String>,
    pub entrypoint: Vec<String>,
    pub working_dir: String,
    pub hostname: String,
}

#[tauri::command]
pub async fn docker_inspect_container(id: String) -> Result<ContainerDetail, String> {
    blocking(move || {
        let output = docker_cmd()
            .args(["inspect", &id, "--format", "{{json .}}"])
            .output()
            .map_err(|e| format!("inspect failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("docker inspect failed: {}", stderr.trim()));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let v: serde_json::Value = serde_json::from_str(stdout.trim())
            .map_err(|e| format!("parse inspect JSON: {}", e))?;

        let env = v["Config"]["Env"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();

        let mounts = v["Mounts"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|m| ContainerMount {
                        source: m["Source"].as_str().unwrap_or("").to_string(),
                        destination: m["Destination"].as_str().unwrap_or("").to_string(),
                        mode: m["Mode"].as_str().unwrap_or("").to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        let networks = v["NetworkSettings"]["Networks"]
            .as_object()
            .map(|obj| {
                obj.iter()
                    .map(|(name, net)| ContainerNetwork {
                        name: name.clone(),
                        ip_address: net["IPAddress"].as_str().unwrap_or("").to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        let cmd = v["Config"]["Cmd"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();

        let entrypoint = v["Config"]["Entrypoint"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();

        Ok(ContainerDetail {
            id: v["Id"].as_str().unwrap_or("").to_string(),
            env,
            mounts,
            networks,
            restart_policy: v["HostConfig"]["RestartPolicy"]["Name"]
                .as_str()
                .unwrap_or("")
                .to_string(),
            cmd,
            entrypoint,
            working_dir: v["Config"]["WorkingDir"].as_str().unwrap_or("").to_string(),
            hostname: v["Config"]["Hostname"].as_str().unwrap_or("").to_string(),
        })
    }).await
}

// ── Images ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerImage {
    pub id: String,
    pub repository: String,
    pub tag: String,
    pub size: String,
    pub created: String,
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct RawDockerImage {
    ID: String,
    Repository: String,
    Tag: String,
    Size: String,
    CreatedSince: String,
}

#[tauri::command]
pub async fn docker_list_images() -> Result<Vec<DockerImage>, String> {
    blocking(|| {
        let output = docker_cmd()
            .args(["images", "--format", "{{json .}}"])
            .output()
            .map_err(|e| format!("Failed to run docker images: {}", e))?;

        if !output.status.success() {
            return Err("docker images failed".to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut images = Vec::new();

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            if let Ok(raw) = serde_json::from_str::<RawDockerImage>(trimmed) {
                images.push(DockerImage {
                    id: raw.ID,
                    repository: raw.Repository,
                    tag: raw.Tag,
                    size: raw.Size,
                    created: raw.CreatedSince,
                });
            }
        }

        Ok(images)
    }).await
}

#[tauri::command]
pub async fn docker_remove_image(id: String) -> Result<(), String> {
    blocking(move || {
        let output = docker_cmd()
            .args(["rmi", &id])
            .output()
            .map_err(|e| format!("docker rmi failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("docker rmi failed: {}", stderr.trim()));
        }
        Ok(())
    }).await
}

#[tauri::command]
pub fn docker_pull_image(
    name: String,
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
    cmd.args(["pull", &name]);

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
                        agent_id: format!("docker-pull-{}", pty_id_clone),
                        pty_id: pty_id_clone.clone(),
                        data: buf[..n].to_vec(),
                    };
                    if handle.emit("agent:output", event).is_err() { break; }
                }
                Err(_) => break,
            }
        }
    });

    let pty_handle = crate::pty::PtyHandle {
        master: pair.master, writer, child,
        agent_id: format!("docker-pull-{}", pty_id),
        child_pid: None, paused,
        event_bus_tx: std::sync::Arc::new(std::sync::Mutex::new(None)),
    };
    pty_manager.handles.lock().unwrap().insert(pty_id, pty_handle);
    Ok(())
}

// ── Volumes ─────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerVolume {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct RawDockerVolume {
    Name: String,
    Driver: String,
    Mountpoint: String,
}

#[tauri::command]
pub async fn docker_list_volumes() -> Result<Vec<DockerVolume>, String> {
    blocking(|| {
        let output = docker_cmd()
            .args(["volume", "ls", "--format", "{{json .}}"])
            .output()
            .map_err(|e| format!("docker volume ls failed: {}", e))?;

        if !output.status.success() {
            return Err("docker volume ls failed".to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut volumes = Vec::new();

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            if let Ok(raw) = serde_json::from_str::<RawDockerVolume>(trimmed) {
                volumes.push(DockerVolume {
                    name: raw.Name,
                    driver: raw.Driver,
                    mountpoint: raw.Mountpoint,
                });
            }
        }

        Ok(volumes)
    }).await
}

#[tauri::command]
pub async fn docker_remove_volume(name: String) -> Result<(), String> {
    blocking(move || {
        let output = docker_cmd()
            .args(["volume", "rm", &name])
            .output()
            .map_err(|e| format!("docker volume rm failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("docker volume rm failed: {}", stderr.trim()));
        }
        Ok(())
    }).await
}

#[tauri::command]
pub async fn docker_prune_volumes() -> Result<String, String> {
    blocking(|| {
        let output = docker_cmd()
            .args(["volume", "prune", "-f"])
            .output()
            .map_err(|e| format!("docker volume prune failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("prune failed: {}", stderr.trim()));
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }).await
}

// ── Networks ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerNetwork {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct RawDockerNetwork {
    ID: String,
    Name: String,
    Driver: String,
    Scope: String,
}

#[tauri::command]
pub async fn docker_list_networks() -> Result<Vec<DockerNetwork>, String> {
    blocking(|| {
        let output = docker_cmd()
            .args(["network", "ls", "--format", "{{json .}}"])
            .output()
            .map_err(|e| format!("docker network ls failed: {}", e))?;

        if !output.status.success() {
            return Err("docker network ls failed".to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut networks = Vec::new();

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            if let Ok(raw) = serde_json::from_str::<RawDockerNetwork>(trimmed) {
                networks.push(DockerNetwork {
                    id: raw.ID,
                    name: raw.Name,
                    driver: raw.Driver,
                    scope: raw.Scope,
                });
            }
        }

        Ok(networks)
    }).await
}

// ── Disk Usage ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerDiskUsage {
    pub images_count: usize,
    pub images_size: String,
    pub containers_count: usize,
    pub containers_size: String,
    pub volumes_count: usize,
    pub volumes_size: String,
    pub build_cache_size: String,
    pub total_size: String,
}

#[tauri::command]
pub async fn docker_disk_usage() -> Result<DockerDiskUsage, String> {
    blocking(|| {
        let output = docker_cmd()
            .args(["system", "df", "--format", "{{json .}}"])
            .output()
            .map_err(|e| format!("docker system df failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("docker system df failed: {}", stderr.trim()));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        let mut images_count = 0;
        let mut images_size = String::new();
        let mut containers_count = 0;
        let mut containers_size = String::new();
        let mut volumes_count = 0;
        let mut volumes_size = String::new();
        let mut build_cache_size = String::new();

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                let typ = v["Type"].as_str().unwrap_or("");
                let count = v["TotalCount"].as_str()
                    .or_else(|| v["TotalCount"].as_i64().map(|_| ""))
                    .unwrap_or("0");
                let count_num = count.parse::<usize>().unwrap_or(
                    v["TotalCount"].as_i64().unwrap_or(0) as usize
                );
                let size = v["Size"].as_str().unwrap_or("0B").to_string();

                match typ {
                    "Images" => { images_count = count_num; images_size = size; }
                    "Containers" => { containers_count = count_num; containers_size = size; }
                    "Local Volumes" => { volumes_count = count_num; volumes_size = size; }
                    "Build Cache" => { build_cache_size = size; }
                    _ => {}
                }
            }
        }

        let total_size = format!("{}, {}, {}, {}",
            if images_size.is_empty() { "0B".to_string() } else { images_size.clone() },
            if containers_size.is_empty() { "0B".to_string() } else { containers_size.clone() },
            if volumes_size.is_empty() { "0B".to_string() } else { volumes_size.clone() },
            if build_cache_size.is_empty() { "0B".to_string() } else { build_cache_size.clone() },
        );

        Ok(DockerDiskUsage {
            images_count,
            images_size,
            containers_count,
            containers_size,
            volumes_count,
            volumes_size,
            build_cache_size,
            total_size,
        })
    }).await
}

#[tauri::command]
pub async fn docker_system_prune() -> Result<String, String> {
    blocking(|| {
        let output = docker_cmd()
            .args(["system", "prune", "-af", "--volumes"])
            .output()
            .map_err(|e| format!("docker system prune failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("prune failed: {}", stderr.trim()));
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }).await
}

// ── Network Map ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkMapNode {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub project: Option<String>,
    pub ports: String,
    pub networks: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkMapEdge {
    pub network: String,
    pub containers: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkMap {
    pub nodes: Vec<NetworkMapNode>,
    pub edges: Vec<NetworkMapEdge>,
}

#[tauri::command]
pub async fn docker_network_map() -> Result<NetworkMap, String> {
    blocking(|| {
    let containers_output = docker_cmd()
        .args(["ps", "-a", "--format", "{{json .}}"])
        .output()
        .map_err(|e| format!("docker ps failed: {}", e))?;

    if !containers_output.status.success() {
        return Err("docker ps failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&containers_output.stdout);
    let mut nodes = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        if let Ok(raw) = serde_json::from_str::<RawDockerContainer>(trimmed) {
            let project = parse_label(&raw.Labels, "com.docker.compose.project");
            let service = parse_label(&raw.Labels, "com.docker.compose.service");
            nodes.push(NetworkMapNode {
                id: raw.ID.clone(),
                name: service.unwrap_or(raw.Names.clone()),
                image: raw.Image,
                state: raw.State,
                project,
                ports: raw.Ports,
                networks: Vec::new(),
            });
        }
    }

    let networks_output = docker_cmd()
        .args(["network", "ls", "--format", "{{.Name}}"])
        .output()
        .map_err(|e| format!("docker network ls failed: {}", e))?;

    let net_stdout = String::from_utf8_lossy(&networks_output.stdout);
    let mut edges = Vec::new();

    for net_name in net_stdout.lines() {
        let net_name = net_name.trim();
        if net_name.is_empty() || net_name == "bridge" || net_name == "host" || net_name == "none" {
            continue;
        }

        let inspect = docker_cmd()
            .args(["network", "inspect", net_name, "--format", "{{json .Containers}}"])
            .output();

        if let Ok(output) = inspect {
            if output.status.success() {
                let json_str = String::from_utf8_lossy(&output.stdout);
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str.trim()) {
                    if let Some(obj) = v.as_object() {
                        let container_ids: Vec<String> = obj.keys()
                            .map(|k| if k.len() >= 12 { k[..12].to_string() } else { k.clone() })
                            .collect();

                        if container_ids.len() > 1 {
                            for node in &mut nodes {
                                if container_ids.iter().any(|cid| node.id.starts_with(cid)) {
                                    node.networks.push(net_name.to_string());
                                }
                            }
                            edges.push(NetworkMapEdge {
                                network: net_name.to_string(),
                                containers: container_ids,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(NetworkMap { nodes, edges })
    }).await
}
