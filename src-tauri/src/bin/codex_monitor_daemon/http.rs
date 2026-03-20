use super::*;
use axum::Router;
use tokio::net::TcpListener;

#[path = "http/auth.rs"]
mod auth;
#[path = "http/routes.rs"]
mod routes;
#[path = "http/ws.rs"]
mod ws;

#[derive(Clone)]
struct HttpServerContext {
    state: Arc<DaemonState>,
    config: Arc<DaemonConfig>,
    events: broadcast::Sender<DaemonEvent>,
    static_dir: Option<PathBuf>,
}

impl HttpServerContext {
    /// 返回前端 `index.html` 的绝对路径。
    ///
    /// 无入参；若当前未解析出静态目录则返回 `None`。
    fn index_file(&self) -> Option<PathBuf> {
        self.static_dir.as_ref().map(|dir| dir.join("index.html"))
    }

    /// 返回前端 `assets` 目录的绝对路径。
    ///
    /// 无入参；若当前未解析出静态目录则返回 `None`。
    fn assets_dir(&self) -> Option<PathBuf> {
        self.static_dir.as_ref().map(|dir| dir.join("assets"))
    }
}

/// 解析 Web 静态资源目录。
///
/// `configured_dir`：命令行传入的静态目录；`daemon_binary_path`：当前守护进程二进制路径，用于推导相邻 `dist` 目录。
pub(super) fn resolve_static_dir(
    configured_dir: Option<PathBuf>,
    daemon_binary_path: Option<&str>,
) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = configured_dir {
        candidates.push(path);
    }
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("dist"));
    }
    if let Some(binary_path) = daemon_binary_path {
        let binary = PathBuf::from(binary_path);
        if let Some(parent) = binary.parent() {
            candidates.push(parent.join("dist"));
        }
    }

    candidates.into_iter().find_map(|path| {
        let index_file = path.join("index.html");
        if path.is_dir() && index_file.is_file() {
            Some(path)
        } else {
            None
        }
    })
}

/// 启动 daemon 的 Web HTTP/WS 服务。
///
/// `listener`：已绑定的 Web 监听器；`state`：共享 daemon 状态；`config`：启动配置；`events`：事件广播通道；`static_dir`：前端静态目录。
pub(super) async fn serve(
    listener: TcpListener,
    state: Arc<DaemonState>,
    config: Arc<DaemonConfig>,
    events: broadcast::Sender<DaemonEvent>,
    static_dir: Option<PathBuf>,
) -> Result<(), String> {
    let context = HttpServerContext {
        state,
        config,
        events,
        static_dir,
    };
    let app: Router = routes::build_router(context);
    axum::serve(listener, app)
        .await
        .map_err(|error| format!("failed to serve web listener: {error}"))
}
