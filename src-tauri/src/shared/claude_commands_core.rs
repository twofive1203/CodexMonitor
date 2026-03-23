//! Claude 项目自定义命令发现。
//! 作者：lichong

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::types::WorkspaceEntry;
use crate::utils::normalize_git_path;

use super::prompts_core::parse_frontmatter;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeCommandEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) description: Option<String>,
    #[serde(rename = "argumentHint")]
    pub(crate) argument_hint: Option<String>,
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
/// `commands_root`：`.claude/commands` 根目录。
/// `command_path`：命令文件绝对路径。
fn build_command_name(commands_root: &Path, command_path: &Path) -> Option<String> {
    let relative = command_path.strip_prefix(commands_root).ok()?;
    let mut normalized = normalize_git_path(&relative.to_string_lossy());
    if !normalized.to_ascii_lowercase().ends_with(".md") {
        return None;
    }
    normalized.truncate(normalized.len().saturating_sub(3));
    let trimmed = normalized.trim_matches('/').trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
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
        if !entry.file_type().is_some_and(|file_type| file_type.is_file()) {
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
fn parse_command_file(commands_root: &Path, command_path: &Path) -> Result<ClaudeCommandEntry, String> {
    let content = fs::read_to_string(command_path)
        .map_err(|err| format!("读取 Claude 命令文件失败（{}）：{err}", command_path.display()))?;
    let (description, argument_hint, body) = parse_frontmatter(&content);
    let path = command_path
        .strip_prefix(commands_root)
        .map_err(|err| format!("解析 Claude 命令相对路径失败：{err}"))?;
    let normalized_path = normalize_git_path(&path.to_string_lossy());
    let name = build_command_name(commands_root, command_path)
        .ok_or_else(|| format!("无效的 Claude 命令文件：{}", command_path.display()))?;
    let normalized_description = description
        .and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .or_else(|| build_body_description(&body));
    let normalized_argument_hint = argument_hint.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    Ok(ClaudeCommandEntry {
        name,
        path: normalized_path,
        description: normalized_description,
        argument_hint: normalized_argument_hint,
    })
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
    let commands_root = workspace_path.join(".claude").join("commands");
    if !commands_root.is_dir() {
        return Ok(Vec::new());
    }

    let mut commands = Vec::new();
    for command_path in list_command_files(&commands_root) {
        commands.push(parse_command_file(&commands_root, &command_path)?);
    }
    commands.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(commands)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{AgentProvider, WorkspaceKind, WorkspaceSettings};

    fn make_workspace(path: &Path) -> WorkspaceEntry {
        WorkspaceEntry {
            id: "ws-1".to_string(),
            name: "Claude".to_string(),
            path: path.to_string_lossy().to_string(),
            provider: AgentProvider::Claude,
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    fn create_temp_workspace() -> PathBuf {
        let path = std::env::temp_dir().join(format!("codex-monitor-claude-commands-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp workspace");
        path
    }

    #[test]
    fn parses_nested_command_names() {
        let root = PathBuf::from("/repo/.claude/commands");
        let command = root.join("qa").join("review.md");
        let name = build_command_name(&root, &command).expect("command name");
        assert_eq!(name, "qa/review");
    }

    #[tokio::test]
    async fn lists_claude_commands_from_workspace() {
        let workspace_path = create_temp_workspace();
        let commands_dir = workspace_path.join(".claude").join("commands").join("qa");
        fs::create_dir_all(&commands_dir).expect("create commands dir");
        fs::write(
            commands_dir.join("review.md"),
            "---\ndescription: \"检查风险\"\nargument-hint: \"<path>\"\n---\n# Review\n",
        )
        .expect("write command");

        let workspaces = Mutex::new(HashMap::from([(
            "ws-1".to_string(),
            make_workspace(&workspace_path),
        )]));

        let commands = list_claude_commands_core(&workspaces, "ws-1".to_string())
            .await
            .expect("list commands");
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "qa/review");
        assert_eq!(commands[0].path, "qa/review.md");
        assert_eq!(commands[0].description.as_deref(), Some("检查风险"));
        assert_eq!(commands[0].argument_hint.as_deref(), Some("<path>"));

        fs::remove_dir_all(workspace_path).ok();
    }
}
