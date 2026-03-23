use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;
use tokio::task;

use crate::codex::home::{resolve_default_codex_home, resolve_workspace_codex_home};
use crate::types::WorkspaceEntry;

#[derive(Serialize, Clone)]
pub(crate) struct CustomPromptEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) description: Option<String>,
    #[serde(rename = "argumentHint")]
    pub(crate) argument_hint: Option<String>,
    pub(crate) content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) scope: Option<String>,
}

fn resolve_codex_home_for_workspace(
    workspaces: &HashMap<String, WorkspaceEntry>,
    entry: &WorkspaceEntry,
) -> Option<PathBuf> {
    let parent_entry = entry
        .parent_id
        .as_ref()
        .and_then(|parent_id| workspaces.get(parent_id));
    resolve_workspace_codex_home(entry, parent_entry).or_else(resolve_default_codex_home)
}

fn default_prompts_dir_for_workspace(
    workspaces: &HashMap<String, WorkspaceEntry>,
    entry: &WorkspaceEntry,
) -> Option<PathBuf> {
    resolve_codex_home_for_workspace(workspaces, entry).map(|home| home.join("prompts"))
}

fn require_workspace_entry(
    workspaces: &HashMap<String, WorkspaceEntry>,
    workspace_id: &str,
) -> Result<WorkspaceEntry, String> {
    workspaces
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| "未找到工作区。".to_string())
}

fn app_data_dir(settings_path: &Path) -> Result<PathBuf, String> {
    settings_path
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| "无法解析应用数据目录。".to_string())
}

fn workspace_prompts_dir(settings_path: &Path, entry: &WorkspaceEntry) -> Result<PathBuf, String> {
    let data_dir = app_data_dir(settings_path)?;
    Ok(data_dir.join("workspaces").join(&entry.id).join("prompts"))
}

fn prompt_roots_for_workspace(
    settings_path: &Path,
    workspaces: &HashMap<String, WorkspaceEntry>,
    entry: &WorkspaceEntry,
) -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    roots.push(workspace_prompts_dir(settings_path, entry)?);
    if let Some(global_dir) = default_prompts_dir_for_workspace(workspaces, entry) {
        roots.push(global_dir);
    }
    Ok(roots)
}

fn ensure_path_within_roots(path: &Path, roots: &[PathBuf]) -> Result<(), String> {
    let canonical_path = path
        .canonicalize()
        .map_err(|_| "提示词路径无效。".to_string())?;
    for root in roots {
        if let Ok(canonical_root) = root.canonicalize() {
            if canonical_path.starts_with(&canonical_root) {
                return Ok(());
            }
        }
    }
    Err("提示词路径不在允许的目录范围内。".to_string())
}

#[cfg(unix)]
fn is_cross_device_error(err: &std::io::Error) -> bool {
    err.raw_os_error() == Some(libc::EXDEV)
}

#[cfg(not(unix))]
fn is_cross_device_error(_err: &std::io::Error) -> bool {
    false
}

fn move_file(src: &Path, dest: &Path) -> Result<(), String> {
    match fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(err) if is_cross_device_error(&err) => {
            fs::copy(src, dest).map_err(|err| err.to_string())?;
            fs::remove_file(src).map_err(|err| err.to_string())
        }
        Err(err) => Err(err.to_string()),
    }
}

/// 解析 Markdown frontmatter 中的常用元数据。
///
/// `content`：完整 Markdown 文本。
pub(crate) fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>, String) {
    let mut segments = content.split_inclusive('\n');
    let Some(first_segment) = segments.next() else {
        return (None, None, String::new());
    };
    let first_line = first_segment.trim_end_matches(['\r', '\n']);
    if first_line.trim() != "---" {
        return (None, None, content.to_string());
    }

    let mut description: Option<String> = None;
    let mut argument_hint: Option<String> = None;
    let mut frontmatter_closed = false;
    let mut consumed = first_segment.len();

    for segment in segments {
        let line = segment.trim_end_matches(['\r', '\n']);
        let trimmed = line.trim();

        if trimmed == "---" {
            frontmatter_closed = true;
            consumed += segment.len();
            break;
        }

        if trimmed.is_empty() || trimmed.starts_with('#') {
            consumed += segment.len();
            continue;
        }

        if let Some((key, value)) = trimmed.split_once(':') {
            let mut val = value.trim().to_string();
            if val.len() >= 2 {
                let bytes = val.as_bytes();
                let first = bytes[0];
                let last = bytes[bytes.len() - 1];
                if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
                    val = val[1..val.len().saturating_sub(1)].to_string();
                }
            }
            match key.trim().to_ascii_lowercase().as_str() {
                "description" => description = Some(val),
                "argument-hint" | "argument_hint" => argument_hint = Some(val),
                _ => {}
            }
        }

        consumed += segment.len();
    }

    if !frontmatter_closed {
        return (None, None, content.to_string());
    }

    let body = if consumed >= content.len() {
        String::new()
    } else {
        content[consumed..].to_string()
    };
    (description, argument_hint, body)
}

