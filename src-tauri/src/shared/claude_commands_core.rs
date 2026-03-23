//! Claude 项目自定义命令发现。
//! 作者：lichong

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::types::WorkspaceEntry;
use crate::utils::normalize_git_path;

use super::{claude_config_core, prompts_core::parse_frontmatter};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeCommandEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) description: Option<String>,
    #[serde(rename = "argumentHint")]
    pub(crate) argument_hint: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClaudeCommandScope {
    Workspace,
    Global,
}

/// 读取工作区路径。
///
/// `workspaces`：工作区存储。
/// `workspace_id`：目标工作区 ID。
async fn resolve_workspace_path(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| format!("workspace `{workspace_id}` not found"))?;
    Ok(PathBuf::from(entry.path.clone()))
}

/// 生成命令名称。
///
/// `command_path`：命令文件绝对路径。
fn build_command_name(command_path: &Path) -> Option<String> {
    let file_name = command_path.file_name()?.to_str()?.trim();
    if !file_name.to_ascii_lowercase().ends_with(".md") {
        return None;
    }
    let trimmed = command_path.file_stem()?.to_str()?.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

/// 解析命令所在的命名空间目录。
///
/// `commands_root`：命令根目录。
/// `command_path`：命令文件绝对路径。
fn build_command_namespace(commands_root: &Path, command_path: &Path) -> Option<String> {
    let relative = command_path.strip_prefix(commands_root).ok()?;
    let parent = relative.parent()?;
    let normalized = normalize_git_path(&parent.to_string_lossy());
    let trimmed = normalized.trim_matches('/').trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

/// 生成命令来源标签，用于在自动补全里区分项目级和用户级命令。
///
/// `commands_root`：命令根目录。
/// `command_path`：命令文件绝对路径。
/// `scope`：命令所属作用域。
fn build_command_origin_label(
    commands_root: &Path,
    command_path: &Path,
    scope: ClaudeCommandScope,
) -> Option<String> {
    let scope_label = match scope {
        ClaudeCommandScope::Workspace => "项目",
        ClaudeCommandScope::Global => "用户",
    };
    let namespace = build_command_namespace(commands_root, command_path);
    Some(match namespace {
        Some(value) => format!("（{scope_label}:{value}）"),
        None => format!("（{scope_label}）"),
    })
}

/// 生成命令描述文案。
///
/// `body`：去掉 frontmatter 后的正文。
fn build_body_description(body: &str) -> Option<String> {
    body.lines().find_map(|line| {
        let trimmed = line.trim().trim_start_matches('#').trim();
        if trimmed.is_empty() {
            return None;
        }
        Some(trimmed.to_string())
    })
}

/// 在描述后追加命令来源标签。
///
/// `description`：原始描述。
/// `origin_label`：来源标签。
fn append_origin_label(
    description: Option<String>,
    origin_label: Option<String>,
) -> Option<String> {
    match (description, origin_label) {
        (Some(description), Some(origin_label)) => Some(format!("{description} {origin_label}")),
        (Some(description), None) => Some(description),
        (None, Some(origin_label)) => Some(origin_label),
        (None, None) => None,
    }
}

/// 扫描 `.claude/commands` 下的 Markdown 命令文件。
///
/// `commands_root`：命令根目录。
fn list_command_files(commands_root: &Path) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let walker = WalkBuilder::new(commands_root)
        .hidden(false)
        .follow_links(false)
        .require_git(false)
        .build();

    for entry in walker {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        if !entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            continue;
        }
        let path = entry.into_path();
        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("md"))
        {
            results.push(path);
        }
    }

    results.sort();
    results
}

/// 解析单个 Claude 自定义命令文件。
///
/// `commands_root`：命令根目录。
/// `command_path`：命令文件绝对路径。
/// `scope`：命令所属作用域。
fn parse_command_file(
    commands_root: &Path,
    command_path: &Path,
    scope: ClaudeCommandScope,
) -> Result<ClaudeCommandEntry, String> {
    let content = fs::read_to_string(command_path).map_err(|err| {
        format!(
            "读取 Claude 命令文件失败（{}）：{err}",
            command_path.display()
        )
    })?;
    let (description, argument_hint, body) = parse_frontmatter(&content);
    let path = command_path
        .strip_prefix(commands_root)
        .map_err(|err| format!("解析 Claude 命令相对路径失败：{err}"))?;
    let normalized_path = normalize_git_path(&path.to_string_lossy());
    let name = build_command_name(command_path)
        .ok_or_else(|| format!("无效的 Claude 命令文件：{}", command_path.display()))?;
    let normalized_description = description
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| build_body_description(&body));
    let normalized_argument_hint = argument_hint.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    let origin_label = build_command_origin_label(commands_root, command_path, scope);

    Ok(ClaudeCommandEntry {
        name,
        path: normalized_path,
        description: append_origin_label(normalized_description, origin_label),
        argument_hint: normalized_argument_hint,
    })
}

/// 读取单个命令根目录下的 Claude 自定义命令。
///
/// `commands_root`：命令根目录。
/// `scope`：命令所属作用域。
fn list_commands_from_root(
    commands_root: &Path,
    scope: ClaudeCommandScope,
) -> Result<Vec<ClaudeCommandEntry>, String> {
    if !commands_root.is_dir() {
        return Ok(Vec::new());
    }

    let mut commands = Vec::new();
    for command_path in list_command_files(commands_root) {
        commands.push(parse_command_file(commands_root, &command_path, scope)?);
    }
    Ok(commands)
}

