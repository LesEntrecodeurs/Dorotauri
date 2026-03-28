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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocEntry {
    pub name: String,
    pub path: String,
    pub relative: String,
    pub is_dir: bool,
}

#[tauri::command]
pub fn project_list_docs(project_path: String) -> Vec<DocEntry> {
    let root = std::path::Path::new(&project_path);
    if !root.is_dir() {
        return Vec::new();
    }

    let mut entries: Vec<DocEntry> = Vec::new();

    // Collect .md files at project root
    if let Ok(dir) = fs::read_dir(root) {
        for entry in dir.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext.eq_ignore_ascii_case("md") {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let relative = name.clone();
                        entries.push(DocEntry {
                            name,
                            path: path.to_string_lossy().to_string(),
                            relative,
                            is_dir: false,
                        });
                    }
                }
            }
        }
    }

    // Recursively collect from docs/ directory
    let docs_dir = root.join("docs");
    if docs_dir.is_dir() {
        collect_md_files(&docs_dir, root, &mut entries);
    }

    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.relative.to_lowercase().cmp(&b.relative.to_lowercase()),
        }
    });

    entries
}

fn collect_md_files(dir: &std::path::Path, root: &std::path::Path, entries: &mut Vec<DocEntry>) {
    let skip_dirs = ["node_modules", ".git", "target", "dist", "build", "__pycache__"];

    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if skip_dirs.contains(&name.as_str()) {
                continue;
            }
            collect_md_files(&path, root, entries);
        } else if path.is_file() {
            if let Some(ext) = path.extension() {
                if ext.eq_ignore_ascii_case("md") {
                    let relative = path
                        .strip_prefix(root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .to_string();
                    entries.push(DocEntry {
                        name,
                        path: path.to_string_lossy().to_string(),
                        relative,
                        is_dir: false,
                    });
                }
            }
        }
    }
}

#[tauri::command]
pub fn project_read_doc(file_path: String, project_root: String) -> Result<String, String> {
    let file = std::path::Path::new(&file_path);
    let root = std::path::Path::new(&project_root);

    // Security: ensure file_path is under project_root (no path traversal)
    let canonical_file = file
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path: {e}"))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve project root: {e}"))?;

    if !canonical_file.starts_with(&canonical_root) {
        return Err("Access denied: path is outside project directory".to_string());
    }

    fs::read_to_string(&canonical_file)
        .map_err(|e| format!("Failed to read file: {e}"))
}
