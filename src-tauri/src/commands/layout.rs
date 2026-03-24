use std::fs;
use std::path::PathBuf;

fn layouts_path() -> PathBuf {
    dirs::home_dir()
        .expect("could not determine home directory")
        .join(".dorothy")
        .join("layouts.json")
}

#[tauri::command]
pub fn layout_get() -> Result<String, String> {
    let path = layouts_path();
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn layout_save(data: String) -> Result<(), String> {
    let path = layouts_path();
    // Ensure ~/.dorothy exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, data).map_err(|e| e.to_string())
}
