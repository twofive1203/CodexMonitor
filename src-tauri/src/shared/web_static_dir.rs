use std::path::{Path, PathBuf};

const BUNDLED_WEB_STATIC_DIR: &str = "web-dist";
const LEGACY_RESOURCE_UP_DIR: &str = "_up_";

/// 解析 Web 前端静态资源目录。
///
/// 作者：lichong
///
/// `configured_dir`：外部显式传入的静态目录，优先级最高。
/// `binary_paths`：当前运行涉及的二进制路径列表，用于反推安装目录和资源目录。
pub(crate) fn resolve_web_static_dir(
    configured_dir: Option<PathBuf>,
    binary_paths: &[PathBuf],
) -> Option<PathBuf> {
    let current_dir = std::env::current_dir().ok();
    resolve_web_static_dir_with_current_dir(configured_dir, current_dir, binary_paths)
}

/// 在指定工作目录上下文中解析 Web 前端静态资源目录。
///
/// `configured_dir`：外部显式传入的静态目录，优先级最高。
/// `current_dir`：当前工作目录，测试时可传入固定值避免依赖进程环境。
/// `binary_paths`：当前运行涉及的二进制路径列表，用于反推安装目录和资源目录。
fn resolve_web_static_dir_with_current_dir(
    configured_dir: Option<PathBuf>,
    current_dir: Option<PathBuf>,
    binary_paths: &[PathBuf],
) -> Option<PathBuf> {
    let mut candidates = Vec::<PathBuf>::new();

    if let Some(path) = configured_dir {
        push_candidate(&mut candidates, path);
    }

    if let Some(dir) = current_dir {
        push_standard_candidates(&mut candidates, &dir);
    }

    for binary_path in binary_paths {
        push_binary_candidates(&mut candidates, binary_path);
    }

    candidates.into_iter().find(|path| is_web_static_dir(path))
}

/// 向候选列表中追加基于二进制路径的常见静态目录。
///
/// `candidates`：待填充的候选目录集合。
/// `binary_path`：当前桌面端或 daemon 的二进制文件绝对路径。
fn push_binary_candidates(candidates: &mut Vec<PathBuf>, binary_path: &Path) {
    for ancestor in binary_path.ancestors().skip(1).take(6) {
        push_standard_candidates(candidates, ancestor);
    }
}

/// 向候选列表中追加基于根目录的常见静态目录。
///
/// `candidates`：待填充的候选目录集合。
/// `root`：安装目录、资源目录或工作目录根路径。
fn push_standard_candidates(candidates: &mut Vec<PathBuf>, root: &Path) {
    push_candidate(candidates, root.join("dist"));
    push_candidate(candidates, root.join(BUNDLED_WEB_STATIC_DIR));
    push_candidate(
        candidates,
        root.join("resources").join(BUNDLED_WEB_STATIC_DIR),
    );
    push_candidate(
        candidates,
        root.join("Resources").join(BUNDLED_WEB_STATIC_DIR),
    );
    push_candidate(
        candidates,
        root.join("resources")
            .join(LEGACY_RESOURCE_UP_DIR)
            .join("dist"),
    );
    push_candidate(
        candidates,
        root.join("Resources")
            .join(LEGACY_RESOURCE_UP_DIR)
            .join("dist"),
    );
}

/// 向候选列表追加唯一目录，避免重复探测。
///
/// `candidates`：待填充的候选目录集合。
/// `path`：需要加入的候选目录。
fn push_candidate(candidates: &mut Vec<PathBuf>, path: PathBuf) {
    if !candidates.iter().any(|entry| entry == &path) {
        candidates.push(path);
    }
}

/// 判断目录是否为可用的 Web 前端静态目录。
///
/// `path`：待校验的目录路径。
fn is_web_static_dir(path: &Path) -> bool {
    path.is_dir() && path.join("index.html").is_file()
}

#[cfg(test)]
mod tests {
    use super::resolve_web_static_dir_with_current_dir;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// 创建测试专用临时目录。
    ///
    /// `prefix`：临时目录名前缀，便于排查失败现场。
    fn make_temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "codex-monitor-{prefix}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn prefers_explicit_configured_static_dir() {
        let tmp = make_temp_dir("web-static-configured");
        let static_dir = tmp.join("explicit-static");
        std::fs::create_dir_all(&static_dir).expect("create explicit static dir");
        std::fs::write(static_dir.join("index.html"), "<html></html>").expect("write index");

        let result = resolve_web_static_dir_with_current_dir(
            Some(static_dir.clone()),
            Some(tmp.join("cwd-without-dist")),
            &[],
        );

        assert_eq!(result, Some(static_dir));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn resolves_bundled_web_dist_from_resources_dir() {
        let tmp = make_temp_dir("web-static-resources");
        let install_dir = tmp.join("install");
        let binary_path = install_dir.join("codex-monitor.exe");
        let static_dir = install_dir.join("resources").join("web-dist");

        std::fs::create_dir_all(&static_dir).expect("create bundled static dir");
        std::fs::write(static_dir.join("index.html"), "<html></html>").expect("write index");

        let result = resolve_web_static_dir_with_current_dir(
            None,
            Some(tmp.join("cwd-without-dist")),
            &[binary_path],
        );

        assert_eq!(result, Some(static_dir));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn resolves_bundled_web_dist_next_to_binary() {
        let tmp = make_temp_dir("web-static-sibling");
        let install_dir = tmp.join("install");
        let binary_path = install_dir.join("codex-monitor.exe");
        let static_dir = install_dir.join("web-dist");

        std::fs::create_dir_all(&static_dir).expect("create bundled sibling static dir");
        std::fs::write(static_dir.join("index.html"), "<html></html>").expect("write index");

        let result = resolve_web_static_dir_with_current_dir(
            None,
            Some(tmp.join("cwd-without-dist")),
            &[binary_path],
        );

        assert_eq!(result, Some(static_dir));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
