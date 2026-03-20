use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::broadcast;

use super::*;
use crate::backend::events::{EventSink, TerminalExit, TerminalOutput};
use crate::shared::terminal_core::{
    close_terminal_session, is_terminal_closed_error, open_terminal_session,
    resize_terminal_session, spawn_terminal_reader, write_terminal_session, TerminalCleanup,
    TerminalSession,
};

/// 浏览器终端事件。
///
/// 用于在 daemon 终端 WS 连接之间转发某个 `client_id` 下的终端输出和退出通知。
///
/// @author lichong
#[derive(Clone)]
pub(crate) enum WebTerminalEvent {
    Output {
        client_id: String,
        payload: TerminalOutput,
    },
    Exit {
        client_id: String,
        payload: TerminalExit,
    },
}

impl WebTerminalEvent {
    /// 将浏览器终端事件编码为 WS 文本消息。
    ///
    /// 无入参，返回 JSON 文本；若序列化失败则返回 `None`。
    pub(crate) fn encode(&self) -> Option<String> {
        let payload = match self {
            Self::Output { payload, .. } => json!({
                "method": "terminal-output",
                "params": payload,
            }),
            Self::Exit { payload, .. } => json!({
                "method": "terminal-exit",
                "params": payload,
            }),
        };
        serde_json::to_string(&payload).ok()
    }

    /// 返回事件所属的浏览器客户端标识。
    ///
    /// 无入参，返回 `client_id`。
    pub(crate) fn client_id(&self) -> &str {
        match self {
            Self::Output { client_id, .. } | Self::Exit { client_id, .. } => client_id,
        }
    }
}

#[derive(Clone)]
struct WebTerminalEventSink {
    client_id: String,
    tx: broadcast::Sender<WebTerminalEvent>,
}

impl WebTerminalEventSink {
    /// 创建浏览器终端事件发射器。
    ///
    /// `client_id`：浏览器客户端标识；`tx`：终端事件广播通道。
    fn new(client_id: String, tx: broadcast::Sender<WebTerminalEvent>) -> Self {
        Self { client_id, tx }
    }
}

impl EventSink for WebTerminalEventSink {
    fn emit_app_server_event(&self, _event: AppServerEvent) {}

    fn emit_terminal_output(&self, event: TerminalOutput) {
        let _ = self.tx.send(WebTerminalEvent::Output {
            client_id: self.client_id.clone(),
            payload: event,
        });
    }

    fn emit_terminal_exit(&self, event: TerminalExit) {
        let _ = self.tx.send(WebTerminalEvent::Exit {
            client_id: self.client_id.clone(),
            payload: event,
        });
    }
}

fn terminal_key(client_id: &str, workspace_id: &str, terminal_id: &str) -> String {
    format!("{client_id}:{workspace_id}:{terminal_id}")
}

async fn get_terminal_session(
    state: &Arc<DaemonState>,
    key: &str,
) -> Result<Arc<TerminalSession>, String> {
    let sessions = state.terminal_sessions.lock().await;
    sessions
        .get(key)
        .cloned()
        .ok_or_else(|| "Terminal session not found".to_string())
}

async fn get_workspace_path(
    state: &Arc<DaemonState>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    state.sync_workspaces_from_storage().await;
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| "Unknown workspace".to_string())?;
    Ok(PathBuf::from(&entry.path))
}

