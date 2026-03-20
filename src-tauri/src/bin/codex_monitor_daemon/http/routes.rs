use super::auth::{
    build_expired_session_cookie, build_session_cookie, get_cookie, require_session,
    verify_login_token, WEB_SESSION_COOKIE_NAME,
};
use super::ws;
use super::HttpServerContext;
use crate::types::BackendMode;
use axum::{
    extract::{Request, State},
    http::{header::SET_COOKIE, HeaderMap, HeaderValue, StatusCode, Uri},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::services::ServeDir;

#[derive(Deserialize)]
struct LoginRequest {
    token: String,
}

#[derive(Deserialize)]
struct RpcRequest {
    method: String,
    #[serde(default)]
    params: Value,
}

fn json_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": { "message": message } }))).into_response()
}

fn web_capabilities() -> Value {
    json!({
        "runtime": "web",
        "tray": false,
        "nativeWindowControls": false,
        "updater": false,
        "dictation": false,
        "revealInDir": false,
        "openAppIcon": false,
        "terminal": true,
    })
}

async fn healthz(State(context): State<HttpServerContext>) -> impl IntoResponse {
    let tcp_listen_addr = context.config.listen.to_string();
    let web_listen_addr = context.config.web_listen.map(|addr| addr.to_string());
    Json(json!({
        "status": "ok",
        "app": {
            "name": super::super::DAEMON_NAME,
            "version": env!("CARGO_PKG_VERSION"),
            "pid": std::process::id(),
        },
        "tcp": {
            "enabled": true,
            "listenAddr": tcp_listen_addr,
        },
        "web": {
            "enabled": context.config.web_listen.is_some(),
            "listenAddr": web_listen_addr,
            "staticDir": context.static_dir.as_ref().map(|path| path.to_string_lossy().to_string()),
        }
    }))
}

async fn login(
    State(context): State<HttpServerContext>,
    Json(payload): Json<LoginRequest>,
) -> Response {
    if let Err(response) = verify_login_token(&context, &payload.token).await {
        return response;
    }
    let session_id = context.state.create_web_session().await;
    let cookie = build_session_cookie(&session_id);
    let mut response = Json(json!({ "ok": true })).into_response();
    if let Ok(header_value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(SET_COOKIE, header_value);
    }
    response
}

async fn logout(State(context): State<HttpServerContext>, headers: HeaderMap) -> Response {
    if let Some(session_id) = get_cookie(&headers, WEB_SESSION_COOKIE_NAME) {
        context.state.invalidate_web_session(&session_id).await;
    }
    let mut response = Json(json!({ "ok": true })).into_response();
    if let Ok(header_value) = HeaderValue::from_str(&build_expired_session_cookie()) {
        response.headers_mut().insert(SET_COOKIE, header_value);
    }
    response
}

async fn bootstrap(State(context): State<HttpServerContext>, headers: HeaderMap) -> Response {
    if let Err(response) = require_session(&context, &headers).await {
        return response;
    }
    let mut settings = context.state.get_app_settings().await;
    settings.backend_mode = BackendMode::Remote;
    let workspaces = context.state.list_workspaces().await;
    Json(json!({
        "app": {
            "name": super::super::DAEMON_NAME,
            "version": env!("CARGO_PKG_VERSION"),
        },
        "capabilities": web_capabilities(),
        "settings": settings,
        "workspaces": workspaces,
    }))
    .into_response()
}

async fn rpc(
    State(context): State<HttpServerContext>,
    headers: HeaderMap,
    Json(payload): Json<RpcRequest>,
) -> Response {
    if let Err(response) = require_session(&context, &headers).await {
        return response;
    }
    let method = payload.method.trim();
    if method.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "method required");
    }
    match super::super::rpc::handle_rpc_request(
        &context.state,
        method,
        payload.params,
        format!("web-{}", env!("CARGO_PKG_VERSION")),
    )
    .await
    {
        Ok(result) => Json(json!({ "result": result })).into_response(),
        Err(message) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": { "message": message } })),
        )
            .into_response(),
    }
}

async fn index(State(context): State<HttpServerContext>) -> Response {
    match read_index_html(&context).await {
        Ok(Some(html)) => Html(html).into_response(),
        Ok(None) => Html(
            "<!doctype html><html><body><h1>CodexMonitor Web</h1><p>未找到前端静态资源，请通过 --web-static-dir 指定目录。</p></body></html>"
                .to_string(),
        )
        .into_response(),
        Err(message) => json_error(StatusCode::INTERNAL_SERVER_ERROR, &message),
    }
}

async fn fallback(
    State(context): State<HttpServerContext>,
    uri: Uri,
    _request: Request,
) -> Response {
    let path = uri.path();
    if path.starts_with("/api/") || path == "/healthz" || path.starts_with("/assets/") {
        return json_error(StatusCode::NOT_FOUND, "not found");
    }
    index(State(context)).await
}

/// 读取前端入口 HTML。
///
/// `context`：HTTP 服务上下文，用于解析静态目录。
async fn read_index_html(context: &HttpServerContext) -> Result<Option<String>, String> {
    let Some(index_file) = context.index_file() else {
        return Ok(None);
    };
    tokio::fs::read_to_string(&index_file)
        .await
        .map(Some)
        .map_err(|error| format!("failed to read {}: {error}", index_file.display()))
}

/// 构建 daemon Web 路由表。
///
/// `context`：HTTP 服务上下文，包含共享状态、配置和事件广播。
pub(super) fn build_router(context: HttpServerContext) -> Router {
    let mut router = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/session/login", post(login))
        .route("/api/session/logout", post(logout))
        .route("/api/bootstrap", get(bootstrap))
        .route("/api/rpc", post(rpc))
        .route("/api/ws/events", get(ws::events))
        .route("/api/ws/terminal", get(ws::terminal))
        .route("/", get(index))
        .fallback(get(fallback))
        .with_state(context.clone());

    if let Some(assets_dir) = context.assets_dir() {
        if assets_dir.is_dir() {
            router = router.nest_service("/assets", ServeDir::new(assets_dir));
        }
    }

    router
}
