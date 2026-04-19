use super::super::*;
use super::auth::{require_session, require_trusted_origin};
use super::HttpServerContext;
use crate::rpc::build_event_notification;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub(super) struct TerminalSocketQuery {
    #[serde(rename = "clientId")]
    client_id: String,
}

fn parse_terminal_string(params: &Value, key: &str) -> Result<String, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("missing or invalid `{key}`"))
}

fn parse_terminal_u16(params: &Value, key: &str) -> Result<u16, String> {
    let value = params
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("missing or invalid `{key}`"))?;
    u16::try_from(value).map_err(|_| format!("invalid `{key}`"))
}

fn build_ws_error(id: Option<u64>, message: &str) -> Option<String> {
    let id = id?;
    serde_json::to_string(&json!({
        "id": id,
        "error": {
            "message": message,
        },
    }))
    .ok()
}

fn build_ws_result(id: Option<u64>, result: Value) -> Option<String> {
    let id = id?;
    serde_json::to_string(&json!({
        "id": id,
        "result": result,
    }))
    .ok()
}

async fn handle_terminal_request(
    context: &HttpServerContext,
    client_id: &str,
    id: Option<u64>,
    method: &str,
    params: Value,
) -> Option<String> {
    let state = Arc::clone(&context.state);
    let response = match method {
        "terminal_open" => {
            let workspace_id = parse_terminal_string(&params, "workspaceId");
            let terminal_id = parse_terminal_string(&params, "terminalId");
            let cols = parse_terminal_u16(&params, "cols");
            let rows = parse_terminal_u16(&params, "rows");
            match (workspace_id, terminal_id, cols, rows) {
                (Ok(workspace_id), Ok(terminal_id), Ok(cols), Ok(rows)) => {
                    terminal::open_web_terminal(
                        state,
                        client_id.to_string(),
                        workspace_id,
                        terminal_id,
                        cols,
                        rows,
                        context.terminal_events.clone(),
                    )
                    .await
                }
                (Err(message), _, _, _)
                | (_, Err(message), _, _)
                | (_, _, Err(message), _)
                | (_, _, _, Err(message)) => Err(message),
            }
        }
        "terminal_write" => {
            let workspace_id = parse_terminal_string(&params, "workspaceId");
            let terminal_id = parse_terminal_string(&params, "terminalId");
            let data = parse_terminal_string(&params, "data");
            match (workspace_id, terminal_id, data) {
                (Ok(workspace_id), Ok(terminal_id), Ok(data)) => terminal::write_web_terminal(
                    state,
                    client_id,
                    &workspace_id,
                    &terminal_id,
                    data,
                )
                .await
                .map(|_| Value::Null),
                (Err(message), _, _) | (_, Err(message), _) | (_, _, Err(message)) => Err(message),
            }
        }
        "terminal_resize" => {
            let workspace_id = parse_terminal_string(&params, "workspaceId");
            let terminal_id = parse_terminal_string(&params, "terminalId");
            let cols = parse_terminal_u16(&params, "cols");
            let rows = parse_terminal_u16(&params, "rows");
            match (workspace_id, terminal_id, cols, rows) {
                (Ok(workspace_id), Ok(terminal_id), Ok(cols), Ok(rows)) => {
                    terminal::resize_web_terminal(
                        state,
                        client_id,
                        &workspace_id,
                        &terminal_id,
                        cols,
                        rows,
                    )
                    .await
                    .map(|_| Value::Null)
                }
                (Err(message), _, _, _)
                | (_, Err(message), _, _)
                | (_, _, Err(message), _)
                | (_, _, _, Err(message)) => Err(message),
            }
        }
        "terminal_close" => {
            let workspace_id = parse_terminal_string(&params, "workspaceId");
            let terminal_id = parse_terminal_string(&params, "terminalId");
            match (workspace_id, terminal_id) {
                (Ok(workspace_id), Ok(terminal_id)) => {
                    terminal::close_web_terminal(state, client_id, &workspace_id, &terminal_id)
                        .await
                        .map(|_| Value::Null)
                }
                (Err(message), _) | (_, Err(message)) => Err(message),
            }
        }
        _ => Err(format!("unknown method: {method}")),
    };

    match response {
        Ok(result) => build_ws_result(id, result),
        Err(message) => build_ws_error(id, &message),
    }
}

