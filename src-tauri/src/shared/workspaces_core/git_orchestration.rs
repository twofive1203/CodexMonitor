use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::process::Stdio;

use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use crate::git_utils::resolve_git_root;
use crate::shared::process_core::tokio_command;
use crate::shared::{git_core, worktree_core};
use crate::types::WorkspaceEntry;

pub(crate) fn run_git_command_unit<F, Fut>(
    repo_path: &PathBuf,
    args: &[&str],
    run_git_command: F,
) -> impl Future<Output = Result<(), String>>
where
    F: Fn(PathBuf, Vec<String>) -> Fut,
    Fut: Future<Output = Result<String, String>>,
{
    let repo_path = repo_path.clone();
    let args_owned = args
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    async move {
        run_git_command(repo_path, args_owned)
            .await
            .map(|_output| ())
    }
}

pub(crate) async fn apply_worktree_changes_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<(), String> {
    let (entry, parent) = {
        let workspaces = workspaces.lock().await;
        let entry = workspaces
            .get(&workspace_id)
            .cloned()
            .ok_or_else(|| "未找到工作区。".to_string())?;
        if !entry.kind.is_worktree() {
            return Err("当前工作区不是工作树。".to_string());
        }
        let parent_id = entry
            .parent_id
            .clone()
            .ok_or_else(|| "未找到工作树父级工作区。".to_string())?;
        let parent = workspaces
            .get(&parent_id)
            .cloned()
            .ok_or_else(|| "未找到工作树父级工作区。".to_string())?;
        (entry, parent)
    };

    apply_worktree_changes_inner_core(&entry, &parent).await
}

pub(super) async fn apply_worktree_changes_inner_core(
    entry: &WorkspaceEntry,
    parent: &WorkspaceEntry,
) -> Result<(), String> {
    let worktree_root = resolve_git_root(entry)?;
    let parent_root = resolve_git_root(parent)?;

    let parent_status =
        git_core::run_git_command_bytes(&parent_root, &["status", "--porcelain"]).await?;
    if !String::from_utf8_lossy(&parent_status).trim().is_empty() {
        return Err(
            "当前分支有未提交的改动。请先提交、暂存或丢弃这些改动，再应用工作树改动。".to_string(),
        );
    }

    let mut patch: Vec<u8> = Vec::new();
    let staged_patch = git_core::run_git_diff(
        &worktree_root,
        &["diff", "--binary", "--no-color", "--cached"],
    )
    .await?;
    patch.extend_from_slice(&staged_patch);
    let unstaged_patch =
        git_core::run_git_diff(&worktree_root, &["diff", "--binary", "--no-color"]).await?;
    patch.extend_from_slice(&unstaged_patch);

    let untracked_output = git_core::run_git_command_bytes(
        &worktree_root,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )
    .await?;
    for raw_path in untracked_output.split(|byte| *byte == 0) {
        if raw_path.is_empty() {
            continue;
        }
        let path = String::from_utf8_lossy(raw_path).to_string();
        let diff = git_core::run_git_diff(
            &worktree_root,
            &[
                "diff",
                "--binary",
                "--no-color",
                "--no-index",
                "--",
                worktree_core::null_device_path(),
                &path,
            ],
        )
        .await?;
        patch.extend_from_slice(&diff);
    }

    if String::from_utf8_lossy(&patch).trim().is_empty() {
        return Err("没有可应用的改动。".to_string());
    }

    let git_bin = crate::utils::resolve_git_binary().map_err(|e| format!("执行 git 失败：{e}"))?;
    let mut child = tokio_command(git_bin)
        .args(["apply", "--3way", "--whitespace=nowarn", "-"])
        .current_dir(&parent_root)
        .env("PATH", crate::utils::git_env_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("执行 git 失败：{e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(&patch)
            .await
            .map_err(|e| format!("写入 git apply 输入失败：{e}"))?;
    }

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("执行 git 失败：{e}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    if detail.is_empty() {
        return Err("应用 Git 补丁失败。".to_string());
    }

    if detail.contains("Applied patch to") {
        if detail.contains("with conflicts") {
            return Err("补丁已应用，但存在冲突。请先在父仓库中解决冲突后再重试。".to_string());
        }
        return Err("补丁仅部分应用成功。请先在父仓库中处理相关改动后再重试。".to_string());
    }

    Err(detail.to_string())
}
