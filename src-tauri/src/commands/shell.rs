use std::fs;
use std::path::PathBuf;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub last_modified: String,
}

#[tauri::command]
pub fn projects_list() -> Vec<ProjectInfo> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Vec::new(),
    };

    let candidates: Vec<PathBuf> = vec![
        home.join("projects"),
        home.join("code"),
        home.join("dev"),
        home.join("src"),
        home.join("Documents"),
        home.join("repos"),
        home.join("workspace"),
    ];

    let mut results: Vec<ProjectInfo> = Vec::new();

    for dir in candidates {
        if !dir.is_dir() {
            continue;
        }

        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let entry_path = entry.path();
            if !entry_path.is_dir() {
                continue;
            }

            // Check for .git directory (indicates a project)
            if !entry_path.join(".git").exists() {
                continue;
            }

            let name = entry
                .file_name()
                .into_string()
                .unwrap_or_default();

            let last_modified = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    let dt: chrono::DateTime<chrono::Utc> = t.into();
                    dt.to_rfc3339()
                })
                .unwrap_or_default();

            results.push(ProjectInfo {
                path: entry_path.to_string_lossy().to_string(),
                name,
                last_modified,
            });
        }
    }

    // Sort by last_modified descending
    results.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));

    results
}