fn build_prompt_contents(
    description: Option<String>,
    argument_hint: Option<String>,
    content: String,
) -> String {
    let has_meta = description
        .as_ref()
        .is_some_and(|value| !value.trim().is_empty())
        || argument_hint
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty());
    if !has_meta {
        return content;
    }
    let mut output = String::from("---\n");
    if let Some(description) = description {
        let trimmed = description.trim();
        if !trimmed.is_empty() {
            output.push_str(&format!(
                "description: \"{}\"\n",
                trimmed.replace('"', "\\\"")
            ));
        }
    }
    if let Some(argument_hint) = argument_hint {
        let trimmed = argument_hint.trim();
        if !trimmed.is_empty() {
            output.push_str(&format!(
                "argument-hint: \"{}\"\n",
                trimmed.replace('"', "\\\"")
            ));
        }
    }
    output.push_str("---\n");
    output.push_str(&content);
    output
}

fn sanitize_prompt_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("提示词名称不能为空。".to_string());
    }
    if trimmed.chars().any(|ch| ch.is_whitespace()) {
        return Err("提示词名称不能包含空白字符。".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("提示词名称不能包含路径分隔符。".to_string());
    }
    Ok(trimmed.to_string())
}

fn discover_prompts_in(dir: &Path, scope: Option<&str>) -> Vec<CustomPromptEntry> {
    let mut out: Vec<CustomPromptEntry> = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return out,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let is_file = fs::metadata(&path).map(|m| m.is_file()).unwrap_or(false);
        if !is_file {
            continue;
        }
        let is_md = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_md {
            continue;
        }
        let Some(name) = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let (description, argument_hint, body) = parse_frontmatter(&content);
        out.push(CustomPromptEntry {
            name,
            path: path.to_string_lossy().to_string(),
            description,
            argument_hint,
            content: body,
            scope: scope.map(|value| value.to_string()),
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub(crate) async fn prompts_list_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    settings_path: &Path,
    workspace_id: String,
) -> Result<Vec<CustomPromptEntry>, String> {
    let (workspace_dir, global_dir) = {
        let workspaces = workspaces.lock().await;
        let entry = workspaces.get(&workspace_id).cloned();
        let workspace_dir = entry
            .as_ref()
            .and_then(|entry| workspace_prompts_dir(settings_path, entry).ok());
        let global_dir = entry
            .as_ref()
            .and_then(|entry| default_prompts_dir_for_workspace(&workspaces, entry));
        (workspace_dir, global_dir)
    };

    task::spawn_blocking(move || {
        let mut out = Vec::new();
        if let Some(dir) = workspace_dir {
            let _ = fs::create_dir_all(&dir);
            out.extend(discover_prompts_in(&dir, Some("workspace")));
        }
        if let Some(dir) = global_dir {
            let _ = fs::create_dir_all(&dir);
            out.extend(discover_prompts_in(&dir, Some("global")));
        }
        out
    })
    .await
    .map_err(|_| "发现提示词失败。".to_string())
}

pub(crate) async fn prompts_workspace_dir_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    settings_path: &Path,
    workspace_id: String,
) -> Result<String, String> {
    let dir = {
        let workspaces = workspaces.lock().await;
        let entry = require_workspace_entry(&workspaces, &workspace_id)?;
        workspace_prompts_dir(settings_path, &entry)?
    };
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

pub(crate) async fn prompts_global_dir_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<String, String> {
    let workspaces = workspaces.lock().await;
    let entry = require_workspace_entry(&workspaces, &workspace_id)?;
    let dir = default_prompts_dir_for_workspace(&workspaces, &entry)
        .ok_or("无法解析 CODEX_HOME 目录。".to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

pub(crate) async fn prompts_create_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    settings_path: &Path,
    workspace_id: String,
    scope: String,
    name: String,
    description: Option<String>,
    argument_hint: Option<String>,
    content: String,
) -> Result<CustomPromptEntry, String> {
    let name = sanitize_prompt_name(&name)?;
    let (target_dir, resolved_scope) = {
        let workspaces = workspaces.lock().await;
        let entry = require_workspace_entry(&workspaces, &workspace_id)?;
        match scope.as_str() {
            "workspace" => {
                let dir = workspace_prompts_dir(settings_path, &entry)?;
                (dir, "workspace")
            }
            "global" => {
                let dir = default_prompts_dir_for_workspace(&workspaces, &entry)
                    .ok_or("无法解析 CODEX_HOME 目录。".to_string())?;
                (dir, "global")
            }
            _ => return Err("作用域无效。".to_string()),
        }
    };
    let path = target_dir.join(format!("{name}.md"));
    if path.exists() {
        return Err("提示词已存在。".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let body = build_prompt_contents(description.clone(), argument_hint.clone(), content.clone());
    fs::write(&path, body).map_err(|err| err.to_string())?;
    Ok(CustomPromptEntry {
        name,
        path: path.to_string_lossy().to_string(),
        description,
        argument_hint,
        content,
        scope: Some(resolved_scope.to_string()),
    })
}

pub(crate) async fn prompts_update_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    settings_path: &Path,
    workspace_id: String,
    path: String,
    name: String,
    description: Option<String>,
    argument_hint: Option<String>,
    content: String,
) -> Result<CustomPromptEntry, String> {
    let name = sanitize_prompt_name(&name)?;
    let target_path = PathBuf::from(&path);
    if !target_path.exists() {
        return Err("未找到提示词。".to_string());
    }
    {
        let workspaces = workspaces.lock().await;
        let entry = require_workspace_entry(&workspaces, &workspace_id)?;
        let roots = prompt_roots_for_workspace(settings_path, &workspaces, &entry)?;
        ensure_path_within_roots(&target_path, &roots)?;
    }
    let dir = target_path
        .parent()
        .ok_or("无法解析提示词目录。".to_string())?;
    let next_path = dir.join(format!("{name}.md"));
    if next_path != target_path && next_path.exists() {
        return Err("同名提示词已存在。".to_string());
    }
    let body = build_prompt_contents(description.clone(), argument_hint.clone(), content.clone());
    fs::write(&next_path, body).map_err(|err| err.to_string())?;
    if next_path != target_path {
        fs::remove_file(&target_path).map_err(|err| err.to_string())?;
    }
    let scope = {
        let workspaces = workspaces.lock().await;
        let entry = require_workspace_entry(&workspaces, &workspace_id)?;
        let workspace_dir = workspace_prompts_dir(settings_path, &entry)?;
        if next_path.starts_with(&workspace_dir) {
            Some("workspace".to_string())
        } else {
            Some("global".to_string())
        }
    };
    Ok(CustomPromptEntry {
        name,
        path: next_path.to_string_lossy().to_string(),
        description,
        argument_hint,
        content,
        scope,
    })
}

pub(crate) async fn prompts_delete_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    settings_path: &Path,
    workspace_id: String,
    path: String,
) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Ok(());
    }
    {
        let workspaces = workspaces.lock().await;
        let entry = require_workspace_entry(&workspaces, &workspace_id)?;
        let roots = prompt_roots_for_workspace(settings_path, &workspaces, &entry)?;
        ensure_path_within_roots(&target, &roots)?;
    }
    fs::remove_file(&target).map_err(|err| err.to_string())
}

pub(crate) async fn prompts_move_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    settings_path: &Path,
    workspace_id: String,
    path: String,
    scope: String,
) -> Result<CustomPromptEntry, String> {
    let target_path = PathBuf::from(&path);
    if !target_path.exists() {
        return Err("未找到提示词。".to_string());
    }
    let roots = {
        let workspaces = workspaces.lock().await;
        let entry = require_workspace_entry(&workspaces, &workspace_id)?;
        prompt_roots_for_workspace(settings_path, &workspaces, &entry)?
    };
    ensure_path_within_roots(&target_path, &roots)?;
    let file_name = target_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("提示词路径无效。".to_string())?;
    let target_dir = {
        let workspaces = workspaces.lock().await;
        let entry = require_workspace_entry(&workspaces, &workspace_id)?;
        match scope.as_str() {
            "workspace" => workspace_prompts_dir(settings_path, &entry)?,
            "global" => default_prompts_dir_for_workspace(&workspaces, &entry)
                .ok_or("无法解析 CODEX_HOME 目录。".to_string())?,
            _ => return Err("作用域无效。".to_string()),
        }
    };
    let next_path = target_dir.join(file_name);
    if next_path == target_path {
        return Err("提示词已在该作用域中。".to_string());
    }
    if next_path.exists() {
        return Err("同名提示词已存在。".to_string());
    }
    if let Some(parent) = next_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    move_file(&target_path, &next_path)?;
    let content = fs::read_to_string(&next_path).unwrap_or_default();
    let (description, argument_hint, body) = parse_frontmatter(&content);
    let name = next_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    Ok(CustomPromptEntry {
        name,
        path: next_path.to_string_lossy().to_string(),
        description,
        argument_hint,
        content: body,
        scope: Some(scope),
    })
}
