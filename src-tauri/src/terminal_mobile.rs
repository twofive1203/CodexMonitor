use serde::Serialize;
use tauri::{AppHandle, State};

use crate::state::AppState;

const UNSUPPORTED_MESSAGE: &str = "移动端构建不支持终端。";

pub(crate) struct TerminalSession {
    pub(crate) id: String,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct TerminalSessionInfo {
    id: String,
}

#[tauri::command]
pub(crate) async fn terminal_open(
    _workspace_id: String,
    terminal_id: String,
    _cols: u16,
    _rows: u16,
    _state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<TerminalSessionInfo, String> {
    if terminal_id.trim().is_empty() {
        return Err("终端 ID 不能为空。".to_string());
    }
    Err(UNSUPPORTED_MESSAGE.to_string())
}

#[tauri::command]
pub(crate) async fn terminal_write(
    _workspace_id: String,
    _terminal_id: String,
    _data: String,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    Err(UNSUPPORTED_MESSAGE.to_string())
}

#[tauri::command]
pub(crate) async fn terminal_resize(
    _workspace_id: String,
    _terminal_id: String,
    _cols: u16,
    _rows: u16,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    Err(UNSUPPORTED_MESSAGE.to_string())
}

#[tauri::command]
pub(crate) async fn terminal_close(
    _workspace_id: String,
    _terminal_id: String,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    Err(UNSUPPORTED_MESSAGE.to_string())
}
