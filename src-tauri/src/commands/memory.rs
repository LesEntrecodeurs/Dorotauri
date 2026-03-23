use std::fs;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFile {
    pub name: String,
    pub path: String,
    pub is_entrypoint: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemory {
    pub id: String,
    pub project_name: String,
    pub project_path: String,
    pub memory_dir: String,
    pub files: Vec<MemoryFile>,
    pub has_memory: bool,
    pub provider: String,
}

// ---------------------------------------------------------------------------
// Provider memory directories to scan
// ---------------------------------------------------------------------------

struct ProviderDir {
    provider: &'static str,
    dir: PathBuf,
}

fn provider_dirs() -> Vec<ProviderDir> {
    let home = dirs::home_dir().expect("could not determine home directory");
    vec![
        ProviderDir {
            provider: "claude",
            dir: home.join(".claude").join("projects"),
        },
        ProviderDir {
            provider: "codex",
            dir: home.join(".codex").join("projects"),
        },
        ProviderDir {
            provider: "gemini",
            dir: home.join(".gemini").join("projects"),
        },
    ]
}

// ---------------------------------------------------------------------------
// Path safety: ensure a file path is within one of the provider directories
// ---------------------------------------------------------------------------

fn is_within_projects_dir(file_path: &str) -> bool {
    let resolved = match fs::canonicalize(file_path) {
        Ok(p) => p,
        Err(_) => PathBuf::from(file_path),
    };
    for pd in provider_dirs() {
        if resolved.starts_with(&pd.dir) {
            return true;
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Decode a Claude Code project directory name back to a filesystem path.
//
// Claude Code encodes project paths by replacing `/` (and `.`) with `-`.
// Example: `-Users-charlie-projects-myapp` -> `/Users/charlie/projects/myapp`
//
// This is a simplified version that reconstructs the path greedily by
// checking the filesystem, matching the TypeScript implementation.
// ---------------------------------------------------------------------------

fn decode_project_path(dir_name: &str) -> String {
    let stripped = dir_name.strip_prefix('-').unwrap_or(dir_name);
    let tokens: Vec<&str> = stripped.split('-').collect();
    let mut resolved = PathBuf::from("/");
    let mut i = 0;

    while i < tokens.len() {
        let mut matched = false;

        // Try longest segment first
        let max_len = tokens.len() - i;
        for len in (1..=max_len).rev() {
            let sub_tokens = &tokens[i..i + len];

            if len == 1 {
                let candidate = resolved.join(sub_tokens[0]);
                if candidate.exists() {
                    resolved = candidate;
                    i += 1;
                    matched = true;
                    break;
                }
            } else {
                // Try separator combinations (- and .) — capped at 6 positions
                let positions = len - 1;
                if positions > 6 {
                    // Safety: just try all-dash and all-dot
                    for sep in &["-", "."] {
                        let name = sub_tokens.join(sep);
                        let candidate = resolved.join(&name);
                        if candidate.exists() {
                            resolved = candidate;
                            i += len;
                            matched = true;
                            break;
                        }
                    }
                } else {
                    let total = 1u32 << positions;
                    let separators = ['-', '.'];
                    for mask in 0..total {
                        let mut name = sub_tokens[0].to_string();
                        for j in 0..positions {
                            let sep_idx = ((mask >> j) & 1) as usize;
                            name.push(separators[sep_idx]);
                            name.push_str(sub_tokens[j + 1]);
                        }
                        let candidate = resolved.join(&name);
                        if candidate.exists() {
                            resolved = candidate;
                            i += len;
                            matched = true;
                            break;
                        }
                    }
                }
                if matched {
                    break;
                }
            }
        }

        if !matched {
            // Nothing found on disk — append the single token as-is
            resolved = resolved.join(tokens[i]);
            i += 1;
        }
    }

    resolved.to_string_lossy().to_string()
}

fn get_project_name(decoded_path: &str) -> String {
    Path::new(decoded_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| decoded_path.to_string())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn memory_list_projects() -> Vec<ProjectMemory> {
    let mut results = Vec::new();

    for pd in provider_dirs() {
        if !pd.dir.exists() {
            continue;
        }

        let entries = match fs::read_dir(&pd.dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let entry_path = entry.path();
            if !entry_path.is_dir() {
                continue;
            }

            let dir_name = match entry.file_name().into_string() {
                Ok(n) => n,
                Err(_) => continue,
            };

            let memory_dir = entry_path.join("memory");
            let decoded_path = decode_project_path(&dir_name);
            let project_name = get_project_name(&decoded_path);

            let mut project = ProjectMemory {
                id: format!("{}:{}", pd.provider, dir_name),
                project_name,
                project_path: decoded_path,
                memory_dir: memory_dir.to_string_lossy().to_string(),
                files: Vec::new(),
                has_memory: false,
                provider: pd.provider.to_string(),
            };

            if memory_dir.exists() {
                if let Ok(md_entries) = fs::read_dir(&memory_dir) {
                    let mut md_files: Vec<String> = md_entries
                        .flatten()
                        .filter_map(|e| {
                            let name = e.file_name().into_string().ok()?;
                            if name.ends_with(".md") {
                                Some(name)
                            } else {
                                None
                            }
                        })
                        .collect();

                    // Sort: MEMORY.md first, then alphabetical
                    md_files.sort_by(|a, b| {
                        if a == "MEMORY.md" {
                            std::cmp::Ordering::Less
                        } else if b == "MEMORY.md" {
                            std::cmp::Ordering::Greater
                        } else {
                            a.cmp(b)
                        }
                    });

                    project.files = md_files
                        .iter()
                        .map(|name| {
                            let file_path = memory_dir.join(name);
                            MemoryFile {
                                name: name.clone(),
                                path: file_path.to_string_lossy().to_string(),
                                is_entrypoint: name == "MEMORY.md",
                            }
                        })
                        .collect();

                    project.has_memory = !project.files.is_empty();
                }
            }

            results.push(project);
        }
    }

    // Sort: projects with memory first, then alphabetically by name
    results.sort_by(|a, b| {
        if a.has_memory && !b.has_memory {
            std::cmp::Ordering::Less
        } else if !a.has_memory && b.has_memory {
            std::cmp::Ordering::Greater
        } else {
            a.project_name.cmp(&b.project_name)
        }
    });

    results
}

#[tauri::command]
pub fn memory_read_file(path: String) -> Result<String, String> {
    if !is_within_projects_dir(&path) {
        return Err("Access denied: path outside projects directory".into());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn memory_write_file(path: String, content: String) -> Result<(), String> {
    if !is_within_projects_dir(&path) {
        return Err("Access denied: path outside projects directory".into());
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn memory_create_file(memory_dir: String, file_name: String, content: String) -> Result<(), String> {
    if !is_within_projects_dir(&memory_dir) {
        return Err("Access denied: path outside projects directory".into());
    }
    // Reject path traversal in file_name
    if file_name.contains('/') || file_name.contains("..") {
        return Err("Invalid file name".into());
    }

    let final_name = if file_name.ends_with(".md") {
        file_name
    } else {
        format!("{file_name}.md")
    };

    let dir_path = PathBuf::from(&memory_dir);
    if !dir_path.exists() {
        fs::create_dir_all(&dir_path).map_err(|e| e.to_string())?;
    }

    let file_path = dir_path.join(&final_name);
    if file_path.exists() {
        return Err("File already exists".into());
    }

    fs::write(&file_path, content).map_err(|e| e.to_string())
}
