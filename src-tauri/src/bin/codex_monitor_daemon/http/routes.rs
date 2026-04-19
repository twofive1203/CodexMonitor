use super::auth::{
    build_expired_session_cookie, build_session_cookie, get_cookie, login_client_key,
    request_is_secure, require_session, require_trusted_origin, verify_login_token,
    WEB_SESSION_COOKIE_NAME,
};
use super::ws;
use super::HttpServerContext;
use crate::types::BackendMode;
use axum::{
    extract::{ConnectInfo, Request, State},
    http::{
        header::{RETRY_AFTER, SET_COOKIE},
        HeaderMap, HeaderName, HeaderValue, StatusCode, Uri,
    },
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::net::SocketAddr;
use tower_http::services::ServeDir;

const CONTENT_SECURITY_POLICY: HeaderName = HeaderName::from_static("content-security-policy");
const REFERRER_POLICY: HeaderName = HeaderName::from_static("referrer-policy");
const X_CONTENT_TYPE_OPTIONS: HeaderName = HeaderName::from_static("x-content-type-options");
const X_FRAME_OPTIONS: HeaderName = HeaderName::from_static("x-frame-options");
const PERMISSIONS_POLICY: HeaderName = HeaderName::from_static("permissions-policy");

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

/// 构造登录限速响应。
///
/// `retry_after_secs`：建议客户端等待后重试的秒数。
fn rate_limit_error(retry_after_secs: u64) -> Response {
    let mut response = (
        StatusCode::TOO_MANY_REQUESTS,
        Json(json!({
            "error": {
                "message": "too many login attempts",
                "retryAfterSeconds": retry_after_secs,
            }
        })),
    )
        .into_response();
    if let Ok(value) = HeaderValue::from_str(&retry_after_secs.to_string()) {
        response.headers_mut().insert(RETRY_AFTER, value);
    }
    response
}

/// 为 Web 响应追加浏览器安全头。
///
/// `response`：业务处理生成的原始响应。
fn with_security_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    headers.insert(
        PERMISSIONS_POLICY,
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    headers.insert(
        CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
        ),
    );
    response
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
    let web_enabled = context.config.web_listen.is_some();
    with_security_headers(
        Json(json!({
            "status": "ok",
            "app": {
                "name": super::super::DAEMON_NAME,
            },
            "tcp": {
                "enabled": true,
            },
            "web": {
                "enabled": web_enabled,
            }
        }))
        .into_response(),
    )
}

async fn login(
    State(context): State<HttpServerContext>,
    ConnectInfo(remote_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> Response {
    if let Err(response) = require_trusted_origin(&context, &headers).await {
        return with_security_headers(response);
    }

    let client_key = login_client_key(&headers, Some(remote_addr));
    if let Err(retry_after_secs) = context.state.check_web_login_rate_limit(&client_key).await {
        return with_security_headers(rate_limit_error(retry_after_secs));
    }

    if let Err(response) = verify_login_token(&context, &payload.token).await {
        if response.status() == StatusCode::UNAUTHORIZED {
            context.state.record_web_login_failure(&client_key).await;
        }
        return with_security_headers(response);
    }
    context.state.clear_web_login_failures(&client_key).await;
    let session_id = context.state.create_web_session().await;
    let cookie = build_session_cookie(&session_id, request_is_secure(&headers));
    let mut response = Json(json!({ "ok": true })).into_response();
    if let Ok(header_value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(SET_COOKIE, header_value);
    }
    with_security_headers(response)
}

async fn logout(State(context): State<HttpServerContext>, headers: HeaderMap) -> Response {
    if let Err(response) = require_trusted_origin(&context, &headers).await {
        return with_security_headers(response);
    }
    if let Some(session_id) = get_cookie(&headers, WEB_SESSION_COOKIE_NAME) {
        context.state.invalidate_web_session(&session_id).await;
    }
    let mut response = Json(json!({ "ok": true })).into_response();
    if let Ok(header_value) =
        HeaderValue::from_str(&build_expired_session_cookie(request_is_secure(&headers)))
    {
        response.headers_mut().insert(SET_COOKIE, header_value);
    }
    with_security_headers(response)
}

async fn bootstrap(State(context): State<HttpServerContext>, headers: HeaderMap) -> Response {
    if let Err(response) = require_session(&context, &headers).await {
        return with_security_headers(response);
    }
    let mut settings =
        DaemonState::sanitize_web_app_settings(context.state.get_app_settings().await);
    settings.backend_mode = BackendMode::Remote;
    let workspaces = context.state.list_workspaces().await;
    with_security_headers(
        Json(json!({
            "app": {
                "name": super::super::DAEMON_NAME,
                "version": env!("CARGO_PKG_VERSION"),
            },
            "capabilities": web_capabilities(),
            "settings": settings,
            "workspaces": workspaces,
        }))
        .into_response(),
    )
}

async fn rpc(
    State(context): State<HttpServerContext>,
    headers: HeaderMap,
    Json(payload): Json<RpcRequest>,
) -> Response {
    if let Err(response) = require_trusted_origin(&context, &headers).await {
        return with_security_headers(response);
    }
    if let Err(response) = require_session(&context, &headers).await {
        return with_security_headers(response);
    }
    let method = payload.method.trim();
    if method.is_empty() {
        return with_security_headers(json_error(StatusCode::BAD_REQUEST, "method required"));
    }
    let response = match super::super::rpc::handle_rpc_request(
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
    };
    with_security_headers(response)
}

async fn index(State(context): State<HttpServerContext>) -> Response {
    let response = match read_index_html(&context).await {
        Ok(Some(html)) => Html(html).into_response(),
        Ok(None) => Html(
            "<!doctype html><html><body><h1>CodexMonitor Web</h1><p>未找到前端静态资源，请通过 --web-static-dir 指定目录。</p></body></html>"
                .to_string(),
        )
        .into_response(),
        Err(message) => json_error(StatusCode::INTERNAL_SERVER_ERROR, &message),
    };
    with_security_headers(response)
}

async fn fallback(
    State(context): State<HttpServerContext>,
    uri: Uri,
    _request: Request,
) -> Response {
    let path = uri.path();
    if path.starts_with("/api/") || path == "/healthz" || path.starts_with("/assets/") {
        return with_security_headers(json_error(StatusCode::NOT_FOUND, "not found"));
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
