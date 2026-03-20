use super::super::*;
use super::HttpServerContext;
use axum::{
    Json,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::json;

pub(super) const WEB_SESSION_COOKIE_NAME: &str = "codex_monitor_web_session";

fn unauthorized_response(message: &str) -> Response {
    (StatusCode::UNAUTHORIZED, Json(json!({ "error": { "message": message } }))).into_response()
}

/// 从请求头中提取指定 cookie。
///
/// `headers`：HTTP 请求头；`name`：cookie 名称。
pub(super) fn get_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get(axum::http::header::COOKIE)?.to_str().ok()?;
    raw.split(';').find_map(|entry| {
        let (key, value) = entry.trim().split_once('=')?;
        if key.trim() != name {
            return None;
        }
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return None;
        }
        Some(trimmed.to_string())
    })
}

/// 生成登录成功后的会话 cookie。
///
/// `session_id`：新创建的 Web 会话标识。
pub(super) fn build_session_cookie(session_id: &str) -> String {
    format!(
        "{WEB_SESSION_COOKIE_NAME}={session_id}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}",
        super::super::WEB_SESSION_TTL_SECS
    )
}

/// 生成清理会话的过期 cookie。
///
/// 无入参，返回可直接写入 `Set-Cookie` 的 header 值。
pub(super) fn build_expired_session_cookie() -> String {
    format!(
        "{WEB_SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    )
}

/// 校验当前请求是否已经携带有效 Web 会话。
///
/// `context`：HTTP 服务上下文；`headers`：请求头。
pub(super) async fn require_session(
    context: &HttpServerContext,
    headers: &HeaderMap,
) -> Result<String, Response> {
    let Some(session_id) = get_cookie(headers, WEB_SESSION_COOKIE_NAME) else {
        return Err(unauthorized_response("session required"));
    };
    if context.state.has_web_session(&session_id).await {
        return Ok(session_id);
    }
    Err(unauthorized_response("session expired"))
}

/// 校验 Web 登录 token 是否正确。
///
/// `context`：HTTP 服务上下文；`provided_token`：登录页提交的 token。
pub(super) async fn verify_login_token(
    context: &HttpServerContext,
    provided_token: &str,
) -> Result<(), Response> {
    let provided = provided_token.trim();
    if provided.is_empty() {
        return Err(unauthorized_response("token required"));
    }
    let expected = context
        .state
        .web_login_token(context.config.token.as_deref())
        .await;
    let Some(expected) = expected else {
        return Err(
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": { "message": "remote backend token not configured" } })),
            )
                .into_response(),
        );
    };
    if expected == provided {
        return Ok(());
    }
    Err(unauthorized_response("invalid token"))
}
