use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{AppHandle, Manager, State, Window};
use tokio::time::timeout;
use uuid::Uuid;

use crate::shared::claude_sdk_core;
use crate::shared::process_core::{build_gui_cli_command, build_gui_command_path_env};
use crate::shared::settings_core::{
    get_app_settings_core, get_codex_config_path_core, update_app_settings_core,
};
use crate::state::AppState;
use crate::types::{AppSettings, BackendMode, ClaudeSdkStatus};
use crate::window;

#[tauri::command]
pub(crate) async fn get_app_settings(
    state: State<'_, AppState>,
    window: Window,
) -> Result<AppSettings, String> {
    let settings = get_app_settings_core(&state.app_settings).await;
    let _ = window::apply_window_appearance(&window, settings.theme.as_str());
    Ok(settings)
}

#[tauri::command]
pub(crate) async fn update_app_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
    window: Window,
) -> Result<AppSettings, String> {
    let previous = state.app_settings.lock().await.clone();
    let updated =
        update_app_settings_core(settings, &state.app_settings, &state.settings_path).await?;
    if should_reset_remote_backend(&previous, &updated) {
        *state.remote_backend.lock().await = None;
    }
    ensure_remote_runtime_for_settings(&previous, &updated, state).await;
    let _ = window::apply_window_appearance(&window, updated.theme.as_str());
    Ok(updated)
}

#[tauri::command]
pub(crate) async fn get_codex_config_path() -> Result<String, String> {
    get_codex_config_path_core()
}

#[tauri::command]
pub(crate) async fn claude_sdk_status(app: AppHandle) -> Result<ClaudeSdkStatus, String> {
    let data_dir = app_data_dir(&app)?;
    let project_root = project_root();
    let current_exe = std::env::current_exe().ok();
    Ok(claude_sdk_core::read_claude_sdk_status(
        &project_root,
        Some(&data_dir),
        current_exe.as_deref(),
    ))
}

#[tauri::command]
pub(crate) async fn claude_sdk_install(app: AppHandle) -> Result<ClaudeSdkStatus, String> {
    let data_dir = app_data_dir(&app)?;
    let target_dir = claude_sdk_core::claude_sdk_dir(&data_dir);
    let project_root = project_root();
    let current_exe = std::env::current_exe().ok();

    let current_status = claude_sdk_core::read_claude_sdk_status(
        &project_root,
        Some(&data_dir),
        current_exe.as_deref(),
    );
    if current_status.state == crate::types::ClaudeSdkState::Ready
        && current_status.source == Some(crate::types::ClaudeSdkSource::AppData)
    {
        return Ok(current_status);
    }

    let staging_root = data_dir.join(format!("claude-sdk-install-{}", Uuid::new_v4()));
    let install_result = install_claude_sdk_into_dir(&staging_root, &target_dir).await;
    let _ = tokio::fs::remove_dir_all(&staging_root).await;
    install_result?;

    Ok(claude_sdk_core::read_claude_sdk_status(
        &project_root,
        Some(&data_dir),
        current_exe.as_deref(),
    ))
}

#[tauri::command]
pub(crate) async fn claude_sdk_remove(app: AppHandle) -> Result<ClaudeSdkStatus, String> {
    let data_dir = app_data_dir(&app)?;
    let target_dir = claude_sdk_core::claude_sdk_dir(&data_dir);
    if target_dir.exists() {
        tokio::fs::remove_dir_all(&target_dir)
            .await
            .map_err(|error| format!("移除 Claude SDK 目录失败：{error}"))?;
    }
    let project_root = project_root();
    let current_exe = std::env::current_exe().ok();
    Ok(claude_sdk_core::read_claude_sdk_status(
        &project_root,
        Some(&data_dir),
        current_exe.as_deref(),
    ))
}

/// 解析应用数据目录。
///
/// `app`：当前应用句柄。
fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("无法解析应用数据目录：{error}"))
}

