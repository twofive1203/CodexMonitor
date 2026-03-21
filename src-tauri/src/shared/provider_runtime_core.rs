use std::path::PathBuf;

use crate::codex::args::resolve_workspace_codex_args;
use crate::codex::home::resolve_workspace_codex_home;
use crate::types::{AgentProvider, AppSettings, WorkspaceEntry};

/// Provider 运行时启动配置。
///
/// `default_bin`：provider 默认可执行文件路径，可为空表示走系统默认命令。
/// `runtime_args`：provider 运行时附加参数。
/// `runtime_home`：provider 运行时 home 目录，仅部分 provider 使用。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ProviderRuntimeConfig {
    pub(crate) default_bin: Option<String>,
    pub(crate) runtime_args: Option<String>,
    pub(crate) runtime_home: Option<PathBuf>,
}

/// 解析指定工作区的 provider 运行时配置。
///
/// `entry`：当前工作区。
/// `parent_entry`：父工作区；主工作树场景下为空。
/// `app_settings`：当前应用设置快照。
pub(crate) fn resolve_provider_runtime_config(
    entry: &WorkspaceEntry,
    parent_entry: Option<&WorkspaceEntry>,
    app_settings: &AppSettings,
) -> ProviderRuntimeConfig {
    match entry.provider {
        AgentProvider::Codex => ProviderRuntimeConfig {
            default_bin: app_settings.codex_bin.clone(),
            runtime_args: resolve_workspace_codex_args(entry, parent_entry, Some(app_settings)),
            runtime_home: resolve_workspace_codex_home(entry, parent_entry),
        },
        AgentProvider::Claude => ProviderRuntimeConfig {
            default_bin: trim_to_option(app_settings.claude_bin.as_deref()),
            runtime_args: trim_to_option(app_settings.claude_args.as_deref()),
            runtime_home: None,
        },
    }
}

/// 统一清理设置项中的空白值。
///
/// `value`：待清理的原始字符串。
fn trim_to_option(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::{resolve_provider_runtime_config, ProviderRuntimeConfig};

    use crate::types::{
        AgentProvider, AppSettings, WorkspaceEntry, WorkspaceKind, WorkspaceSettings,
    };

    fn make_entry(provider: AgentProvider) -> WorkspaceEntry {
        WorkspaceEntry {
            id: "workspace-1".to_string(),
            name: "workspace-1".to_string(),
            path: "/tmp/workspace-1".to_string(),
            provider,
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    #[test]
    fn resolves_claude_runtime_from_app_settings() {
        let mut settings = AppSettings::default();
        settings.claude_bin = Some("  C:/tools/claude.exe  ".to_string());
        settings.claude_args = Some("  --verbose  ".to_string());

        let config =
            resolve_provider_runtime_config(&make_entry(AgentProvider::Claude), None, &settings);

        assert_eq!(
            config,
            ProviderRuntimeConfig {
                default_bin: Some("C:/tools/claude.exe".to_string()),
                runtime_args: Some("--verbose".to_string()),
                runtime_home: None,
            }
        );
    }
}
