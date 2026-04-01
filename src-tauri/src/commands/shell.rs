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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocSearchResult {
    pub file_path: String,
    pub relative: String,
    pub file_name: String,
    pub line_number: usize,
    pub line_content: String,
}

#[tauri::command]
pub fn project_search_docs(project_path: String, query: String) -> Vec<DocSearchResult> {
    if query.trim().is_empty() {
        return Vec::new();
    }

    let files = project_list_docs(project_path);
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for file in files {
        if file.is_dir {
            continue;
        }
        if let Ok(content) = fs::read_to_string(&file.path) {
            for (i, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(&query_lower) {
                    results.push(DocSearchResult {
                        file_path: file.path.clone(),
                        relative: file.relative.clone(),
                        file_name: file.name.clone(),
                        line_number: i + 1,
                        line_content: line.trim().to_string(),
                    });
                }
            }
        }
    }

    results
}

// ── Git Modifications ──────────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub status: String,
    pub old_path: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunkLine {
    pub line_type: String,
    pub content: String,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub new_start: u32,
    pub lines: Vec<DiffHunkLine>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub status: String,
    pub is_binary: bool,
    pub hunks: Vec<DiffHunk>,
    pub additions: u32,
    pub deletions: u32,
}

#[tauri::command]
pub fn project_git_changed_files(
    project_path: String,
    mode: String,
) -> Result<Vec<GitChangedFile>, String> {
    let args: Vec<&str> = match mode.as_str() {
        "last_commit" => vec!["diff", "--name-status", "HEAD~1", "HEAD"],
        _ => vec!["diff", "--name-status", "HEAD"],
    };

    let output = std::process::Command::new("git")
        .args(&args)
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("unknown revision") || stderr.contains("bad revision") {
            return Ok(Vec::new());
        }
        return Err(format!("git diff failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut files = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 2 {
            continue;
        }
        let status_code = parts[0];
        let (status, path, old_path) = if status_code.starts_with('R') {
            let old = parts.get(1).unwrap_or(&"").to_string();
            let new = parts.get(2).unwrap_or(&"").to_string();
            ("renamed".to_string(), new, Some(old))
        } else {
            let s = match status_code {
                "A" => "added",
                "M" => "modified",
                "D" => "deleted",
                _ => "modified",
            };
            (s.to_string(), parts[1].to_string(), None)
        };
        files.push(GitChangedFile { path, status, old_path });
    }

    Ok(files)
}

#[tauri::command]
pub fn project_git_diff_file(
    project_path: String,
    file_path: String,
    mode: String,
) -> Result<FileDiff, String> {
    // Security: reject path traversal
    if file_path.contains("..") || file_path.starts_with('/') {
        return Err("Invalid file path".to_string());
    }

    let args: Vec<String> = match mode.as_str() {
        "last_commit" => vec![
            "diff".into(), "HEAD~1".into(), "HEAD".into(), "--".into(), file_path.clone(),
        ],
        _ => vec!["diff".into(), "HEAD".into(), "--".into(), file_path.clone()],
    };

    let output = std::process::Command::new("git")
        .args(&args)
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Detect binary
    if stdout.contains("Binary files") {
        return Ok(FileDiff {
            path: file_path,
            status: String::new(),
            is_binary: true,
            hunks: Vec::new(),
            additions: 0,
            deletions: 0,
        });
    }

    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut additions: u32 = 0;
    let mut deletions: u32 = 0;
    let mut current_hunk: Option<DiffHunk> = None;
    let mut old_line: u32 = 0;
    let mut new_line: u32 = 0;
    let mut total_lines: u32 = 0;
    let max_lines: u32 = 10_000;

    for raw_line in stdout.lines() {
        // Parse hunk header
        if raw_line.starts_with("@@") {
            if let Some(h) = current_hunk.take() {
                hunks.push(h);
            }
            let (old_start, new_start) = parse_hunk_header(raw_line);
            old_line = old_start;
            new_line = new_start;
            current_hunk = Some(DiffHunk {
                header: raw_line.to_string(),
                old_start,
                new_start,
                lines: Vec::new(),
            });
            continue;
        }

        if current_hunk.is_none() {
            continue;
        }

        if total_lines >= max_lines {
            break;
        }

        let hunk = current_hunk.as_mut().unwrap();

        if let Some(content) = raw_line.strip_prefix('+') {
            additions += 1;
            total_lines += 1;
            hunk.lines.push(DiffHunkLine {
                line_type: "add".to_string(),
                content: content.to_string(),
                old_line: None,
                new_line: Some(new_line),
            });
            new_line += 1;
        } else if let Some(content) = raw_line.strip_prefix('-') {
            deletions += 1;
            total_lines += 1;
            hunk.lines.push(DiffHunkLine {
                line_type: "remove".to_string(),
                content: content.to_string(),
                old_line: Some(old_line),
                new_line: None,
            });
            old_line += 1;
        } else {
            let content = raw_line.strip_prefix(' ').unwrap_or(raw_line);
            total_lines += 1;
            hunk.lines.push(DiffHunkLine {
                line_type: "context".to_string(),
                content: content.to_string(),
                old_line: Some(old_line),
                new_line: Some(new_line),
            });
            old_line += 1;
            new_line += 1;
        }
    }

    if let Some(h) = current_hunk {
        hunks.push(h);
    }

    Ok(FileDiff {
        path: file_path,
        status: String::new(),
        is_binary: false,
        hunks,
        additions,
        deletions,
    })
}

fn parse_hunk_header(header: &str) -> (u32, u32) {
    let mut old_start = 1u32;
    let mut new_start = 1u32;

    if let Some(at_rest) = header.strip_prefix("@@ ") {
        let parts: Vec<&str> = at_rest.splitn(4, ' ').collect();
        if let Some(old_part) = parts.first() {
            if let Some(stripped) = old_part.strip_prefix('-') {
                let num = stripped.split(',').next().unwrap_or("1");
                old_start = num.parse().unwrap_or(1);
            }
        }
        if let Some(new_part) = parts.get(1) {
            if let Some(stripped) = new_part.strip_prefix('+') {
                let num = stripped.split(',').next().unwrap_or("1");
                new_start = num.parse().unwrap_or(1);
            }
        }
    }

    (old_start, new_start)
}