/// 打开浏览器终端会话。
///
/// `state`：共享 daemon 状态；`client_id`：浏览器客户端标识；`workspace_id`：工作区标识；
/// `terminal_id`：终端标识；`cols`：初始列数；`rows`：初始行数；
/// `terminal_events`：终端事件广播通道。
pub(crate) async fn open_web_terminal(
    state: Arc<DaemonState>,
    client_id: String,
    workspace_id: String,
    terminal_id: String,
    cols: u16,
    rows: u16,
    terminal_events: broadcast::Sender<WebTerminalEvent>,
) -> Result<Value, String> {
    if terminal_id.trim().is_empty() {
        return Err("Terminal id is required".to_string());
    }

    let key = terminal_key(&client_id, &workspace_id, &terminal_id);
    {
        let sessions = state.terminal_sessions.lock().await;
        if let Some(existing) = sessions.get(&key) {
            return Ok(json!({ "id": existing.id }));
        }
    }

    let cwd = get_workspace_path(&state, &workspace_id).await?;
    let (session, reader) = open_terminal_session(cwd, terminal_id.clone(), cols, rows)?;
    let session_id = session.id.clone();

    {
        let mut sessions = state.terminal_sessions.lock().await;
        if let Some(existing) = sessions.get(&key) {
            let id = existing.id.clone();
            drop(sessions);
            close_terminal_session(session).await?;
            return Ok(json!({ "id": id }));
        }
        sessions.insert(key.clone(), Arc::clone(&session));
    }

    let cleanup_state = Arc::clone(&state);
    let cleanup_key = key.clone();
    let cleanup: TerminalCleanup = Arc::new(move |_, _, session| {
        let state = Arc::clone(&cleanup_state);
        let key = cleanup_key.clone();
        tokio::spawn(async move {
            let mut sessions = state.terminal_sessions.lock().await;
            let should_remove = sessions
                .get(&key)
                .is_some_and(|current| Arc::ptr_eq(current, &session));
            if should_remove {
                sessions.remove(&key);
            }
        });
    });

    let event_sink = WebTerminalEventSink::new(client_id, terminal_events);
    spawn_terminal_reader(
        event_sink,
        session,
        workspace_id,
        terminal_id,
        reader,
        cleanup,
    );
    Ok(json!({ "id": session_id }))
}

/// 向浏览器终端写入数据。
///
/// `state`：共享 daemon 状态；`client_id`：浏览器客户端标识；`workspace_id`：工作区标识；
/// `terminal_id`：终端标识；`data`：待写入内容。
pub(crate) async fn write_web_terminal(
    state: Arc<DaemonState>,
    client_id: &str,
    workspace_id: &str,
    terminal_id: &str,
    data: String,
) -> Result<(), String> {
    let key = terminal_key(client_id, workspace_id, terminal_id);
    let session = get_terminal_session(&state, &key).await?;
    let result = write_terminal_session(session, data).await;
    if let Err(error) = &result {
        if is_terminal_closed_error(error) {
            let mut sessions = state.terminal_sessions.lock().await;
            sessions.remove(&key);
        }
    }
    result
}

/// 调整浏览器终端大小。
///
/// `state`：共享 daemon 状态；`client_id`：浏览器客户端标识；`workspace_id`：工作区标识；
/// `terminal_id`：终端标识；`cols`：目标列数；`rows`：目标行数。
pub(crate) async fn resize_web_terminal(
    state: Arc<DaemonState>,
    client_id: &str,
    workspace_id: &str,
    terminal_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let key = terminal_key(client_id, workspace_id, terminal_id);
    let session = get_terminal_session(&state, &key).await?;
    let result = resize_terminal_session(session, cols, rows).await;
    if let Err(error) = &result {
        if is_terminal_closed_error(error) {
            let mut sessions = state.terminal_sessions.lock().await;
            sessions.remove(&key);
        }
    }
    result
}

/// 关闭浏览器终端会话。
///
/// `state`：共享 daemon 状态；`client_id`：浏览器客户端标识；`workspace_id`：工作区标识；
/// `terminal_id`：终端标识。
pub(crate) async fn close_web_terminal(
    state: Arc<DaemonState>,
    client_id: &str,
    workspace_id: &str,
    terminal_id: &str,
) -> Result<(), String> {
    let key = terminal_key(client_id, workspace_id, terminal_id);
    let mut sessions = state.terminal_sessions.lock().await;
    let session = sessions
        .remove(&key)
        .ok_or_else(|| "Terminal session not found".to_string())?;
    drop(sessions);
    close_terminal_session(session).await
}
