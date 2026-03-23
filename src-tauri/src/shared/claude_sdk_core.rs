#![allow(dead_code)]

use serde_json::Value;
use std::path::{Path, PathBuf};

use crate::types::{ClaudeSdkSource, ClaudeSdkState, ClaudeSdkStatus};

/// Claude SDK 在应用数据目录中的固定目录名。
pub(crate) const CLAUDE_SDK_DIR_NAME: &str = "claude-agent-sdk";
const CLAUDE_SDK_PACKAGE_NAME: &str = "@anthropic-ai/claude-agent-sdk";
const ROOT_PACKAGE_JSON: &str = include_str!("../../../package.json");

/// 计算 Claude SDK 在应用数据目录中的目标路径。
///
/// `data_dir`：应用数据根目录。
pub(crate) fn claude_sdk_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(CLAUDE_SDK_DIR_NAME)
}

/// 解析当前应用声明的 Claude SDK 安装目标包。
///
/// 无入参，返回类似 `@anthropic-ai/claude-agent-sdk@0.2.81` 的安装目标。
pub(crate) fn claude_sdk_package_spec() -> Result<String, String> {
    let package_json: Value = serde_json::from_str(ROOT_PACKAGE_JSON)
        .map_err(|error| format!("解析 package.json 失败：{error}"))?;
    let raw_spec = package_json
        .get("dependencies")
        .and_then(|value| value.get(CLAUDE_SDK_PACKAGE_NAME))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "package.json 中未声明 Claude SDK 依赖。".to_string())?;
    let normalized = normalize_package_version(raw_spec);
    Ok(format!("{CLAUDE_SDK_PACKAGE_NAME}@{normalized}"))
}

/// 从 SDK 根目录解析 `sdk.mjs`。
///
/// `sdk_dir`：Claude SDK 根目录。
pub(crate) fn resolve_claude_sdk_entry_from_sdk_dir(sdk_dir: &Path) -> Result<PathBuf, String> {
    let candidate = sdk_dir.join("sdk.mjs");
    candidate.canonicalize().map_err(|error| {
        format!(
            "无法定位 Claude Agent SDK 入口：{}。原始错误：{error}",
            candidate.display()
        )
    })
}

/// 从指定项目根目录解析 Claude SDK 入口路径。
///
/// `project_root`：仓库根目录，用于定位 `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`。
pub(crate) fn resolve_claude_sdk_entry_from_root(project_root: &Path) -> Result<PathBuf, String> {
    let candidate = project_root
        .join("node_modules")
        .join("@anthropic-ai")
        .join("claude-agent-sdk")
        .join("sdk.mjs");
    candidate.canonicalize().map_err(|error| {
        format!(
            "无法定位 Claude Agent SDK 入口：{}。请先执行 `npm install`。原始错误：{error}",
            candidate.display()
        )
    })
}

/// 从当前二进制路径附近解析打包后的 Claude SDK 入口。
///
/// `binary_path`：当前 app 或 daemon 可执行文件绝对路径。
pub(crate) fn resolve_claude_sdk_entry_from_binary_path(
    binary_path: &Path,
) -> Result<PathBuf, String> {
    let mut candidates = Vec::<PathBuf>::new();

    for ancestor in binary_path.ancestors().skip(1).take(6) {
        for candidate in [
            ancestor.join(CLAUDE_SDK_DIR_NAME).join("sdk.mjs"),
            ancestor
                .join("resources")
                .join(CLAUDE_SDK_DIR_NAME)
                .join("sdk.mjs"),
            ancestor
                .join("Resources")
                .join(CLAUDE_SDK_DIR_NAME)
                .join("sdk.mjs"),
        ] {
            if !candidates.iter().any(|existing| existing == &candidate) {
                candidates.push(candidate);
            }
        }
    }

    for candidate in &candidates {
        if let Ok(path) = candidate.canonicalize() {
            return Ok(path);
        }
    }

    let checked_paths = candidates
        .iter()
        .take(4)
        .map(|candidate| candidate.display().to_string())
        .collect::<Vec<_>>()
        .join("；");
    Err(format!(
        "无法定位打包后的 Claude Agent SDK 入口。已检查：{checked_paths}。请确认安装包已包含 claude-agent-sdk 资源。"
    ))
}

/// 读取 Claude SDK 状态。
///
/// `project_root`：源码仓库根目录。
/// `app_data_dir`：应用数据目录，可为空。
/// `binary_path`：当前二进制路径，可为空。
pub(crate) fn read_claude_sdk_status(
    project_root: &Path,
    app_data_dir: Option<&Path>,
    binary_path: Option<&Path>,
) -> ClaudeSdkStatus {
    if let Some(data_dir) = app_data_dir {
        let sdk_dir = claude_sdk_dir(data_dir);
        if sdk_dir.exists() {
            return build_status_from_sdk_dir(&sdk_dir, ClaudeSdkSource::AppData)
                .unwrap_or_else(|error| error_status(&sdk_dir, ClaudeSdkSource::AppData, error));
        }
    }

    let project_sdk_dir = project_root
        .join("node_modules")
        .join("@anthropic-ai")
        .join("claude-agent-sdk");
    if project_sdk_dir.exists() {
        return build_status_from_sdk_dir(&project_sdk_dir, ClaudeSdkSource::ProjectNodeModules)
            .unwrap_or_else(|error| {
                error_status(&project_sdk_dir, ClaudeSdkSource::ProjectNodeModules, error)
            });
    }

    if let Some(binary_path) = binary_path {
        if let Ok(entry_path) = resolve_claude_sdk_entry_from_binary_path(binary_path) {
            let sdk_dir = entry_path
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from(CLAUDE_SDK_DIR_NAME));
            return build_status_from_sdk_dir(&sdk_dir, ClaudeSdkSource::Bundle)
                .unwrap_or_else(|error| error_status(&sdk_dir, ClaudeSdkSource::Bundle, error));
        }
    }

    ClaudeSdkStatus {
        state: ClaudeSdkState::Missing,
        version: None,
        path: app_data_dir.map(|data_dir| claude_sdk_dir(data_dir).display().to_string()),
        source: None,
        error: Some(
            "未检测到 Claude Agent SDK。开发态请先执行 `npm install`；安装包请在设置中下载 Claude SDK。"
                .to_string(),
        ),
    }
}

