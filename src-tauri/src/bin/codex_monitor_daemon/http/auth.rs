use super::super::*;
use super::HttpServerContext;
use axum::{
    http::{header, HeaderMap, HeaderName, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

pub(super) const WEB_SESSION_COOKIE_NAME: &str = "codex_monitor_web_session";
const X_FORWARDED_PROTO: HeaderName = HeaderName::from_static("x-forwarded-proto");
const X_FORWARDED_FOR: HeaderName = HeaderName::from_static("x-forwarded-for");
const X_REAL_IP: HeaderName = HeaderName::from_static("x-real-ip");
const X_FORWARDED_SSL: HeaderName = HeaderName::from_static("x-forwarded-ssl");

fn unauthorized_response(message: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": { "message": message } })),
    )
        .into_response()
}

/// 构造来源校验失败响应。
///
/// `message`：返回给调用方的错误说明。
fn forbidden_response(message: &str) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "error": { "message": message } })),
    )
        .into_response()
}

/// 读取反代传递的原始请求协议。
///
/// `headers`：HTTP 请求头，优先读取 X-Forwarded-Proto，其次读取 Forwarded。
fn forwarded_proto(headers: &HeaderMap) -> Option<String> {
    headers
        .get(&X_FORWARDED_PROTO)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .or_else(|| {
            headers
                .get(header::FORWARDED)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| {
                    value.split(';').find_map(|part| {
                        let (key, value) = part.trim().split_once('=')?;
                        if !key.trim().eq_ignore_ascii_case("proto") {
                            return None;
                        }
                        let proto = value.trim().trim_matches('"');
                        if proto.is_empty() {
                            return None;
                        }
                        Some(proto.to_ascii_lowercase())
                    })
                })
        })
}

/// 返回当前请求应使用的外部访问协议。
///
/// `headers`：HTTP 请求头，用于判断反代外层是否为 HTTPS。
fn request_scheme(headers: &HeaderMap) -> &'static str {
    if request_is_secure(headers) {
        "https"
    } else {
        "http"
    }
}

/// 规范化 Host 或 Origin 中的主机部分。
///
/// `host`：待规范化的主机和端口文本。
fn normalize_host(host: &str) -> Option<String> {
    let trimmed = host.trim().trim_end_matches('.');
    if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') {
        return None;
    }
    Some(trimmed.to_ascii_lowercase())
}

/// 解析浏览器 Origin 头中的协议和主机。
///
/// `origin`：浏览器发送的 Origin 头值。
fn parse_origin(origin: &str) -> Option<(String, String)> {
    let trimmed = origin.trim();
    let (scheme, rest) = trimmed.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let host = rest.split('/').next().unwrap_or_default();
    normalize_host(host).map(|host| (scheme, host))
}

/// 读取设置中配置的公网 Web 入口 Origin。
///
/// `settings`：应用设置，可能包含 webAccessPublicBaseUrl。
fn configured_public_origin(settings: &AppSettings) -> Option<(String, String)> {
    settings
        .web_access_public_base_url
        .as_deref()
        .and_then(parse_origin)
}

/// 读取反代传递的真实客户端地址。
///
/// `headers`：HTTP 请求头，优先读取 X-Forwarded-For，其次读取 X-Real-IP。
fn trusted_forwarded_client(headers: &HeaderMap) -> Option<String> {
    headers
        .get(&X_FORWARDED_FOR)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            headers
                .get(&X_REAL_IP)
                .and_then(|value| value.to_str().ok())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

/// 判断远端地址是否来自本机或私有网络。
///
/// `addr`：TCP 连接远端地址。
fn is_loopback_or_private_addr(addr: &SocketAddr) -> bool {
    match addr.ip() {
        std::net::IpAddr::V4(ip) => ip.is_loopback() || ip.is_private(),
        std::net::IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local(),
    }
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
/// `session_id`：新创建的 Web 会话标识；`secure`：是否追加 Secure 属性。
pub(super) fn build_session_cookie(session_id: &str, secure: bool) -> String {
    let secure_suffix = if secure { "; Secure" } else { "" };
    format!(
        "{WEB_SESSION_COOKIE_NAME}={session_id}; HttpOnly; SameSite=Strict; Path=/; Max-Age={}{}",
        super::super::WEB_SESSION_TTL_SECS,
        secure_suffix
    )
}

/// 生成清理会话的过期 cookie。
///
/// `secure`：是否追加 Secure 属性，需与登录 cookie 的安全策略一致。
pub(super) fn build_expired_session_cookie(secure: bool) -> String {
    let secure_suffix = if secure { "; Secure" } else { "" };
    format!(
        "{WEB_SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0{secure_suffix}"
    )
}

/// 判断当前请求是否来自 HTTPS 反代链路。
///
/// `headers`：HTTP 请求头，用于读取反代注入的 Forwarded/X-Forwarded-* 信息。
pub(super) fn request_is_secure(headers: &HeaderMap) -> bool {
    forwarded_proto(headers)
        .as_deref()
        .is_some_and(|value| value.eq_ignore_ascii_case("https"))
        || headers
            .get(&X_FORWARDED_SSL)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.eq_ignore_ascii_case("on"))
}

/// 提取登录限速使用的客户端标识。
///
/// `headers`：HTTP 请求头；`remote_addr`：TCP 连接远端地址。
pub(super) fn login_client_key(headers: &HeaderMap, remote_addr: Option<SocketAddr>) -> String {
    if let Some(addr) = remote_addr.as_ref() {
        if !is_loopback_or_private_addr(addr) {
            return addr.ip().to_string();
        }
    }
    trusted_forwarded_client(headers)
        .or_else(|| remote_addr.map(|addr| addr.ip().to_string()))
        .unwrap_or_else(|| "unknown".to_string())
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

/// 校验请求来源是否与当前 Host 或配置的公网入口一致。
///
/// `context`：HTTP 服务上下文；`headers`：请求头，需包含浏览器发送的 Origin。
pub(super) async fn require_trusted_origin(
    context: &HttpServerContext,
    headers: &HeaderMap,
) -> Result<(), Response> {
    let Some(origin) = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    else {
        return Ok(());
    };
    let Some(origin) = parse_origin(origin) else {
        return Err(forbidden_response("invalid origin"));
    };
    let request_host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .and_then(normalize_host);
    let request_origin = request_host.map(|host| (request_scheme(headers).to_string(), host));
    if request_origin
        .as_ref()
        .is_some_and(|expected| expected == &origin)
    {
        return Ok(());
    }

    let settings = context.state.get_app_settings().await;
    if configured_public_origin(&settings)
        .as_ref()
        .is_some_and(|expected| expected == &origin)
    {
        return Ok(());
    }
    Err(forbidden_response("untrusted origin"))
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
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": { "message": "remote backend token not configured" } })),
        )
            .into_response());
    };
    if expected == provided {
        return Ok(());
    }
    Err(unauthorized_response("invalid token"))
}