/// 处理 Web 端事件 WebSocket 握手。
///
/// `context`：HTTP 服务上下文；`headers`：请求头；`ws`：WebSocket upgrade 句柄。
pub(super) async fn events(
    State(context): State<HttpServerContext>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if let Err(response) = require_trusted_origin(&context, &headers).await {
        return response;
    }
    if let Err(response) = require_session(&context, &headers).await {
        return response;
    }
    let rx = context.events.subscribe();
    ws.on_upgrade(move |socket| handle_events_socket(socket, rx))
}

/// 处理浏览器终端 WebSocket 握手。
///
/// `context`：HTTP 服务上下文；`headers`：请求头；`query`：查询参数；
/// `ws`：WebSocket upgrade 句柄。
pub(super) async fn terminal(
    State(context): State<HttpServerContext>,
    headers: HeaderMap,
    Query(query): Query<TerminalSocketQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    if let Err(response) = require_trusted_origin(&context, &headers).await {
        return response;
    }
    if let Err(response) = require_session(&context, &headers).await {
        return response;
    }
    if query.client_id.trim().is_empty() {
        return axum::http::StatusCode::BAD_REQUEST.into_response();
    }
    let client_id = query.client_id.trim().to_string();
    let terminal_rx = context.terminal_events.subscribe();
    ws.on_upgrade(move |socket| handle_terminal_socket(socket, context, client_id, terminal_rx))
}

/// 转发 daemon 事件到浏览器事件 WS。
///
/// `socket`：升级后的 WebSocket；`rx`：daemon 事件广播订阅。
async fn handle_events_socket(mut socket: WebSocket, mut rx: broadcast::Receiver<DaemonEvent>) {
    loop {
        tokio::select! {
            maybe_message = socket.next() => {
                match maybe_message {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
            event = rx.recv() => {
                let Ok(event) = event else {
                    break;
                };
                let Some(payload) = build_event_notification(event) else {
                    continue;
                };
                if socket.send(Message::Text(payload.into())).await.is_err() {
                    break;
                }
            }
        }
    }
}

/// 处理浏览器终端 WS 收发。
///
/// `socket`：升级后的 WebSocket；`context`：HTTP 服务上下文；`client_id`：客户端标识；
/// `terminal_rx`：终端事件广播订阅。
async fn handle_terminal_socket(
    mut socket: WebSocket,
    context: HttpServerContext,
    client_id: String,
    mut terminal_rx: broadcast::Receiver<terminal::WebTerminalEvent>,
) {
    loop {
        tokio::select! {
            maybe_message = socket.next() => {
                let Some(message) = maybe_message else {
                    break;
                };
                match message {
                    Ok(Message::Close(_)) => break,
                    Ok(Message::Text(payload)) => {
                        let Ok(value) = serde_json::from_str::<Value>(&payload) else {
                            continue;
                        };
                        let id = value.get("id").and_then(Value::as_u64);
                        let method = value
                            .get("method")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        if method.is_empty() {
                            if let Some(error) = build_ws_error(id, "method required") {
                                if socket.send(Message::Text(error.into())).await.is_err() {
                                    break;
                                }
                            }
                            continue;
                        }
                        let params = value.get("params").cloned().unwrap_or(Value::Null);
                        if let Some(response) =
                            handle_terminal_request(&context, &client_id, id, &method, params).await
                        {
                            if socket.send(Message::Text(response.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Ok(Message::Binary(_)) | Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
                    Err(_) => break,
                }
            }
            event = terminal_rx.recv() => {
                let Ok(event) = event else {
                    break;
                };
                if event.client_id() != client_id {
                    continue;
                }
                let Some(payload) = event.encode() else {
                    continue;
                };
                if socket.send(Message::Text(payload.into())).await.is_err() {
                    break;
                }
            }
        }
    }
}