/// 返回仓库根目录。
///
/// 无入参，固定回到 `src-tauri/..`。
fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// 将 Claude SDK 安装到目标目录。
///
/// `staging_root`：npm 安装临时目录。
/// `target_dir`：最终落盘目录。
async fn install_claude_sdk_into_dir(staging_root: &Path, target_dir: &Path) -> Result<(), String> {
    let package_spec = claude_sdk_core::claude_sdk_package_spec()?;
    tokio::fs::create_dir_all(staging_root)
        .await
        .map_err(|error| format!("创建 Claude SDK 临时目录失败：{error}"))?;

    let path_env = build_gui_command_path_env(None);
    let mut command = build_gui_cli_command(
        "npm",
        vec![
            "install".to_string(),
            "--no-save".to_string(),
            "--no-package-lock".to_string(),
            "--omit=dev".to_string(),
            package_spec.to_string(),
        ],
        path_env,
    )?;
    command.current_dir(staging_root);
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    let output = match timeout(Duration::from_secs(60 * 10), command.output()).await {
        Ok(result) => result.map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                "未找到 npm。请确认本机已安装 Node.js 18+，并能在终端执行 `npm --version`。"
                    .to_string()
            } else {
                format!("启动 npm 失败：{error}")
            }
        })?,
        Err(_) => return Err("下载 Claude SDK 超时，请稍后重试。".to_string()),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(if detail.is_empty() {
            "安装 Claude SDK 失败，请确认当前网络可访问 npm registry。".to_string()
        } else {
            format!("安装 Claude SDK 失败：{detail}")
        });
    }

    let installed_dir = staging_root
        .join("node_modules")
        .join("@anthropic-ai")
        .join("claude-agent-sdk");
    if !installed_dir.exists() {
        return Err("npm 安装完成，但未找到 Claude SDK 目录。".to_string());
    }

    if target_dir.exists() {
        tokio::fs::remove_dir_all(target_dir)
            .await
            .map_err(|error| format!("替换旧版 Claude SDK 失败：{error}"))?;
    }
    if let Some(parent) = target_dir.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("创建 Claude SDK 目标目录失败：{error}"))?;
    }

    tokio::fs::rename(&installed_dir, target_dir)
        .await
        .map_err(|error| format!("写入 Claude SDK 目录失败：{error}"))?;
    Ok(())
}

fn should_reset_remote_backend(previous: &AppSettings, updated: &AppSettings) -> bool {
    let backend_mode_changed = !matches!(
        (&previous.backend_mode, &updated.backend_mode),
        (
            crate::types::BackendMode::Local,
            crate::types::BackendMode::Local
        ) | (
            crate::types::BackendMode::Remote,
            crate::types::BackendMode::Remote
        )
    );
    backend_mode_changed
        || previous.remote_backend_provider != updated.remote_backend_provider
        || previous.remote_backend_host != updated.remote_backend_host
        || previous.remote_backend_token != updated.remote_backend_token
}

async fn ensure_remote_runtime_for_settings(
    previous: &AppSettings,
    updated: &AppSettings,
    state: State<'_, AppState>,
) {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return;
    }

    let should_run_managed_daemon =
        matches!(updated.backend_mode, BackendMode::Remote) || updated.web_access_enabled;
    if should_run_managed_daemon {
        let _ = crate::tailscale::tailscale_daemon_start(state).await;
        return;
    }

    let should_stop_managed_daemon =
        matches!(previous.backend_mode, BackendMode::Remote) || previous.web_access_enabled;
    if should_stop_managed_daemon {
        let _ = crate::tailscale::tailscale_daemon_stop(state).await;
    }
}

#[cfg(test)]
mod tests {
    use super::should_reset_remote_backend;
    use crate::types::{AppSettings, BackendMode};

    #[test]
    fn should_reset_remote_backend_when_provider_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.remote_backend_provider = crate::types::RemoteBackendProvider::Tcp;
        updated.remote_backend_host = "remote.example:4732".to_string();
        assert!(should_reset_remote_backend(&previous, &updated));
    }

    #[test]
    fn should_reset_remote_backend_when_transport_token_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.remote_backend_token = Some("token-1".to_string());
        assert!(should_reset_remote_backend(&previous, &updated));
    }

    #[test]
    fn should_not_reset_remote_backend_for_non_transport_setting_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.theme = "dark".to_string();
        updated.backend_mode = BackendMode::Local;
        assert!(!should_reset_remote_backend(&previous, &updated));
    }
}
