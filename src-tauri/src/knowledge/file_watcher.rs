use std::path::{Path, PathBuf};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;
use tokio::time::{timeout_at, Duration, Instant};

use crate::knowledge::tree_sitter::detect_language;

/// Directories to ignore when watching for file changes.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    "__pycache__",
    "venv",
    ".venv",
    "vendor",
    ".cache",
    "coverage",
    ".turbo",
];

/// Returns `true` if the path contains any component that should be ignored.
fn is_ignored_path(path: &Path) -> bool {
    path.components().any(|c| {
        let s = c.as_os_str().to_str().unwrap_or("");
        SKIP_DIRS.contains(&s)
    })
}

/// Watch a project directory for source file changes.
///
/// Returns:
/// - A `RecommendedWatcher` handle that **must be kept alive** for watching
///   to continue.
/// - A `tokio::sync::mpsc::Receiver` that yields batches of changed
///   [`PathBuf`]s after a 2-second debounce window.
///
/// Only paths that:
/// 1. Belong to a supported language (detected via [`detect_language`]).
/// 2. Do not reside under an ignored directory.
///
/// …are forwarded to the receiver.
pub fn watch_project(
    project_root: &Path,
) -> Result<(RecommendedWatcher, mpsc::Receiver<Vec<PathBuf>>), String> {
    // Channel from the notify callback to the debounce task.
    // Using a bounded channel; if the debounce task falls behind we drop events
    // (they will be picked up on the next batch anyway).
    let (debounce_tx, mut debounce_rx) = mpsc::channel::<PathBuf>(256);

    // Output channel returned to the caller.
    let (tx, rx) = mpsc::channel::<Vec<PathBuf>>(32);

    // Spawn the debounce task.
    tokio::spawn(async move {
        loop {
            // Wait for the first path in a batch.
            let first = match debounce_rx.recv().await {
                Some(p) => p,
                None => break, // channel closed — watcher dropped
            };

            let mut batch = vec![first];
            let deadline = Instant::now() + Duration::from_secs(2);

            // Drain everything that arrives within the 2-second window.
            loop {
                match timeout_at(deadline, debounce_rx.recv()).await {
                    Ok(Some(path)) => {
                        if !batch.contains(&path) {
                            batch.push(path);
                        }
                    }
                    Ok(None) => {
                        // Channel closed.
                        let _ = tx.send(batch).await;
                        return;
                    }
                    Err(_) => {
                        // Timeout expired — emit the batch.
                        break;
                    }
                }
            }

            if tx.send(batch).await.is_err() {
                // Receiver dropped — stop the task.
                break;
            }
        }
    });

    // Build the notify watcher that feeds paths into the debounce channel.
    let watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        let event = match event {
            Ok(e) => e,
            Err(_) => return,
        };

        // Only react to create / modify events.
        match event.kind {
            EventKind::Create(_) | EventKind::Modify(_) => {}
            _ => return,
        }

        for path in event.paths {
            if is_ignored_path(&path) {
                continue;
            }
            // Only source files supported by tree-sitter.
            if detect_language(&path).is_none() {
                continue;
            }
            // best-effort send; drop if channel is full.
            let _ = debounce_tx.blocking_send(path);
        }
    })
    .map_err(|e| format!("file_watcher: failed to create watcher: {e}"))?;

    // Start watching — need a mutable reference temporarily.
    let mut watcher = watcher;
    watcher
        .watch(project_root, RecursiveMode::Recursive)
        .map_err(|e| format!("file_watcher: failed to watch {}: {e}", project_root.display()))?;

    Ok((watcher, rx))
}
