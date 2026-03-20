use std::path::PathBuf;

/// Returns the supported daemon executable names for the current platform.
pub(crate) fn daemon_binary_candidates() -> &'static [&'static str] {
    if cfg!(windows) {
        &["codex_monitor_daemon.exe", "codex-monitor-daemon.exe"]
    } else {
        &["codex_monitor_daemon", "codex-monitor-daemon"]
    }
}

/// Builds the ordered daemon search directories.
///
/// Parameter `executable_dir`: parent directory of the current desktop app binary.
fn daemon_search_dirs(executable_dir: &std::path::Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    let mut push_unique = |path: PathBuf| {
        if !dirs.iter().any(|entry| entry == &path) {
            dirs.push(path);
        }
    };

    push_unique(executable_dir.to_path_buf());

    if let Some(target_dir) = executable_dir.parent() {
        push_unique(target_dir.join("debug"));
        push_unique(target_dir.join("release"));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        push_unique(current_dir.clone());
        push_unique(current_dir.join("target").join("debug"));
        push_unique(current_dir.join("target").join("release"));
        push_unique(current_dir.join("src-tauri").join("target").join("debug"));
        push_unique(current_dir.join("src-tauri").join("target").join("release"));
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(contents_dir) = executable_dir.parent() {
            push_unique(contents_dir.join("Resources"));
        }
        push_unique(PathBuf::from("/opt/homebrew/bin"));
        push_unique(PathBuf::from("/usr/local/bin"));
    }

    #[cfg(target_os = "linux")]
    {
        push_unique(PathBuf::from("/usr/local/bin"));
        push_unique(PathBuf::from("/usr/bin"));
        push_unique(PathBuf::from("/usr/sbin"));
    }

    dirs
}

/// Resolves the daemon binary path for the current runtime.
///
/// The function first honors `CODEX_MONITOR_DAEMON_PATH`, then falls back to
/// common development and packaged output directories.
pub(crate) fn resolve_daemon_binary_path() -> Result<PathBuf, String> {
    let mut attempted_paths: Vec<PathBuf> = Vec::new();
    let current_exe = std::env::current_exe().map_err(|err| err.to_string())?;
    let parent = current_exe
        .parent()
        .ok_or_else(|| "无法解析可执行文件所在目录。".to_string())?;
    let candidate_names = daemon_binary_candidates();

    if let Ok(explicit_raw) = std::env::var("CODEX_MONITOR_DAEMON_PATH") {
        let explicit = explicit_raw.trim();
        if !explicit.is_empty() {
            let explicit_path = PathBuf::from(explicit);
            if explicit_path.is_file() {
                return Ok(explicit_path);
            }
            if explicit_path.is_dir() {
                for name in candidate_names {
                    let candidate = explicit_path.join(name);
                    if candidate.is_file() {
                        return Ok(candidate);
                    }
                    attempted_paths.push(candidate);
                }
            } else {
                attempted_paths.push(explicit_path);
            }
        }
    }

    for search_dir in daemon_search_dirs(parent) {
        for name in candidate_names {
            let candidate = search_dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
            attempted_paths.push(candidate);
        }
    }

    let attempted = attempted_paths
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");

    Err(format!(
        "无法找到守护进程可执行文件（已尝试：{}）。本地开发请先运行 `cargo build --manifest-path src-tauri/Cargo.toml --bin codex_monitor_daemon`。",
        attempted
    ))
}

#[cfg(test)]
mod tests {
    use super::daemon_binary_candidates;

    #[test]
    fn daemon_binary_candidates_prioritize_underscored_name() {
        assert!(daemon_binary_candidates()[0].starts_with("codex_monitor_daemon"));
    }
}
