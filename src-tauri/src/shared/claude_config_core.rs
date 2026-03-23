use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::codex::home::resolve_home_dir;

/// Claude 启动时需要的配置快照。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ClaudeLaunchConfig {
    pub(crate) config_dir: Option<PathBuf>,
    pub(crate) default_model: Option<String>,
    pub(crate) permission_mode: Option<String>,
    pub(crate) env_overrides: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize, Default)]
struct RawClaudeSettings {
    #[serde(default)]
    env: Map<String, Value>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    permissions: RawClaudePermissions,
}

#[derive(Debug, Deserialize, Default)]
struct RawClaudePermissions {
    #[serde(default, rename = "defaultMode")]
    default_mode: Option<String>,
}

/// 解析 Claude 配置目录。
///
/// 无入参，优先读取 `CLAUDE_CONFIG_DIR`，否则回退到 `~/.claude`。
pub(crate) fn resolve_claude_config_dir() -> Option<PathBuf> {
    std::env::var("CLAUDE_CONFIG_DIR")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| resolve_home_dir().map(|home| home.join(".claude")))
}

/// 读取 Claude 启动配置快照。
///
/// 无入参，返回可用于 sidecar 启动的环境变量、默认模型和权限模式。
pub(crate) fn read_launch_config() -> Result<ClaudeLaunchConfig, String> {
    let config_dir = resolve_claude_config_dir();
    let Some(ref dir) = config_dir else {
        return Ok(ClaudeLaunchConfig::default());
    };
    let settings_path = dir.join("settings.json");
    load_launch_config_from_settings_path(&settings_path, config_dir)
}

/// 读取 Claude 默认模型。
///
/// 无入参，返回 `~/.claude/settings.json` 中的顶层 `model`。
pub(crate) fn read_config_model() -> Result<Option<String>, String> {
    Ok(read_launch_config()?.default_model)
}

fn load_launch_config_from_settings_path(
    settings_path: &Path,
    config_dir: Option<PathBuf>,
) -> Result<ClaudeLaunchConfig, String> {
    if !settings_path.exists() {
        return Ok(ClaudeLaunchConfig {
            config_dir,
            ..ClaudeLaunchConfig::default()
        });
    }

    let settings = read_settings_from_path(settings_path)?;
    Ok(ClaudeLaunchConfig {
        config_dir,
        default_model: normalize_optional_string(settings.model),
        permission_mode: normalize_permission_mode(settings.permissions.default_mode),
        env_overrides: extract_env_overrides(settings.env),
    })
}

fn read_settings_from_path(path: &Path) -> Result<RawClaudeSettings, String> {
    let data = std::fs::read_to_string(path)
        .map_err(|error| format!("读取 Claude 配置文件失败（{}）：{error}", path.display()))?;
    serde_json::from_str::<RawClaudeSettings>(&data)
        .map_err(|error| format!("解析 Claude 配置文件失败（{}）：{error}", path.display()))
}

fn extract_env_overrides(env: Map<String, Value>) -> BTreeMap<String, String> {
    env.into_iter()
        .filter_map(|(key, value)| {
            let normalized_key = key.trim();
            if normalized_key.is_empty() {
                return None;
            }
            let normalized_value = value
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())?;
            Some((normalized_key.to_string(), normalized_value.to_string()))
        })
        .collect()
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// 规范化 Claude 权限模式。
///
/// `value`：待规范化的权限模式原始值。
pub(crate) fn normalize_permission_mode(value: Option<String>) -> Option<String> {
    match normalize_optional_string(value)
        .as_deref()
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("default") => Some("default".to_string()),
        Some("acceptedits") => Some("acceptEdits".to_string()),
        Some("bypasspermissions") => Some("bypassPermissions".to_string()),
        Some("plan") => Some("plan".to_string()),
        Some("dontask") => Some("dontAsk".to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        load_launch_config_from_settings_path, normalize_permission_mode, ClaudeLaunchConfig,
    };
    use std::collections::BTreeMap;
    use uuid::Uuid;

    #[test]
    fn load_launch_config_reads_model_permission_and_env() {
        let temp_dir = std::env::temp_dir().join(format!("claude-config-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");
        let settings_path = temp_dir.join("settings.json");
        std::fs::write(
            &settings_path,
            r#"{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "token-1",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8045",
    "EMPTY_VALUE": "   "
  },
  "permissions": {
    "defaultMode": "bypassPermissions"
  },
  "model": "opus"
}"#,
        )
        .expect("write settings");

        let launch_config =
            load_launch_config_from_settings_path(&settings_path, Some(temp_dir.clone()))
                .expect("load launch config");

        assert_eq!(
            launch_config,
            ClaudeLaunchConfig {
                config_dir: Some(temp_dir.clone()),
                default_model: Some("opus".to_string()),
                permission_mode: Some("bypassPermissions".to_string()),
                env_overrides: BTreeMap::from([
                    ("ANTHROPIC_AUTH_TOKEN".to_string(), "token-1".to_string(),),
                    (
                        "ANTHROPIC_BASE_URL".to_string(),
                        "http://127.0.0.1:8045".to_string(),
                    ),
                ]),
            }
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn load_launch_config_returns_defaults_when_settings_missing() {
        let temp_dir = std::env::temp_dir().join(format!("claude-config-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");
        let settings_path = temp_dir.join("settings.json");

        let launch_config =
            load_launch_config_from_settings_path(&settings_path, Some(temp_dir.clone()))
                .expect("load launch config");

        assert_eq!(
            launch_config,
            ClaudeLaunchConfig {
                config_dir: Some(temp_dir.clone()),
                ..ClaudeLaunchConfig::default()
            }
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn normalize_permission_mode_rejects_unknown_values() {
        assert_eq!(
            normalize_permission_mode(Some("unknown-mode".to_string())),
            None
        );
        assert_eq!(
            normalize_permission_mode(Some(" acceptEdits ".to_string())),
            Some("acceptEdits".to_string())
        );
    }
}
