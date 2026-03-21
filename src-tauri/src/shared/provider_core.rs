use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::backend::app_server::WorkspaceSession;
use crate::types::{AgentProvider, AppSettings, ProviderCapabilities, WorkspaceEntry};

pub(crate) const PROVIDER_SESSION_KEY_SEPARATOR: &str = "::";

/// 生成带 provider 维度的 session key。
///
/// `provider`：当前工作区绑定的 provider。
/// `workspace_id`：工作区唯一标识。
pub(crate) fn build_provider_session_key(provider: &AgentProvider, workspace_id: &str) -> String {
    format!(
        "{}{PROVIDER_SESSION_KEY_SEPARATOR}{workspace_id}",
        provider.as_str()
    )
}

/// 返回指定 provider 对应的 session key 前缀。
///
/// `provider`：需要筛选的 provider。
pub(crate) fn build_provider_session_prefix(provider: &AgentProvider) -> String {
    format!("{}{PROVIDER_SESSION_KEY_SEPARATOR}", provider.as_str())
}

/// 读取指定 provider 的能力快照。
///
/// `provider`：目标 provider。
pub(crate) fn provider_capabilities(provider: &AgentProvider) -> ProviderCapabilities {
    ProviderCapabilities::from_provider(provider)
}

/// 判断当前 provider 是否被设置项允许使用。
///
/// `provider`：待判断的 provider。
/// `app_settings`：当前应用设置快照。
pub(crate) fn provider_is_enabled(provider: &AgentProvider, app_settings: &AppSettings) -> bool {
    match provider {
        AgentProvider::Codex => true,
        AgentProvider::Claude => app_settings.experimental_claude_enabled,
    }
}

/// 根据当前设置裁剪 provider，避免禁用实验开关后继续默认走 Claude。
///
/// `provider`：原始 provider。
/// `app_settings`：当前应用设置快照。
pub(crate) fn sanitize_provider_for_app_settings(
    provider: AgentProvider,
    app_settings: &AppSettings,
) -> AgentProvider {
    if provider_is_enabled(&provider, app_settings) {
        return provider;
    }
    AgentProvider::Codex
}

/// 校验当前 provider 是否已开启。
///
/// `provider`：待校验的 provider。
/// `app_settings`：当前应用设置快照。
pub(crate) fn ensure_provider_enabled(
    provider: &AgentProvider,
    app_settings: &AppSettings,
) -> Result<(), String> {
    if provider_is_enabled(provider, app_settings) {
        return Ok(());
    }
    Err("Claude Provider 当前属于实验功能，请先在设置 -> 功能 中开启。".to_string())
}

/// 判断当前 provider 是否已经具备 I1 可连接的运行时实现。
///
/// `provider`：待判断的 provider。
pub(crate) fn provider_supports_live_runtime(provider: &AgentProvider) -> bool {
    matches!(provider, AgentProvider::Codex | AgentProvider::Claude)
}

/// 判断当前 provider 是否允许跨 workspace 复用 session。
///
/// `provider`：待判断的 provider。
pub(crate) fn provider_supports_shared_session(provider: &AgentProvider) -> bool {
    matches!(provider, AgentProvider::Codex)
}

/// 返回 provider 尚未接入时的统一错误。
///
/// `provider`：当前尝试访问的 provider。
pub(crate) fn provider_not_ready_error(provider: &AgentProvider) -> String {
    match provider {
        AgentProvider::Codex => "Codex Provider 运行时不可用。".to_string(),
        AgentProvider::Claude => "Claude Provider 运行时不可用。".to_string(),
    }
}

/// 解析工作区当前绑定的 provider。
///
/// `workspaces`：工作区存储。
/// `workspace_id`：目标工作区 ID。
pub(crate) async fn resolve_workspace_provider(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<AgentProvider, String> {
    let workspaces = workspaces.lock().await;
    workspaces
        .get(workspace_id)
        .map(|entry| entry.provider.clone())
        .ok_or_else(|| "workspace not found".to_string())
}

async fn session_contains_workspace(session: &Arc<WorkspaceSession>, workspace_id: &str) -> bool {
    session.workspace_ids.lock().await.contains(workspace_id)
}

/// 按工作区 ID 读取实际关联的 session。
///
/// `sessions`：provider 维度的 session 池。
/// `workspace_id`：目标工作区 ID。
pub(crate) async fn get_workspace_session(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: &str,
) -> Result<Arc<WorkspaceSession>, String> {
    let candidates = {
        let sessions = sessions.lock().await;
        sessions.values().cloned().collect::<Vec<_>>()
    };
    for session in candidates {
        if session_contains_workspace(&session, workspace_id).await {
            return Ok(session);
        }
    }
    Err("workspace not connected".to_string())
}

#[cfg(test)]
mod tests {
    use super::{ensure_provider_enabled, provider_is_enabled, sanitize_provider_for_app_settings};
    use crate::types::{AgentProvider, AppSettings};

    #[test]
    fn claude_provider_requires_experimental_flag() {
        let settings = AppSettings::default();
        assert!(!provider_is_enabled(&AgentProvider::Claude, &settings));
        assert!(ensure_provider_enabled(&AgentProvider::Claude, &settings).is_err());
        assert_eq!(
            sanitize_provider_for_app_settings(AgentProvider::Claude, &settings),
            AgentProvider::Codex
        );
    }

    #[test]
    fn claude_provider_is_available_when_flag_enabled() {
        let mut settings = AppSettings::default();
        settings.experimental_claude_enabled = true;
        assert!(provider_is_enabled(&AgentProvider::Claude, &settings));
        assert!(ensure_provider_enabled(&AgentProvider::Claude, &settings).is_ok());
        assert_eq!(
            sanitize_provider_for_app_settings(AgentProvider::Claude, &settings),
            AgentProvider::Claude
        );
    }
}