/// 合并工作区和用户级命令，优先保留工作区命令。
///
/// `workspace_commands`：工作区命令列表。
/// `global_commands`：用户级命令列表。
fn merge_command_lists(
    workspace_commands: Vec<ClaudeCommandEntry>,
    global_commands: Vec<ClaudeCommandEntry>,
) -> Vec<ClaudeCommandEntry> {
    let mut seen_names = HashSet::new();
    let mut merged = Vec::new();

    for command in workspace_commands.into_iter().chain(global_commands) {
        let dedupe_key = command.name.to_ascii_lowercase();
        if seen_names.insert(dedupe_key) {
            merged.push(command);
        }
    }

    merged.sort_by(|left, right| left.name.cmp(&right.name));
    merged
}

/// 从多个 Claude 命令根目录中汇总命令。
///
/// `workspace_commands_root`：项目 `.claude/commands` 目录。
/// `global_commands_root`：用户 `~/.claude/commands` 目录。
fn list_claude_commands_from_roots(
    workspace_commands_root: Option<&Path>,
    global_commands_root: Option<&Path>,
) -> Result<Vec<ClaudeCommandEntry>, String> {
    let workspace_commands = match workspace_commands_root {
        Some(root) => list_commands_from_root(root, ClaudeCommandScope::Workspace)?,
        None => Vec::new(),
    };
    let global_commands = match global_commands_root {
        Some(root) => list_commands_from_root(root, ClaudeCommandScope::Global)?,
        None => Vec::new(),
    };
    Ok(merge_command_lists(workspace_commands, global_commands))
}

/// 读取工作区中的 Claude 自定义命令列表。
///
/// `workspaces`：工作区存储。
/// `workspace_id`：目标工作区 ID。
pub(crate) async fn list_claude_commands_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Vec<ClaudeCommandEntry>, String> {
    let workspace_path = resolve_workspace_path(workspaces, &workspace_id).await?;
    let workspace_commands_root = workspace_path.join(".claude").join("commands");
    let global_commands_root =
        claude_config_core::resolve_claude_config_dir().map(|path| path.join("commands"));
    list_claude_commands_from_roots(
        Some(&workspace_commands_root),
        global_commands_root.as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_temp_workspace() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-claude-commands-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).expect("create temp workspace");
        path
    }

    #[test]
    fn parses_command_name_from_file_stem() {
        let command = PathBuf::from("/repo/.claude/commands/qa/review.md");
        let name = build_command_name(&command).expect("command name");
        assert_eq!(name, "review");
    }

    #[tokio::test]
    async fn lists_claude_commands_from_workspace_and_global_dir() {
        let workspace_path = create_temp_workspace();
        let commands_dir = workspace_path.join(".claude").join("commands").join("qa");
        fs::create_dir_all(&commands_dir).expect("create commands dir");
        fs::write(
            commands_dir.join("review.md"),
            "---\ndescription: \"检查风险\"\nargument-hint: \"<path>\"\n---\n# Review\n",
        )
        .expect("write command");
        let global_dir = create_temp_workspace().join("commands");
        fs::create_dir_all(&global_dir).expect("create global commands dir");
        fs::write(
            global_dir.join("security-audit.md"),
            "---\ndescription: \"执行安全审计\"\n---\n# Security audit\n",
        )
        .expect("write global command");

        let commands = list_claude_commands_from_roots(
            Some(&workspace_path.join(".claude").join("commands")),
            Some(&global_dir),
        )
        .expect("list commands");
        assert_eq!(commands.len(), 2);
        assert_eq!(commands[0].name, "review");
        assert_eq!(commands[0].path, "qa/review.md");
        assert_eq!(
            commands[0].description.as_deref(),
            Some("检查风险 （项目:qa）")
        );
        assert_eq!(commands[0].argument_hint.as_deref(), Some("<path>"));
        assert_eq!(commands[1].name, "security-audit");
        assert_eq!(commands[1].path, "security-audit.md");
        assert_eq!(
            commands[1].description.as_deref(),
            Some("执行安全审计 （用户）")
        );

        fs::remove_dir_all(global_dir.parent().expect("global temp root")).ok();
        fs::remove_dir_all(workspace_path).ok();
    }

    #[test]
    fn workspace_commands_override_global_duplicates() {
        let workspace_root = create_temp_workspace().join(".claude").join("commands");
        let global_root = create_temp_workspace().join("commands");
        fs::create_dir_all(&workspace_root).expect("create workspace commands dir");
        fs::create_dir_all(&global_root).expect("create global commands dir");
        fs::write(
            workspace_root.join("status.md"),
            "---\ndescription: \"项目状态\"\n---\n# Status\n",
        )
        .expect("write workspace command");
        fs::write(
            global_root.join("status.md"),
            "---\ndescription: \"用户状态\"\n---\n# Status\n",
        )
        .expect("write global command");

        let commands = list_claude_commands_from_roots(Some(&workspace_root), Some(&global_root))
            .expect("list commands");
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "status");
        assert_eq!(
            commands[0].description.as_deref(),
            Some("项目状态 （项目）")
        );

        fs::remove_dir_all(
            workspace_root
                .parent()
                .and_then(|value| value.parent())
                .expect("workspace temp root"),
        )
        .ok();
        fs::remove_dir_all(global_root.parent().expect("global temp root")).ok();
    }
}
