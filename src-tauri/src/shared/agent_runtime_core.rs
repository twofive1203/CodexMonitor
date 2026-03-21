use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::Mutex;

use crate::backend::app_server::WorkspaceSession;
use crate::types::{AgentProvider, ProviderCapabilities, WorkspaceEntry};

use super::{codex_core, provider_core};

/// 读取指定 provider 的 capability。
///
/// `provider`：目标 provider。
pub(crate) fn get_provider_capabilities_core(provider: AgentProvider) -> ProviderCapabilities {
    provider_core::provider_capabilities(&provider)
}

async fn resolve_runtime_provider(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<AgentProvider, String> {
    provider_core::resolve_workspace_provider(workspaces, workspace_id).await
}

/// 统一启动线程入口。
///
/// `sessions`：provider 维度 session 池。
/// `workspaces`：工作区存储。
/// `workspace_id`：目标工作区 ID。
pub(crate) async fn start_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    match resolve_runtime_provider(workspaces, &workspace_id).await? {
        AgentProvider::Codex | AgentProvider::Claude => {
            codex_core::start_thread_core(sessions, workspaces, workspace_id).await
        }
    }
}

/// 统一恢复线程入口。
///
/// `sessions`：provider 维度 session 池。
/// `workspaces`：工作区存储。
/// `workspace_id`：目标工作区 ID。
/// `thread_id`：目标线程 ID。
pub(crate) async fn resume_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    match resolve_runtime_provider(workspaces, &workspace_id).await? {
        AgentProvider::Codex | AgentProvider::Claude => {
            codex_core::resume_thread_core(sessions, workspace_id, thread_id).await
        }
    }
}

/// 统一发送消息入口。
///
/// `sessions`：provider 维度 session 池。
/// `workspaces`：工作区存储。
/// `workspace_id`：目标工作区 ID。
/// `thread_id`：目标线程 ID。
pub(crate) async fn send_user_message_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
    thread_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    service_tier: Option<Option<String>>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    app_mentions: Option<Vec<Value>>,
    collaboration_mode: Option<Value>,
) -> Result<Value, String> {
    match resolve_runtime_provider(workspaces, &workspace_id).await? {
        AgentProvider::Codex | AgentProvider::Claude => {
            codex_core::send_user_message_core(
                sessions,
                workspaces,
                workspace_id,
                thread_id,
                text,
                model,
                effort,
                service_tier,
                access_mode,
                images,
                app_mentions,
                collaboration_mode,
            )
            .await
        }
    }
}

/// 统一中断运行入口。
///
/// `sessions`：provider 维度 session 池。
/// `workspaces`：工作区存储。
/// `workspace_id`：目标工作区 ID。
/// `thread_id`：目标线程 ID。
/// `turn_id`：目标轮次 ID。
pub(crate) async fn interrupt_turn_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
    thread_id: String,
    turn_id: String,
) -> Result<Value, String> {
    match resolve_runtime_provider(workspaces, &workspace_id).await? {
        AgentProvider::Codex | AgentProvider::Claude => {
            codex_core::turn_interrupt_core(sessions, workspace_id, thread_id, turn_id).await
        }
    }
}

/// 统一读取模型列表入口。
///
/// `sessions`：provider 维度 session 池。
/// `workspaces`：工作区存储。
/// `workspace_id`：目标工作区 ID。
pub(crate) async fn list_models_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    match resolve_runtime_provider(workspaces, &workspace_id).await? {
        AgentProvider::Codex | AgentProvider::Claude => {
            codex_core::model_list_core(sessions, workspace_id).await
        }
    }
}

/// 统一启动审查入口。
///
/// `sessions`：provider 维度 session 池。
/// `workspaces`：工作区存储。
/// `workspace_id`：目标工作区 ID。
/// `thread_id`：目标线程 ID。
/// `target`：审查目标。
/// `delivery`：审查结果投递方式。
pub(crate) async fn start_review_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
    thread_id: String,
    target: Value,
    delivery: Option<String>,
) -> Result<Value, String> {
    match resolve_runtime_provider(workspaces, &workspace_id).await? {
        AgentProvider::Codex => {
            codex_core::start_review_core(sessions, workspace_id, thread_id, target, delivery).await
        }
        AgentProvider::Claude => Err("Claude Provider 暂不支持 review/start。".to_string()),
    }
}

/// 统一回传审批或用户输入结果入口。
///
/// `sessions`：provider 维度 session 池。
/// `workspaces`：工作区存储。
/// `workspace_id`：目标工作区 ID。
/// `request_id`：前端回传的请求 ID。
/// `result`：前端确认后的结果对象。
pub(crate) async fn respond_to_server_request_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
    request_id: Value,
    result: Value,
) -> Result<(), String> {
    match resolve_runtime_provider(workspaces, &workspace_id).await? {
        AgentProvider::Codex | AgentProvider::Claude => {
            codex_core::respond_to_server_request_core(sessions, workspace_id, request_id, result)
                .await
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use serde_json::json;
    use tokio::sync::Mutex;

    use super::{get_provider_capabilities_core, start_review_core};
    use crate::backend::app_server::WorkspaceSession;
    use crate::types::{
        AgentProvider, ProviderCapabilities, WorkspaceEntry, WorkspaceKind, WorkspaceSettings,
    };

    fn make_workspace_entry(id: &str, provider: AgentProvider) -> WorkspaceEntry {
        WorkspaceEntry {
            id: id.to_string(),
            name: id.to_string(),
            path: "/tmp".to_string(),
            provider,
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    #[test]
    fn get_provider_capabilities_core_uses_provider_snapshot() {
        assert_eq!(
            get_provider_capabilities_core(AgentProvider::Claude),
            ProviderCapabilities::from_provider(&AgentProvider::Claude)
        );
        assert_eq!(
            get_provider_capabilities_core(AgentProvider::Codex),
            ProviderCapabilities::from_provider(&AgentProvider::Codex)
        );
    }

    #[test]
    fn start_review_core_rejects_claude_workspace_provider() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let workspaces = Mutex::new(HashMap::from([(
                "ws-claude".to_string(),
                make_workspace_entry("ws-claude", AgentProvider::Claude),
            )]));
            let sessions = Mutex::new(HashMap::<String, Arc<WorkspaceSession>>::new());

            let result = start_review_core(
                &sessions,
                &workspaces,
                "ws-claude".to_string(),
                "thread-1".to_string(),
                json!({ "type": "uncommittedChanges" }),
                Some("inline".to_string()),
            )
            .await;

            assert_eq!(
                result,
                Err("Claude Provider 暂不支持 review/start。".to_string())
            );
        });
    }
}
