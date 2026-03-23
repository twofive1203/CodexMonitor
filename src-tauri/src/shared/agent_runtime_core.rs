use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::Mutex;

use crate::backend::app_server::WorkspaceSession;
use crate::types::{AgentProvider, ProviderCapabilities, WorkspaceEntry};

use super::{claude_commands_core, codex_core, provider_core};

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
            codex_core::resume_thread_core(sessions, workspaces, workspace_id, thread_id).await
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

/// 统一跟进当前回合入口。
///
/// `sessions`：provider 维度 session 池。
/// `workspaces`：工作区存储。
/// `workspace_id`：目标工作区 ID。
/// `thread_id`：目标线程 ID。
/// `turn_id`：目标轮次 ID。
/// `text`：跟进消息内容。
/// `images`：附带图片。
/// `app_mentions`：附带应用引用。
pub(crate) async fn steer_turn_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
    thread_id: String,
    turn_id: String,
    text: String,
    images: Option<Vec<String>>,
    app_mentions: Option<Vec<Value>>,
) -> Result<Value, String> {
    match resolve_runtime_provider(workspaces, &workspace_id).await? {
        AgentProvider::Codex | AgentProvider::Claude => {
            codex_core::turn_steer_core(
                sessions,
                workspace_id,
                thread_id,
                turn_id,
                text,
                images,
                app_mentions,
            )
            .await
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

/// 统一读取 Claude 自定义命令入口。
///
/// `workspaces`：工作区存储。
/// `workspace_id`：目标工作区 ID。
pub(crate) async fn list_claude_commands_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    match resolve_runtime_provider(workspaces, &workspace_id).await? {
        AgentProvider::Claude => {
            serde_json::to_value(
                claude_commands_core::list_claude_commands_core(workspaces, workspace_id).await?,
            )
            .map_err(|err| err.to_string())
        }
        AgentProvider::Codex => Ok(Value::Array(Vec::new())),
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
    use serde_json::Value;
    use tokio::sync::Mutex;

    use super::{
        get_provider_capabilities_core, interrupt_turn_core, respond_to_server_request_core,
        resume_thread_core, send_user_message_core, start_review_core, start_thread_core,
        steer_turn_core,
    };
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

    /// 运行异步共享层测试。
    ///
    /// `future`：待执行的异步测试体。
    fn run_async_test<F>(future: F)
    where
        F: std::future::Future<Output = ()>,
    {
        tokio::runtime::Runtime::new()
            .expect("runtime")
            .block_on(future);
    }

    /// 构造 Claude provider 的共享层测试上下文。
    ///
    /// 返回值：`(sessions, workspaces)`。
    fn make_claude_runtime_context(
    ) -> (
        Mutex<HashMap<String, Arc<WorkspaceSession>>>,
        Mutex<HashMap<String, WorkspaceEntry>>,
    ) {
        (
            Mutex::new(HashMap::<String, Arc<WorkspaceSession>>::new()),
            Mutex::new(HashMap::from([(
                "ws-claude".to_string(),
                make_workspace_entry("ws-claude", AgentProvider::Claude),
            )])),
        )
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
        run_async_test(async {
            let (sessions, workspaces) = make_claude_runtime_context();

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

    #[test]
    fn steer_turn_core_routes_claude_workspace_through_shared_runtime() {
        run_async_test(async {
            let (sessions, workspaces) = make_claude_runtime_context();

            let result = steer_turn_core(
                &sessions,
                &workspaces,
                "ws-claude".to_string(),
                "thread-1".to_string(),
                "".to_string(),
                "follow up".to_string(),
                None,
                None,
            )
            .await;

            assert_eq!(result, Err("missing active turn id".to_string()));
        });
    }

    #[test]
    fn start_thread_core_routes_claude_workspace_through_shared_runtime() {
        run_async_test(async {
            let (sessions, workspaces) = make_claude_runtime_context();

            let result = start_thread_core(&sessions, &workspaces, "ws-claude".to_string()).await;

            assert_eq!(result, Err("workspace not connected".to_string()));
        });
    }

    #[test]
    fn resume_thread_core_routes_claude_workspace_through_shared_runtime() {
        run_async_test(async {
            let (sessions, workspaces) = make_claude_runtime_context();

            let result = resume_thread_core(
                &sessions,
                &workspaces,
                "ws-claude".to_string(),
                "thread-1".to_string(),
            )
            .await;

            assert_eq!(result, Err("workspace not connected".to_string()));
        });
    }

    #[test]
    fn send_user_message_core_routes_claude_workspace_through_shared_runtime() {
        run_async_test(async {
            let (sessions, workspaces) = make_claude_runtime_context();

            let result = send_user_message_core(
                &sessions,
                &workspaces,
                "ws-claude".to_string(),
                "thread-1".to_string(),
                "hello".to_string(),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
            .await;

            assert_eq!(result, Err("workspace not connected".to_string()));
        });
    }

    #[test]
    fn interrupt_turn_core_routes_claude_workspace_through_shared_runtime() {
        run_async_test(async {
            let (sessions, workspaces) = make_claude_runtime_context();

            let result = interrupt_turn_core(
                &sessions,
                &workspaces,
                "ws-claude".to_string(),
                "thread-1".to_string(),
                "turn-1".to_string(),
            )
            .await;

            assert_eq!(result, Err("workspace not connected".to_string()));
        });
    }

    #[test]
    fn respond_to_server_request_core_routes_claude_workspace_through_shared_runtime() {
        run_async_test(async {
            let (sessions, workspaces) = make_claude_runtime_context();

            let result = respond_to_server_request_core(
                &sessions,
                &workspaces,
                "ws-claude".to_string(),
                Value::String("req-1".to_string()),
                json!({ "decision": "approve" }),
            )
            .await;

            assert_eq!(result, Err("workspace not connected".to_string()));
        });
    }
}
