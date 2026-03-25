use serde::{Deserialize, Serialize};
use std::process::Command;

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
}

/// Raw JSON output from `docker ps --format json`
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

fn parse_label<'a>(labels: &'a str, key: &str) -> Option<String> {
    labels.split(',')
        .find_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let k = parts.next()?;
            let v = parts.next()?;
            if k.trim() == key { Some(v.trim().to_string()) } else { None }
        })
}

impl From<RawDockerContainer> for DockerContainer {
    fn from(raw: RawDockerContainer) -> Self {
        let project = parse_label(&raw.Labels, "com.docker.compose.project");
        let service = parse_label(&raw.Labels, "com.docker.compose.service");
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
        }
    }
}

fn docker_cmd() -> Command {
    // Try `docker` first; fall back to common macOS install path
    let mut cmd = Command::new("docker");
    if which_docker().is_none() {
        cmd = Command::new("/usr/local/bin/docker");
    }
    cmd
}

fn which_docker() -> Option<std::path::PathBuf> {
    Command::new("which")
        .arg("docker")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| std::path::PathBuf::from(String::from_utf8_lossy(&o.stdout).trim().to_string()))
}

#[tauri::command]
pub fn docker_list_containers() -> Result<Vec<DockerContainer>, String> {
    let output = docker_cmd()
        .args(["ps", "-a", "--format", "{{json .}}"])
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Docker is not installed or not found in PATH.".to_string()
            } else {
                format!("Failed to run docker: {}", e)
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("Cannot connect to the Docker daemon") || stderr.contains("Is the docker daemon running") {
            return Err("Docker daemon is not running. Please start Docker Desktop.".to_string());
        }
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
