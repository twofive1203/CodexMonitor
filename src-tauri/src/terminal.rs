use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::event_sink::TauriEventSink;
use crate::shared::terminal_core::{
    close_terminal_session, is_terminal_closed_error, open_terminal_session,
    resize_terminal_session, spawn_terminal_reader, write_terminal_session, TerminalCleanup,
    TerminalSession,
};
use crate::state::AppState;

#[derive(Debug, Serialize, Clone)]
pub(crate) struct TerminalSessionInfo {
    id: String,
}

fn terminal_key(workspace_id: &str, terminal_id: &str) -> String {
    format!("{workspace_id}:{terminal_id}")
}

async fn get_terminal_session(
    state: &State<'_, AppState>,
    key: &str,
) -> Result<Arc<TerminalSession>, String> {
    let sessions = state.terminal_sessions.lock().await;
    sessions
        .get(key)
        .cloned()
        .ok_or_else(|| "终端会话不存在。".to_string())
}

async fn get_workspace_path(
    workspace_id: &str,
    state: &State<'_, AppState>,
) -> Result<PathBuf, String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| "未知工作区。".to_string())?;
    Ok(PathBuf::from(&entry.path))
}

/// 打开桌面端终端会话。
///
/// `workspace_id`：目标工作区；`terminal_id`：终端标识；`cols`：初始列数；
/// `rows`：初始行数；`state`：应用状态；`app`：Tauri 应用句柄。
#[tauri::command]
pub(crate) async fn terminal_open(
    workspace_id: String,
    terminal_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<TerminalSessionInfo, String> {
    if terminal_id.is_empty() {
        return Err("终端标识不能为空。".to_string());
    }

    let key = terminal_key(&workspace_id, &terminal_id);
    {
        let sessions = state.terminal_sessions.lock().await;
        if let Some(existing) = sessions.get(&key) {
            return Ok(TerminalSessionInfo {
                id: existing.id.clone(),
            });
        }
    }

    let cwd = get_workspace_path(&workspace_id, &state).await?;
    let (session, reader) = open_terminal_session(cwd, terminal_id.clone(), cols, rows)?;
    let session_id = session.id.clone();

    {
        let mut sessions = state.terminal_sessions.lock().await;
        if let Some(existing) = sessions.get(&key) {
            let id = existing.id.clone();
            drop(sessions);
            close_terminal_session(session).await?;
            return Ok(TerminalSessionInfo { id });
        }
        sessions.insert(key.clone(), Arc::clone(&session));
    }

    let cleanup_app = app.clone();
    let cleanup_key = key.clone();
    let cleanup: TerminalCleanup = Arc::new(move |_, _, session| {
        let app = cleanup_app.clone();
        let key = cleanup_key.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<AppState>();
            let mut sessions = state.terminal_sessions.lock().await;
            let should_remove = sessions
                .get(&key)
                .is_some_and(|current| Arc::ptr_eq(current, &session));
            if should_remove {
                sessions.remove(&key);
            }
        });
    });

    spawn_terminal_reader(
        TauriEventSink::new(app),
        session,
        workspace_id,
        terminal_id,
        reader,
        cleanup,
    );
    Ok(TerminalSessionInfo { id: session_id })
}

/// 向桌面端终端写入输入数据。
///
/// `workspace_id`：工作区标识；`terminal_id`：终端标识；`data`：待写入内容；
/// `state`：应用状态。
#[tauri::command]
pub(crate) async fn terminal_write(
    workspace_id: String,
    terminal_id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = terminal_key(&workspace_id, &terminal_id);
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

/// 调整桌面端终端窗口大小。
///
/// `workspace_id`：工作区标识；`terminal_id`：终端标识；`cols`：列数；
/// `rows`：行数；`state`：应用状态。
#[tauri::command]
pub(crate) async fn terminal_resize(
    workspace_id: String,
    terminal_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = terminal_key(&workspace_id, &terminal_id);
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

/// 关闭桌面端终端会话。
///
/// `workspace_id`：工作区标识；`terminal_id`：终端标识；`state`：应用状态。
#[tauri::command]
pub(crate) async fn terminal_close(
    workspace_id: String,
    terminal_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = terminal_key(&workspace_id, &terminal_id);
    let mut sessions = state.terminal_sessions.lock().await;
    let session = sessions
        .remove(&key)
        .ok_or_else(|| "终端会话不存在。".to_string())?;
    drop(sessions);
    close_terminal_session(session).await
}
