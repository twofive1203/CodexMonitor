use super::HttpServerContext;
use super::auth::require_session;
use super::super::*;
use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::HeaderMap,
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;

fn encode_event(event: DaemonEvent) -> Option<String> {
    let payload = match event {
        DaemonEvent::AppServer(payload) => json!({
            "method": "app-server-event",
            "params": payload,
        }),
        DaemonEvent::TerminalOutput(payload) => json!({
            "method": "terminal-output",
            "params": payload,
        }),
        DaemonEvent::TerminalExit(payload) => json!({
            "method": "terminal-exit",
            "params": payload,
        }),
    };
    serde_json::to_string(&payload).ok()
}

/// 处理 Web 端事件 WebSocket 握手。
///
/// `context`：HTTP 服务上下文；`headers`：请求头；`ws`：WebSocket upgrade 句柄。
pub(super) async fn events(
    State(context): State<HttpServerContext>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if let Err(response) = require_session(&context, &headers).await {
        return response;
    }
    let rx = context.events.subscribe();
    ws.on_upgrade(move |socket| handle_events_socket(socket, rx))
}

/// 转发 daemon 事件到浏览器 WebSocket。
///
/// `socket`：升级后的 WebSocket；`rx`：daemon 事件广播订阅。
async fn handle_events_socket(
    mut socket: WebSocket,
    mut rx: broadcast::Receiver<DaemonEvent>,
) {
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
                let Some(payload) = encode_event(event) else {
                    continue;
                };
                if socket.send(Message::Text(payload.into())).await.is_err() {
                    break;
                }
            }
        }
    }
}