fn build_status_from_sdk_dir(
    sdk_dir: &Path,
    source: ClaudeSdkSource,
) -> Result<ClaudeSdkStatus, String> {
    let entry_path = resolve_claude_sdk_entry_from_sdk_dir(sdk_dir)?;
    let version = read_claude_sdk_version_from_dir(sdk_dir)?;
    Ok(ClaudeSdkStatus {
        state: ClaudeSdkState::Ready,
        version,
        path: Some(entry_path.display().to_string()),
        source: Some(source),
        error: None,
    })
}

fn error_status(sdk_dir: &Path, source: ClaudeSdkSource, error: String) -> ClaudeSdkStatus {
    ClaudeSdkStatus {
        state: ClaudeSdkState::Error,
        version: None,
        path: Some(sdk_dir.display().to_string()),
        source: Some(source),
        error: Some(error),
    }
}

fn read_claude_sdk_version_from_dir(sdk_dir: &Path) -> Result<Option<String>, String> {
    let package_json_path = sdk_dir.join("package.json");
    if !package_json_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&package_json_path).map_err(|error| {
        format!(
            "读取 Claude SDK package.json 失败（{}）：{error}",
            package_json_path.display()
        )
    })?;
    let package_json: Value = serde_json::from_str(&content).map_err(|error| {
        format!(
            "解析 Claude SDK package.json 失败（{}）：{error}",
            package_json_path.display()
        )
    })?;
    Ok(package_json
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string))
}

fn normalize_package_version(raw_spec: &str) -> String {
    let trimmed = raw_spec.trim();
    let candidate = trimmed.trim_start_matches(['^', '~', '=']);
    if candidate
        .chars()
        .next()
        .is_some_and(|value| value.is_ascii_digit())
    {
        candidate.to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        claude_sdk_dir, claude_sdk_package_spec, read_claude_sdk_status,
        resolve_claude_sdk_entry_from_binary_path, resolve_claude_sdk_entry_from_root,
        resolve_claude_sdk_entry_from_sdk_dir, ClaudeSdkSource, ClaudeSdkState,
        CLAUDE_SDK_DIR_NAME,
    };
    use std::path::PathBuf;
    use uuid::Uuid;

    #[test]
    fn claude_sdk_package_spec_reads_expected_dependency() {
        let package_spec = claude_sdk_package_spec().expect("package spec");
        assert!(package_spec.starts_with("@anthropic-ai/claude-agent-sdk@"));
        assert!(!package_spec.contains('^'));
    }

    #[test]
    fn read_claude_sdk_status_prefers_app_data_sdk() {
        let temp_dir = std::env::temp_dir().join(format!("claude-sdk-status-{}", Uuid::new_v4()));
        let data_dir = temp_dir.join("data");
        let sdk_dir = claude_sdk_dir(&data_dir);
        std::fs::create_dir_all(&sdk_dir).expect("create sdk dir");
        std::fs::write(sdk_dir.join("sdk.mjs"), "export default {};\n").expect("write sdk entry");
        std::fs::write(sdk_dir.join("package.json"), r#"{ "version": "0.2.81" }"#)
            .expect("write package json");

        let status = read_claude_sdk_status(&temp_dir, Some(&data_dir), None);

        assert_eq!(status.state, ClaudeSdkState::Ready);
        assert_eq!(status.source, Some(ClaudeSdkSource::AppData));
        assert_eq!(status.version.as_deref(), Some("0.2.81"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn resolve_helpers_keep_project_and_bundle_paths_working() {
        let temp_dir = std::env::temp_dir().join(format!("claude-sdk-paths-{}", Uuid::new_v4()));
        let project_root = temp_dir.join("project");
        let project_sdk_dir = project_root
            .join("node_modules")
            .join("@anthropic-ai")
            .join("claude-agent-sdk");
        std::fs::create_dir_all(&project_sdk_dir).expect("create project sdk dir");
        std::fs::write(project_sdk_dir.join("sdk.mjs"), "export default {};\n")
            .expect("write project sdk");
        let project_entry =
            resolve_claude_sdk_entry_from_root(&project_root).expect("resolve project sdk");
        assert!(project_entry.ends_with(PathBuf::from("claude-agent-sdk").join("sdk.mjs")));

        let install_root = temp_dir
            .join("install")
            .join("resources")
            .join(CLAUDE_SDK_DIR_NAME);
        std::fs::create_dir_all(&install_root).expect("create bundled sdk dir");
        std::fs::write(install_root.join("sdk.mjs"), "export default {};\n")
            .expect("write bundled sdk");
        let binary_path = temp_dir.join("install").join("codex-monitor.exe");
        std::fs::write(&binary_path, "").expect("write fake binary");
        let bundled_entry =
            resolve_claude_sdk_entry_from_binary_path(&binary_path).expect("resolve bundled sdk");
        assert!(bundled_entry.ends_with(PathBuf::from(CLAUDE_SDK_DIR_NAME).join("sdk.mjs")));

        let direct_entry =
            resolve_claude_sdk_entry_from_sdk_dir(&install_root).expect("resolve sdk dir");
        assert_eq!(bundled_entry, direct_entry);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
