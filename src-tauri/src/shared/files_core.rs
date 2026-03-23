use std::collections::HashMap;
use std::path::PathBuf;

use tokio::sync::Mutex;

use crate::codex::home as codex_home;
use crate::files::io::{read_text_file_within, write_text_file_within, TextFileResponse};
use crate::files::ops::{read_with_policy, write_with_policy};
use crate::files::policy::{policy_for, FileKind, FileScope};
use crate::types::{AgentProvider, WorkspaceEntry};

fn resolve_default_codex_home() -> Result<PathBuf, String> {
    codex_home::resolve_default_codex_home().ok_or_else(|| "无法解析 CODEX_HOME 目录。".to_string())
}

async fn resolve_workspace_root(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| "未找到工作区。".to_string())?;
    Ok(PathBuf::from(&entry.path))
}

async fn resolve_workspace_provider(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<AgentProvider, String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| "未找到工作区。".to_string())?;
    Ok(entry.provider.clone())
}

fn workspace_agent_filename(provider: &AgentProvider) -> &'static str {
    match provider {
        AgentProvider::Claude => "CLAUDE.md",
        AgentProvider::Codex => "AGENTS.md",
    }
}

pub(crate) async fn resolve_root_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    scope: FileScope,
    workspace_id: Option<&str>,
) -> Result<PathBuf, String> {
    match scope {
        FileScope::Global => resolve_default_codex_home(),
        FileScope::Workspace => {
            let workspace_id = workspace_id.ok_or_else(|| "workspaceId 不能为空。".to_string())?;
            resolve_workspace_root(workspaces, workspace_id).await
        }
    }
}

pub(crate) async fn file_read_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    scope: FileScope,
    kind: FileKind,
    workspace_id: Option<String>,
) -> Result<TextFileResponse, String> {
    if matches!((scope, kind), (FileScope::Workspace, FileKind::Agents)) {
        let workspace_id = workspace_id.ok_or_else(|| "workspaceId 不能为空。".to_string())?;
        let provider = resolve_workspace_provider(workspaces, &workspace_id).await?;
        let root = resolve_workspace_root(workspaces, &workspace_id).await?;
        let filename = workspace_agent_filename(&provider);
        return read_text_file_within(&root, filename, false, "工作区根目录", filename, false);
    }
    let policy = policy_for(scope, kind)?;
    let root = resolve_root_core(workspaces, scope, workspace_id.as_deref()).await?;
    read_with_policy(&root, policy)
}

pub(crate) async fn file_write_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    scope: FileScope,
    kind: FileKind,
    workspace_id: Option<String>,
    content: String,
) -> Result<(), String> {
    if matches!((scope, kind), (FileScope::Workspace, FileKind::Agents)) {
        let workspace_id = workspace_id.ok_or_else(|| "workspaceId 不能为空。".to_string())?;
        let provider = resolve_workspace_provider(workspaces, &workspace_id).await?;
        let root = resolve_workspace_root(workspaces, &workspace_id).await?;
        let filename = workspace_agent_filename(&provider);
        return write_text_file_within(
            &root,
            filename,
            &content,
            false,
            "工作区根目录",
            filename,
            false,
        );
    }
    let policy = policy_for(scope, kind)?;
    let root = resolve_root_core(workspaces, scope, workspace_id.as_deref()).await?;
    write_with_policy(&root, policy, &content)
}
