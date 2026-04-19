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
    terminal_events: broadcast::Sender<terminal::WebTerminalEvent>,
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
/// `configured_dir`：命令行传入的静态目录；`daemon_binary_path`：当前守护进程二进制路径，用于推导开发目录和安装包资源目录。
pub(super) fn resolve_static_dir(
    configured_dir: Option<PathBuf>,
    daemon_binary_path: Option<&str>,
) -> Option<PathBuf> {
    let mut binary_paths = Vec::<PathBuf>::new();

    if let Ok(current_exe) = std::env::current_exe() {
        binary_paths.push(current_exe);
    }
    if let Some(binary_path) = daemon_binary_path {
        binary_paths.push(PathBuf::from(binary_path));
    }

    crate::shared::web_static_dir::resolve_web_static_dir(configured_dir, &binary_paths)
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
    let (terminal_events, _) = broadcast::channel::<terminal::WebTerminalEvent>(256);
    let context = HttpServerContext {
        state,
        config,
        events,
        terminal_events,
        static_dir,
    };
    let app: Router = routes::build_router(context);
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await
    .map_err(|error| format!("failed to serve web listener: {error}"))
}
