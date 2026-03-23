use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::env;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::timeout;

use crate::backend::events::{AppServerEvent, EventSink};
use crate::codex::args::parse_codex_args;
use crate::shared::claude_config_core::{self, ClaudeLaunchConfig};
use crate::shared::claude_sdk_core::{
    resolve_claude_sdk_entry_from_binary_path as resolve_claude_sdk_entry_from_binary_path_core,
    resolve_claude_sdk_entry_from_root as resolve_claude_sdk_entry_from_root_core,
    resolve_claude_sdk_entry_from_sdk_dir,
};
use crate::shared::process_core::{kill_child_process_tree, tokio_command};
use crate::types::{AgentProvider, WorkspaceEntry};

#[cfg(target_os = "windows")]
use crate::shared::process_core::{build_cmd_c_command, resolve_windows_executable};

#[cfg(test)]
const BUNDLED_CLAUDE_SDK_DIR: &str = crate::shared::claude_sdk_core::CLAUDE_SDK_DIR_NAME;

fn extract_thread_id(value: &Value) -> Option<String> {
    fn extract_from_container(container: Option<&Value>) -> Option<String> {
        let container = container?;
        container
            .get("threadId")
            .or_else(|| container.get("thread_id"))
            .and_then(|t| t.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                container
                    .get("thread")
                    .and_then(|thread| thread.get("id"))
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string())
            })
    }

    extract_from_container(value.get("params"))
        .or_else(|| extract_from_container(value.get("result")))
}

fn push_thread_id(out: &mut Vec<String>, value: Option<&Value>) {
    let Some(value) = value else {
        return;
    };
    if let Some(thread_id) = value.as_str().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        out.push(thread_id.to_string());
        return;
    }
    if let Some(values) = value.as_array() {
        for entry in values {
            push_thread_id(out, Some(entry));
        }
    }
}

fn extract_related_thread_ids(value: &Value) -> Vec<String> {
    fn collect_agent_thread_ids(value: Option<&Value>, out: &mut Vec<String>) {
        let Some(value) = value else {
            return;
        };
        if let Some(values) = value.as_array() {
            for entry in values {
                collect_agent_thread_ids(Some(entry), out);
            }
            return;
        }
        let Some(record) = value.as_object() else {
            return;
        };
        push_thread_id(
            out,
            record.get("threadId").or_else(|| record.get("thread_id")),
        );
        push_thread_id(out, record.get("id"));
        push_thread_id(
            out,
            record.get("thread").and_then(|thread| {
                thread
                    .get("id")
                    .or_else(|| thread.get("threadId"))
                    .or_else(|| thread.get("thread_id"))
            }),
        );
    }

    fn collect_from_container(container: Option<&Value>, out: &mut Vec<String>) {
        let Some(container) = container.and_then(|value| value.as_object()) else {
            return;
        };
        push_thread_id(
            out,
            container
                .get("threadId")
                .or_else(|| container.get("thread_id")),
        );
        push_thread_id(
            out,
            container.get("thread").and_then(|thread| thread.get("id")),
        );
        push_thread_id(
            out,
            container
                .get("params")
                .and_then(|params| params.get("threadId").or_else(|| params.get("thread_id"))),
        );
        push_thread_id(
            out,
            container
                .get("result")
                .and_then(|result| result.get("threadId").or_else(|| result.get("thread_id"))),
        );
        push_thread_id(
            out,
            container
                .get("newThreadId")
                .or_else(|| container.get("new_thread_id")),
        );
        push_thread_id(
            out,
            container
                .get("receiverThreadId")
                .or_else(|| container.get("receiver_thread_id")),
        );
        push_thread_id(
            out,
            container
                .get("receiverThreadIds")
                .or_else(|| container.get("receiver_thread_ids")),
        );
        collect_agent_thread_ids(
            container
                .get("receiverAgents")
                .or_else(|| container.get("receiver_agents")),
            out,
        );
        collect_agent_thread_ids(
            container
                .get("receiverAgent")
                .or_else(|| container.get("receiver_agent")),
            out,
        );
        collect_agent_thread_ids(
            container
                .get("agentStatuses")
                .or_else(|| container.get("agent_statuses")),
            out,
        );
        if let Some(status_map) = container
            .get("statuses")
            .and_then(|value| value.as_object())
        {
            out.extend(
                status_map
                    .keys()
                    .map(|key| key.trim().to_string())
                    .filter(|key| !key.is_empty()),
            );
        }
        if let Some(item) = container.get("item") {
            collect_from_container(Some(item), out);
        }
    }

    let mut out = Vec::new();
    collect_from_container(value.get("params"), &mut out);
    collect_from_container(value.get("result"), &mut out);
    collect_from_container(Some(value), &mut out);

    let mut seen = HashSet::new();
    out.into_iter()
        .filter(|thread_id| seen.insert(thread_id.clone()))
        .collect()
}

fn normalize_root_path(value: &str) -> String {
    let normalized = value.replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    if normalized.is_empty() {
        return String::new();
    }
    let lower = normalized.to_ascii_lowercase();
    let normalized = if lower.starts_with("//?/unc/") {
        format!("//{}", &normalized[8..])
    } else if lower.starts_with("//?/") || lower.starts_with("//./") {
        normalized[4..].to_string()
    } else {
        normalized.to_string()
    };
    if normalized.is_empty() {
        return String::new();
    }

    let bytes = normalized.as_bytes();
    let is_drive_path =
        bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/';
    if is_drive_path || normalized.starts_with("//") {
        normalized.to_ascii_lowercase()
    } else {
        normalized.to_string()
    }
}

#[derive(Debug, Clone)]
struct ThreadListEntry {
    thread_id: String,
    cwd: Option<String>,
    is_memory_consolidation: bool,
}

fn extract_thread_entries_from_thread_list_result(value: &Value) -> Vec<ThreadListEntry> {
    fn collect_entries(input: &Value, out: &mut Vec<ThreadListEntry>) {
        if let Some(values) = input.as_array() {
            for value in values {
                collect_entries(value, out);
            }
            return;
        }
        let Some(object) = input.as_object() else {
            return;
        };

        let cwd = object
            .get("cwd")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
            .or_else(|| {
                object
                    .get("thread")
                    .and_then(|thread| thread.get("cwd"))
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string())
            });

        let thread_id = object
            .get("threadId")
            .or_else(|| object.get("thread_id"))
            .or_else(|| object.get("id"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
            .or_else(|| {
                object
                    .get("thread")
                    .and_then(|thread| thread.get("id"))
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string())
            });
        if let Some(thread_id) = thread_id {
            let source = object
                .get("source")
                .or_else(|| object.get("thread").and_then(|thread| thread.get("source")));
            let is_memory_consolidation = source
                .and_then(source_subagent_kind)
                .is_some_and(|kind| kind == "memory_consolidation");
            out.push(ThreadListEntry {
                thread_id,
                cwd,
                is_memory_consolidation,
            });
        }

        for key in ["threads", "items", "results", "data"] {
            if let Some(values) = object.get(key).and_then(|value| value.as_array()) {
                for value in values {
                    collect_entries(value, out);
                }
            }
        }
    }

    let mut out = Vec::new();
    if let Some(result) = value.get("result") {
        collect_entries(result, &mut out);
    }
    out
}

fn resolve_workspace_for_cwd(
    cwd: &str,
    workspace_roots: &HashMap<String, String>,
) -> Option<String> {
    let normalized_cwd = normalize_root_path(cwd);
    if normalized_cwd.is_empty() {
        return None;
    }
    workspace_roots
        .iter()
        .filter_map(|(workspace_id, root)| {
            if root.is_empty() {
                return None;
            }
            let is_exact_match = root == &normalized_cwd;
            let is_nested_match = normalized_cwd.len() > root.len()
                && normalized_cwd.starts_with(root)
                && normalized_cwd.as_bytes().get(root.len()) == Some(&b'/');
            if is_exact_match || is_nested_match {
                Some((workspace_id, root.len()))
            } else {
                None
            }
        })
        .max_by_key(|(_, root_len)| *root_len)
        .map(|(workspace_id, _)| workspace_id.clone())
}

fn normalize_subagent_kind(value: &str) -> String {
    let mut normalized = value.trim().to_ascii_lowercase().replace([' ', '-'], "_");
    if let Some(stripped) = normalized.strip_prefix("subagent_") {
        normalized = stripped.to_string();
    } else if let Some(stripped) = normalized.strip_prefix("sub_agent_") {
        normalized = stripped.to_string();
    }
    normalized
}

fn source_subagent_kind(source: &Value) -> Option<String> {
    if let Some(raw) = source.as_str() {
        let normalized = normalize_subagent_kind(raw);
        return if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        };
    }
    let source_obj = source.as_object()?;
    let sub_agent = source_obj
        .get("subAgent")
        .or_else(|| source_obj.get("sub_agent"))
        .or_else(|| source_obj.get("subagent"))?;

    if let Some(raw) = sub_agent.as_str() {
        let normalized = normalize_subagent_kind(raw);
        return if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        };
    }
    let sub_agent_obj = sub_agent.as_object()?;
    if let Some(explicit) = sub_agent_obj
        .get("kind")
        .or_else(|| sub_agent_obj.get("type"))
        .or_else(|| sub_agent_obj.get("name"))
        .or_else(|| sub_agent_obj.get("id"))
        .and_then(Value::as_str)
    {
        let normalized = normalize_subagent_kind(explicit);
        return if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        };
    }

    let candidate_keys: Vec<&String> = sub_agent_obj
        .keys()
        .filter(|key| key.as_str() != "thread_spawn" && key.as_str() != "threadSpawn")
        .collect();
    if candidate_keys.len() != 1 {
        return None;
    }
    let normalized = normalize_subagent_kind(candidate_keys[0]);
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn thread_started_is_memory_consolidation(value: &Value) -> bool {
    value
        .get("params")
        .and_then(|params| {
            params
                .get("thread")
                .and_then(|thread| thread.get("source"))
                .or_else(|| params.get("source"))
        })
        .and_then(source_subagent_kind)
        .is_some_and(|kind| kind == "memory_consolidation")
}

fn should_suppress_hidden_thread_event(
    method_name: Option<&str>,
    has_result_or_error: bool,
) -> bool {
    let allows_response_required = method_name.is_some_and(|method| {
        method == "item/tool/requestUserInput" || method.ends_with("requestApproval")
    });
    !has_result_or_error
        && !allows_response_required
        && !matches!(
            method_name,
            Some("thread/archived") | Some("codex/backgroundThread")
        )
}

fn is_global_workspace_notification(method: &str) -> bool {
    matches!(
        method,
        "account/updated" | "account/rateLimits/updated" | "account/login/completed"
    )
}

fn should_broadcast_global_workspace_notification(
    method_name: Option<&str>,
    thread_id: Option<&String>,
    request_workspace: Option<&str>,
) -> bool {
    method_name.is_some_and(is_global_workspace_notification)
        && thread_id.is_none()
        && request_workspace.is_none()
}

#[derive(Clone)]
pub(crate) struct RequestContext {
    workspace_id: String,
    method: String,
}

fn build_initialize_params(client_version: &str) -> Value {
    json!({
        "clientInfo": {
            "name": "codex_monitor",
            "title": "Codex Monitor",
            "version": client_version
        },
        "capabilities": {
            "experimentalApi": true
        }
    })
}

const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);

fn extract_response_error_message(value: &Value) -> Option<String> {
    let error = value.get("error")?;
    if let Some(message) = error
        .get("message")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
    {
        return Some(message.to_string());
    }
    if let Some(message) = error
        .as_str()
        .map(str::trim)
        .filter(|message| !message.is_empty())
    {
        return Some(message.to_string());
    }
    Some("请求失败。".to_string())
}

pub(crate) struct WorkspaceSession {
    pub(crate) codex_args: Option<String>,
    pub(crate) child: Mutex<Child>,
    pub(crate) stdin: Mutex<ChildStdin>,
    pub(crate) pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    pub(crate) request_context: Mutex<HashMap<u64, RequestContext>>,
    pub(crate) thread_workspace: Mutex<HashMap<String, String>>,
    pub(crate) hidden_thread_ids: Mutex<HashSet<String>>,
    pub(crate) next_id: AtomicU64,
    /// Callbacks for background threads - events for these threadIds are sent through the channel
    pub(crate) background_thread_callbacks: Mutex<HashMap<String, mpsc::UnboundedSender<Value>>>,
    pub(crate) owner_workspace_id: String,
    pub(crate) workspace_ids: Mutex<HashSet<String>>,
    pub(crate) workspace_roots: Mutex<HashMap<String, String>>,
}

impl WorkspaceSession {
    pub(crate) async fn register_workspace(&self, workspace_id: &str) {
        self.register_workspace_with_path(workspace_id, None).await;
    }

    pub(crate) async fn register_workspace_with_path(
        &self,
        workspace_id: &str,
        workspace_path: Option<&str>,
    ) {
        self.workspace_ids
            .lock()
            .await
            .insert(workspace_id.to_string());
        if let Some(path) = workspace_path {
            let normalized = normalize_root_path(path);
            if !normalized.is_empty() {
                self.workspace_roots
                    .lock()
                    .await
                    .insert(workspace_id.to_string(), normalized);
            }
        }
    }

    pub(crate) async fn unregister_workspace(&self, workspace_id: &str) {
        self.workspace_ids.lock().await.remove(workspace_id);
        self.workspace_roots.lock().await.remove(workspace_id);
    }

    pub(crate) async fn workspace_ids_snapshot(&self) -> Vec<String> {
        self.workspace_ids.lock().await.iter().cloned().collect()
    }

    async fn write_message(&self, value: Value) -> Result<(), String> {
        let mut stdin = self.stdin.lock().await;
        let mut line = serde_json::to_string(&value).map_err(|e| e.to_string())?;
        line.push('\n');
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| e.to_string())
    }

    pub(crate) async fn send_request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.send_request_for_workspace(self.owner_workspace_id.as_str(), method, params)
            .await
    }

    pub(crate) async fn send_request_for_workspace(
        &self,
        workspace_id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.register_workspace(workspace_id).await;
        self.pending.lock().await.insert(id, tx);
        self.request_context.lock().await.insert(
            id,
            RequestContext {
                workspace_id: workspace_id.to_string(),
                method: method.to_string(),
            },
        );
        if let Some(thread_id) = extract_thread_id(&json!({ "params": params.clone() })) {
            self.thread_workspace
                .lock()
                .await
                .insert(thread_id, workspace_id.to_string());
        }
        if let Err(error) = self
            .write_message(json!({ "id": id, "method": method, "params": params }))
            .await
        {
            self.pending.lock().await.remove(&id);
            self.request_context.lock().await.remove(&id);
            return Err(error);
        }
        match timeout(REQUEST_TIMEOUT, rx).await {
            Ok(Ok(value)) => {
                if let Some(message) = extract_response_error_message(&value) {
                    return Err(message);
                }
                Ok(value)
            }
            Ok(Err(_)) => Err("请求已取消。".to_string()),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                self.request_context.lock().await.remove(&id);
                Err(format!("请求超时（{} 秒）。", REQUEST_TIMEOUT.as_secs()))
            }
        }
    }

    pub(crate) async fn send_notification(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), String> {
        let value = if let Some(params) = params {
            json!({ "method": method, "params": params })
        } else {
            json!({ "method": method })
        };
        self.write_message(value).await
    }

    pub(crate) async fn send_response(&self, id: Value, result: Value) -> Result<(), String> {
        self.write_message(json!({ "id": id, "result": result }))
            .await
    }
}

pub(crate) fn build_codex_path_env(codex_bin: Option<&str>) -> Option<String> {
    let mut paths: Vec<PathBuf> = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect())
        .unwrap_or_default();

    let mut extras: Vec<PathBuf> = Vec::new();

    #[cfg(not(target_os = "windows"))]
    {
        extras.extend(
            [
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "/usr/bin",
                "/bin",
                "/usr/sbin",
                "/sbin",
            ]
            .into_iter()
            .map(PathBuf::from),
        );

        if let Ok(home) = env::var("HOME") {
            let home_path = Path::new(&home);
            extras.push(home_path.join(".local/bin"));
            extras.push(home_path.join(".local/share/mise/shims"));
            extras.push(home_path.join(".cargo/bin"));
            extras.push(home_path.join(".bun/bin"));
            let nvm_root = home_path.join(".nvm/versions/node");
            if let Ok(entries) = std::fs::read_dir(nvm_root) {
                for entry in entries.flatten() {
                    let bin_path = entry.path().join("bin");
                    if bin_path.is_dir() {
                        extras.push(bin_path);
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = env::var("APPDATA") {
            extras.push(Path::new(&appdata).join("npm"));
        }
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            extras.push(
                Path::new(&local_app_data)
                    .join("Microsoft")
                    .join("WindowsApps"),
            );
        }
        if let Ok(home) = env::var("USERPROFILE").or_else(|_| env::var("HOME")) {
            let home_path = Path::new(&home);
            extras.push(home_path.join(".cargo").join("bin"));
            extras.push(home_path.join("scoop").join("shims"));
        }
        if let Ok(program_data) = env::var("PROGRAMDATA") {
            extras.push(Path::new(&program_data).join("chocolatey").join("bin"));
        }
    }

    if let Some(bin_path) = codex_bin.filter(|value| !value.trim().is_empty()) {
        if let Some(parent) = Path::new(bin_path).parent() {
            extras.push(parent.to_path_buf());
        }
    }

    for extra in extras {
        if !paths.iter().any(|path| path == &extra) {
            paths.push(extra);
        }
    }

    if paths.is_empty() {
        return None;
    }

    env::join_paths(paths)
        .ok()
        .map(|joined| joined.to_string_lossy().to_string())
}

fn build_cli_command_with_bin(
    bin_override: Option<String>,
    default_bin: &str,
    command_args: Vec<String>,
) -> Result<Command, String> {
    let bin = bin_override
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_bin.to_string());
    let path_env = build_codex_path_env(bin_override.as_deref());

    #[cfg(target_os = "windows")]
    let mut command = {
        let bin_trimmed = bin.trim();
        let resolved = resolve_windows_executable(bin_trimmed, path_env.as_deref());
        let resolved_path = resolved
            .as_deref()
            .unwrap_or_else(|| Path::new(bin_trimmed));
        let ext = resolved_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase());

        if matches!(ext.as_deref(), Some("cmd") | Some("bat")) {
            let mut command = tokio_command("cmd");
            let command_line = build_cmd_c_command(resolved_path, &command_args)?;
            command.arg("/D");
            command.arg("/S");
            command.arg("/C");
            command.raw_arg(command_line);
            command
        } else {
            let mut command = tokio_command(resolved_path);
            command.args(command_args);
            command
        }
    };

    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut command = tokio_command(bin.trim());
        command.args(command_args);
        command
    };

    if let Some(path_env) = path_env {
        command.env("PATH", path_env);
    }
    Ok(command)
}

pub(crate) fn build_codex_command_with_bin(
    codex_bin: Option<String>,
    codex_args: Option<&str>,
    args: Vec<String>,
) -> Result<Command, String> {
    let mut command_args = parse_codex_args(codex_args)?;
    command_args.extend(args);
    build_cli_command_with_bin(codex_bin, "codex", command_args)
}

pub(crate) async fn check_codex_installation(
    codex_bin: Option<String>,
) -> Result<Option<String>, String> {
    let mut command = build_codex_command_with_bin(codex_bin, None, vec!["--version".to_string()])?;
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    let output = match timeout(Duration::from_secs(5), command.output()).await {
        Ok(result) => result.map_err(|e| {
            if e.kind() == ErrorKind::NotFound {
                "未找到 Codex CLI。请安装 Codex，并确认 `codex` 已加入 PATH。".to_string()
            } else {
                e.to_string()
            }
        })?,
        Err(_) => {
            return Err("检查 Codex CLI 超时。请确认能在终端执行 `codex --version`。".to_string());
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        if detail.is_empty() {
            return Err("Codex CLI 启动失败。请尝试在终端执行 `codex --version`。".to_string());
        }
        return Err(format!(
            "Codex CLI 启动失败：{detail}。请尝试在终端执行 `codex --version`。"
        ));
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(if version.is_empty() {
        None
    } else {
        Some(version)
    })
}

async fn check_node_installation() -> Result<Option<String>, String> {
    let mut command = build_cli_command_with_bin(None, "node", vec!["--version".to_string()])?;
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    let output = match timeout(Duration::from_secs(5), command.output()).await {
        Ok(result) => result.map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                "未找到 Node.js。请确认本机已安装 Node.js 18+。".to_string()
            } else {
                error.to_string()
            }
        })?,
        Err(_) => {
            return Err("检查 Node.js 超时。请确认能在终端执行 `node --version`。".to_string());
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        if detail.is_empty() {
            return Err("Node.js 启动失败。请尝试在终端执行 `node --version`。".to_string());
        }
        return Err(format!(
            "Node.js 启动失败：{detail}。请尝试在终端执行 `node --version`。"
        ));
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(if version.is_empty() {
        None
    } else {
        Some(version)
    })
}

/// 从指定项目根目录解析 Claude SDK 入口路径。
///
/// `project_root`：仓库根目录，用于定位 `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`。
fn resolve_claude_sdk_entry_from_root(project_root: &Path) -> Result<PathBuf, String> {
    resolve_claude_sdk_entry_from_root_core(project_root)
}

/// 从当前二进制路径附近解析打包后的 Claude SDK 入口。
///
/// `binary_path`：当前 app 或 daemon 可执行文件绝对路径。
fn resolve_claude_sdk_entry_from_binary_path(binary_path: &Path) -> Result<PathBuf, String> {
    resolve_claude_sdk_entry_from_binary_path_core(binary_path)
}

/// 解析当前运行环境中的 Claude SDK 入口路径。
///
/// `claude_sdk_dir`：应用数据目录中的 Claude SDK 根目录，可为空。
///
/// 优先读取应用数据目录中的 Claude SDK，失败后回退到源码仓库 `node_modules`，最后兼容旧安装包资源目录。
fn resolve_claude_sdk_entry_path(claude_sdk_dir: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(sdk_dir) = claude_sdk_dir {
        match resolve_claude_sdk_entry_from_sdk_dir(sdk_dir) {
            Ok(path) => return Ok(path),
            Err(app_data_error) if sdk_dir.exists() => {
                return Err(format!(
                    "应用数据目录中的 Claude SDK 不可用（{}）。请在设置中重新下载 Claude SDK。原始错误：{app_data_error}",
                    sdk_dir.display()
                ));
            }
            Err(_) => {}
        }
    }

    let project_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    match resolve_claude_sdk_entry_from_root(&project_root) {
        Ok(path) => Ok(path),
        Err(project_error) => {
            let bundled_error = std::env::current_exe()
                .map_err(|error| format!("读取当前二进制路径失败：{error}"))
                .and_then(|binary_path| resolve_claude_sdk_entry_from_binary_path(&binary_path));

            match bundled_error {
                Ok(path) => Ok(path),
                Err(bundle_error) => Err(format!(
                    "{project_error} 如果当前运行的是安装包，请先在设置中下载 Claude SDK。{bundle_error}"
                )),
            }
        }
    }
}

fn ensure_claude_sidecar_script() -> Result<PathBuf, String> {
    const CLAUDE_SDK_SIDECAR_SOURCE: &str = include_str!("../../resources/claude_sdk_sidecar.mjs");

    let sidecar_dir = env::temp_dir().join("codex-monitor");
    std::fs::create_dir_all(&sidecar_dir)
        .map_err(|error| format!("创建 Claude sidecar 临时目录失败：{error}"))?;
    let sidecar_path = sidecar_dir.join("claude_sdk_sidecar.mjs");
    std::fs::write(&sidecar_path, CLAUDE_SDK_SIDECAR_SOURCE)
        .map_err(|error| format!("写入 Claude sidecar 临时脚本失败：{error}"))?;
    Ok(sidecar_path)
}

fn build_claude_sidecar_command(sidecar_path: &Path) -> Result<Command, String> {
    build_cli_command_with_bin(
        None,
        "node",
        vec![sidecar_path.to_string_lossy().to_string()],
    )
}

/// 构造 Claude sidecar 需要注入的环境变量。
///
/// `sdk_entry_path`：Claude SDK 入口脚本路径。
/// `launch_config`：从 Claude 本地配置读取的启动配置。
/// `default_provider_bin`：设置页里配置的 Claude 可执行文件路径。
/// `provider_runtime_args`：设置页里配置的 Claude 运行参数。
/// `claude_permission_mode`：设置页里配置的权限模式，优先级高于本地配置。
/// `client_version`：当前客户端版本号。
fn build_claude_sidecar_env(
    sdk_entry_path: &Path,
    launch_config: &ClaudeLaunchConfig,
    default_provider_bin: Option<&str>,
    provider_runtime_args: Option<&str>,
    claude_permission_mode: Option<&str>,
    client_version: &str,
) -> Result<HashMap<String, String>, String> {
    let mut envs = HashMap::from([(
        "CLAUDE_MONITOR_SDK_ENTRY".to_string(),
        sdk_entry_path.to_string_lossy().to_string(),
    )]);

    if let Some(config_dir) = launch_config.config_dir.as_ref() {
        envs.insert(
            "CLAUDE_CONFIG_DIR".to_string(),
            config_dir.to_string_lossy().to_string(),
        );
    }
    if let Some(claude_bin) = default_provider_bin
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        envs.insert(
            "CLAUDE_MONITOR_PROVIDER_BIN".to_string(),
            claude_bin.to_string(),
        );
    }
    if let Some(runtime_args) = provider_runtime_args
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        envs.insert(
            "CLAUDE_MONITOR_PROVIDER_ARGS".to_string(),
            runtime_args.to_string(),
        );
    }

    let explicit_permission_mode = claude_permission_mode
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let effective_permission_mode = if let Some(explicit_permission_mode) = explicit_permission_mode
    {
        let normalized =
            claude_config_core::normalize_permission_mode(Some(explicit_permission_mode.clone()));
        let Some(normalized_permission_mode) = normalized else {
            return Err(format!(
                "Claude 权限模式无效：{explicit_permission_mode}。可选值：default、acceptEdits、plan、dontAsk、bypassPermissions。"
            ));
        };
        Some(normalized_permission_mode)
    } else {
        launch_config.permission_mode.clone()
    };
    if let Some(permission_mode) = effective_permission_mode {
        envs.insert(
            "CLAUDE_MONITOR_PERMISSION_MODE".to_string(),
            permission_mode,
        );
    }
    if let Some(default_model) = launch_config.default_model.as_deref() {
        envs.insert(
            "CLAUDE_MONITOR_DEFAULT_MODEL".to_string(),
            default_model.to_string(),
        );
    }
    for (key, value) in &launch_config.env_overrides {
        envs.insert(key.clone(), value.clone());
    }
    envs.insert(
        "CLAUDE_MONITOR_CLIENT_VERSION".to_string(),
        client_version.to_string(),
    );
    Ok(envs)
}

pub(crate) async fn spawn_workspace_session<E: EventSink>(
    entry: WorkspaceEntry,
    default_provider_bin: Option<String>,
    provider_runtime_args: Option<String>,
    provider_runtime_home: Option<PathBuf>,
    claude_sdk_dir: Option<PathBuf>,
    claude_permission_mode: Option<String>,
    claude_use_sdk_sidecar: bool,
    client_version: String,
    event_sink: E,
) -> Result<Arc<WorkspaceSession>, String> {
    let mut command = match entry.provider {
        AgentProvider::Codex => {
            let codex_bin = default_provider_bin.clone();
            let _ = check_codex_installation(codex_bin.clone()).await?;
            let mut command = build_codex_command_with_bin(
                codex_bin,
                provider_runtime_args.as_deref(),
                vec!["app-server".to_string()],
            )?;
            if let Some(path) = provider_runtime_home.as_ref() {
                command.env("CODEX_HOME", path);
            }
            command
        }
        AgentProvider::Claude => {
            if !claude_use_sdk_sidecar {
                return Err(
                    "当前仅支持 Claude SDK sidecar，请在设置中开启 claudeUseSdkSidecar。"
                        .to_string(),
                );
            }
            let launch_config = claude_config_core::read_launch_config()?;
            let sdk_entry_path = resolve_claude_sdk_entry_path(claude_sdk_dir.as_deref())?;
            let sidecar_env = build_claude_sidecar_env(
                &sdk_entry_path,
                &launch_config,
                default_provider_bin.as_deref(),
                provider_runtime_args.as_deref(),
                claude_permission_mode.as_deref(),
                &client_version,
            )?;
            let _ = check_node_installation().await?;
            let sidecar_path = ensure_claude_sidecar_script()?;
            let mut command = build_claude_sidecar_command(&sidecar_path)?;
            for (key, value) in sidecar_env {
                command.env(key, value);
            }
            command
        }
    };
    command.current_dir(&entry.path);
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let stdin = child.stdin.take().ok_or("缺少 stdin。")?;
    let stdout = child.stdout.take().ok_or("缺少 stdout。")?;
    let stderr = child.stderr.take().ok_or("缺少 stderr。")?;

    let session = Arc::new(WorkspaceSession {
        codex_args: provider_runtime_args,
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        pending: Mutex::new(HashMap::new()),
        request_context: Mutex::new(HashMap::new()),
        thread_workspace: Mutex::new(HashMap::new()),
        hidden_thread_ids: Mutex::new(HashSet::new()),
        next_id: AtomicU64::new(1),
        background_thread_callbacks: Mutex::new(HashMap::new()),
        owner_workspace_id: entry.id.clone(),
        workspace_ids: Mutex::new(HashSet::from([entry.id.clone()])),
        workspace_roots: Mutex::new(HashMap::from([(
            entry.id.clone(),
            normalize_root_path(&entry.path),
        )])),
    });

    let session_clone = Arc::clone(&session);
    let fallback_workspace_id = entry.id.clone();
    let event_sink_clone = event_sink.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let value: Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(err) => {
                    let payload = AppServerEvent {
                        workspace_id: fallback_workspace_id.clone(),
                        message: json!({
                            "method": "codex/parseError",
                            "params": { "error": err.to_string(), "raw": line },
                        }),
                    };
                    event_sink_clone.emit_app_server_event(payload);
                    continue;
                }
            };

            let maybe_id = value.get("id").and_then(|id| id.as_u64());
            let has_method = value.get("method").is_some();
            let has_result_or_error = value.get("result").is_some() || value.get("error").is_some();
            let method_name = value.get("method").and_then(|method| method.as_str());

            // Check if this event is for a background thread
            let thread_id = extract_thread_id(&value);
            let mut request_workspace: Option<String> = None;
            let mut request_method: Option<String> = None;
            if let Some(id) = maybe_id {
                if has_result_or_error {
                    if let Some(context) = session_clone.request_context.lock().await.remove(&id) {
                        request_workspace = Some(context.workspace_id);
                        request_method = Some(context.method);
                    }
                }
            }

            if let Some(ref workspace_id) = request_workspace {
                let related_thread_ids = extract_related_thread_ids(&value);
                if !related_thread_ids.is_empty() {
                    let mut thread_workspace = session_clone.thread_workspace.lock().await;
                    for tid in related_thread_ids {
                        thread_workspace.insert(tid, workspace_id.clone());
                    }
                } else if let Some(ref tid) = thread_id {
                    session_clone
                        .thread_workspace
                        .lock()
                        .await
                        .insert(tid.clone(), workspace_id.clone());
                }
            }
            if matches!(request_method.as_deref(), Some("thread/list")) {
                let thread_entries = extract_thread_entries_from_thread_list_result(&value);
                if !thread_entries.is_empty() {
                    let workspace_roots = session_clone.workspace_roots.lock().await.clone();
                    let mut hidden_thread_ids = Vec::new();
                    let mut thread_workspace = session_clone.thread_workspace.lock().await;
                    for entry in thread_entries {
                        if entry.is_memory_consolidation {
                            thread_workspace.remove(&entry.thread_id);
                            hidden_thread_ids.push(entry.thread_id);
                            continue;
                        }
                        let mapped_workspace = entry
                            .cwd
                            .as_deref()
                            .and_then(|cwd| resolve_workspace_for_cwd(cwd, &workspace_roots));
                        if let Some(workspace_id) = mapped_workspace {
                            thread_workspace.insert(entry.thread_id, workspace_id);
                        }
                    }
                    drop(thread_workspace);
                    if !hidden_thread_ids.is_empty() {
                        let mut hidden = session_clone.hidden_thread_ids.lock().await;
                        for thread_id in hidden_thread_ids {
                            hidden.insert(thread_id);
                        }
                    }
                }
            }

            let mapped_thread_workspace = if let Some(ref tid) = thread_id {
                session_clone
                    .thread_workspace
                    .lock()
                    .await
                    .get(tid)
                    .cloned()
            } else {
                None
            };

            let routed_workspace_id = mapped_thread_workspace
                .or_else(|| request_workspace.clone())
                .unwrap_or_else(|| fallback_workspace_id.clone());

            if let Some(ref tid) = thread_id {
                if method_name == Some("codex/backgroundThread") {
                    let action = value
                        .get("params")
                        .and_then(|params| params.get("action"))
                        .and_then(Value::as_str)
                        .unwrap_or("hide");
                    if action.eq_ignore_ascii_case("hide") {
                        session_clone
                            .hidden_thread_ids
                            .lock()
                            .await
                            .insert(tid.clone());
                    }
                } else if method_name == Some("thread/started")
                    && thread_started_is_memory_consolidation(&value)
                {
                    session_clone
                        .hidden_thread_ids
                        .lock()
                        .await
                        .insert(tid.clone());
                    let payload = AppServerEvent {
                        workspace_id: routed_workspace_id.clone(),
                        message: json!({
                            "method": "codex/backgroundThread",
                            "params": {
                                "threadId": tid,
                                "action": "hide"
                            }
                        }),
                    };
                    event_sink_clone.emit_app_server_event(payload);
                    continue;
                }

                let should_suppress_hidden_thread = {
                    let hidden = session_clone.hidden_thread_ids.lock().await;
                    hidden.contains(tid)
                };
                if should_suppress_hidden_thread
                    && should_suppress_hidden_thread_event(method_name, has_result_or_error)
                {
                    continue;
                }
            }

            if matches!(method_name, Some("item/started") | Some("item/completed")) {
                let related_thread_ids = extract_related_thread_ids(&value);
                if !related_thread_ids.is_empty() {
                    let mut thread_workspace = session_clone.thread_workspace.lock().await;
                    for related_id in related_thread_ids {
                        thread_workspace
                            .entry(related_id)
                            .or_insert_with(|| routed_workspace_id.clone());
                    }
                }
            }

            if method_name == Some("thread/archived") {
                if let Some(ref tid) = thread_id {
                    session_clone.thread_workspace.lock().await.remove(tid);
                    session_clone.hidden_thread_ids.lock().await.remove(tid);
                }
            }

            if let Some(id) = maybe_id {
                if has_result_or_error {
                    if let Some(tx) = session_clone.pending.lock().await.remove(&id) {
                        let _ = tx.send(value);
                    }
                } else if has_method {
                    // Check for background thread callback
                    let mut sent_to_background = false;
                    if let Some(ref tid) = thread_id {
                        let callbacks = session_clone.background_thread_callbacks.lock().await;
                        if let Some(tx) = callbacks.get(tid) {
                            let _ = tx.send(value.clone());
                            sent_to_background = true;
                        }
                    }
                    // Don't emit to frontend if this is a background thread event
                    if !sent_to_background {
                        if should_broadcast_global_workspace_notification(
                            method_name,
                            thread_id.as_ref(),
                            request_workspace.as_deref(),
                        ) {
                            let workspace_ids = session_clone.workspace_ids_snapshot().await;
                            if workspace_ids.is_empty() {
                                let payload = AppServerEvent {
                                    workspace_id: routed_workspace_id.clone(),
                                    message: value,
                                };
                                event_sink_clone.emit_app_server_event(payload);
                            } else {
                                for workspace_id in workspace_ids {
                                    let payload = AppServerEvent {
                                        workspace_id,
                                        message: value.clone(),
                                    };
                                    event_sink_clone.emit_app_server_event(payload);
                                }
                            }
                        } else {
                            let payload = AppServerEvent {
                                workspace_id: routed_workspace_id.clone(),
                                message: value,
                            };
                            event_sink_clone.emit_app_server_event(payload);
                        }
                    }
                } else if let Some(tx) = session_clone.pending.lock().await.remove(&id) {
                    let _ = tx.send(value);
                }
            } else if has_method {
                // Check for background thread callback
                let mut sent_to_background = false;
                if let Some(ref tid) = thread_id {
                    let callbacks = session_clone.background_thread_callbacks.lock().await;
                    if let Some(tx) = callbacks.get(tid) {
                        let _ = tx.send(value.clone());
                        sent_to_background = true;
                    }
                }
                // Don't emit to frontend if this is a background thread event
                if !sent_to_background {
                    if should_broadcast_global_workspace_notification(
                        method_name,
                        thread_id.as_ref(),
                        request_workspace.as_deref(),
                    ) {
                        let workspace_ids = session_clone.workspace_ids_snapshot().await;
                        if workspace_ids.is_empty() {
                            let payload = AppServerEvent {
                                workspace_id: routed_workspace_id,
                                message: value,
                            };
                            event_sink_clone.emit_app_server_event(payload);
                        } else {
                            for workspace_id in workspace_ids {
                                let payload = AppServerEvent {
                                    workspace_id,
                                    message: value.clone(),
                                };
                                event_sink_clone.emit_app_server_event(payload);
                            }
                        }
                    } else {
                        let payload = AppServerEvent {
                            workspace_id: routed_workspace_id,
                            message: value,
                        };
                        event_sink_clone.emit_app_server_event(payload);
                    }
                }
            }
        }

        // Ensure pending foreground requests cannot accumulate after process output ends.
        session_clone.pending.lock().await.clear();
        session_clone.request_context.lock().await.clear();
    });

    let workspace_id = entry.id.clone();
    let event_sink_clone = event_sink.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let payload = AppServerEvent {
                workspace_id: workspace_id.clone(),
                message: json!({
                    "method": "codex/stderr",
                    "params": { "message": line },
                }),
            };
            event_sink_clone.emit_app_server_event(payload);
        }
    });

    let init_params = build_initialize_params(&client_version);
    let init_result = timeout(
        Duration::from_secs(15),
        session.send_request("initialize", init_params),
    )
    .await;
    let init_response = match init_result {
        Ok(response) => response,
        Err(_) => {
            let mut child = session.child.lock().await;
            kill_child_process_tree(&mut child).await;
            return Err(
                "Codex app-server did not respond to initialize. Check that `codex app-server` works in Terminal."
                    .to_string(),
            );
        }
    };
    init_response?;
    session.send_notification("initialized", None).await?;

    let payload = AppServerEvent {
        workspace_id: entry.id.clone(),
        message: json!({
            "method": "codex/connected",
            "params": { "workspaceId": entry.id.clone() }
        }),
    };
    event_sink.emit_app_server_event(payload);

    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::{
        build_claude_sidecar_env, build_initialize_params, ensure_claude_sidecar_script,
        extract_related_thread_ids, extract_thread_entries_from_thread_list_result,
        extract_thread_id, normalize_root_path, resolve_claude_sdk_entry_from_binary_path,
        resolve_claude_sdk_entry_from_root, resolve_workspace_for_cwd,
        should_broadcast_global_workspace_notification, should_suppress_hidden_thread_event,
        source_subagent_kind, spawn_workspace_session, thread_started_is_memory_consolidation,
        WorkspaceSession, BUNDLED_CLAUDE_SDK_DIR,
    };
    use crate::shared::claude_config_core::ClaudeLaunchConfig;
    use crate::types::WorkspaceEntry;
    use serde_json::json;
    use std::collections::{BTreeMap, HashMap};
    use std::future::Future;
    use std::path::PathBuf;
    use std::process::Stdio;
    use std::sync::atomic::AtomicU64;
    use std::sync::Arc;
    use tokio::process::Command;
    use tokio::sync::Mutex;

    /// 运行异步 app-server 测试。
    ///
    /// `future`：待执行的异步测试逻辑。
    fn run_async_test<F>(future: F)
    where
        F: Future<Output = ()>,
    {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(future);
    }

    /// 创建用于 session 单测的最小会话实例。
    ///
    /// `owner_workspace_id`：会话归属的 workspace ID。
    async fn make_test_session(owner_workspace_id: &str) -> Arc<WorkspaceSession> {
        let mut command = if cfg!(windows) {
            let mut command = Command::new("cmd");
            command.args(["/C", "more"]);
            command
        } else {
            let mut command = Command::new("sh");
            command.args(["-c", "cat"]);
            command
        };
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = command.spawn().expect("spawn dummy child");
        let stdin = child.stdin.take().expect("take stdin");

        Arc::new(WorkspaceSession {
            codex_args: None,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            request_context: Mutex::new(HashMap::new()),
            thread_workspace: Mutex::new(HashMap::new()),
            hidden_thread_ids: Mutex::new(std::collections::HashSet::new()),
            next_id: AtomicU64::new(1),
            background_thread_callbacks: Mutex::new(HashMap::new()),
            owner_workspace_id: owner_workspace_id.to_string(),
            workspace_ids: Mutex::new(std::collections::HashSet::from([
                owner_workspace_id.to_string()
            ])),
            workspace_roots: Mutex::new(HashMap::new()),
        })
    }

    #[derive(Clone)]
    struct NoopEventSink;

    impl crate::backend::events::EventSink for NoopEventSink {
        fn emit_app_server_event(&self, _event: crate::backend::events::AppServerEvent) {}

        fn emit_terminal_output(&self, _event: crate::backend::events::TerminalOutput) {}

        fn emit_terminal_exit(&self, _event: crate::backend::events::TerminalExit) {}
    }

    #[test]
    fn extract_thread_id_reads_camel_case() {
        let value = json!({ "params": { "threadId": "thread-123" } });
        assert_eq!(extract_thread_id(&value), Some("thread-123".to_string()));
    }

    #[test]
    fn extract_thread_id_reads_snake_case() {
        let value = json!({ "params": { "thread_id": "thread-456" } });
        assert_eq!(extract_thread_id(&value), Some("thread-456".to_string()));
    }

    #[test]
    fn extract_thread_id_reads_hook_notification_thread_id() {
        let value = json!({
            "method": "hook/started",
            "params": {
                "threadId": "thread-hook-1",
                "run": { "id": "hook-1" }
            }
        });
        assert_eq!(extract_thread_id(&value), Some("thread-hook-1".to_string()));
    }

    #[test]
    fn extract_thread_id_reads_request_user_input_thread_id() {
        let value = json!({
            "method": "item/tool/requestUserInput",
            "id": "req-1",
            "params": {
                "thread_id": "thread-input-1",
                "turn_id": "turn-1",
                "item_id": "item-1"
            }
        });
        assert_eq!(
            extract_thread_id(&value),
            Some("thread-input-1".to_string())
        );
    }

    #[test]
    fn extract_thread_id_reads_request_approval_thread_id() {
        let value = json!({
            "method": "item/permissions/requestApproval",
            "id": 7,
            "params": {
                "threadId": "thread-approval-1",
                "mode": "full"
            }
        });
        assert_eq!(
            extract_thread_id(&value),
            Some("thread-approval-1".to_string())
        );
    }

    #[test]
    fn extract_thread_id_returns_none_when_missing() {
        let value = json!({ "params": {} });
        assert_eq!(extract_thread_id(&value), None);
    }

    #[test]
    fn build_claude_sidecar_env_prefers_settings_over_launch_defaults() {
        let sdk_entry_path = PathBuf::from("/tmp/sdk-entry.mjs");
        let launch_config = ClaudeLaunchConfig {
            config_dir: Some(PathBuf::from("/tmp/.claude")),
            default_model: Some("opus".to_string()),
            permission_mode: Some("acceptEdits".to_string()),
            env_overrides: BTreeMap::from([(
                "ANTHROPIC_AUTH_TOKEN".to_string(),
                "token-1".to_string(),
            )]),
        };

        let envs = build_claude_sidecar_env(
            &sdk_entry_path,
            &launch_config,
            Some("C:/tools/claude.exe"),
            Some("--verbose --json"),
            Some("bypassPermissions"),
            "0.7.64",
        )
        .expect("build sidecar env");

        assert_eq!(
            envs.get("CLAUDE_MONITOR_SDK_ENTRY"),
            Some(&"/tmp/sdk-entry.mjs".to_string())
        );
        assert_eq!(
            envs.get("CLAUDE_CONFIG_DIR"),
            Some(&"/tmp/.claude".to_string())
        );
        assert_eq!(
            envs.get("CLAUDE_MONITOR_PROVIDER_BIN"),
            Some(&"C:/tools/claude.exe".to_string())
        );
        assert_eq!(
            envs.get("CLAUDE_MONITOR_PROVIDER_ARGS"),
            Some(&"--verbose --json".to_string())
        );
        assert_eq!(
            envs.get("CLAUDE_MONITOR_PERMISSION_MODE"),
            Some(&"bypassPermissions".to_string())
        );
        assert_eq!(
            envs.get("CLAUDE_MONITOR_DEFAULT_MODEL"),
            Some(&"opus".to_string())
        );
        assert_eq!(
            envs.get("ANTHROPIC_AUTH_TOKEN"),
            Some(&"token-1".to_string())
        );
        assert_eq!(
            envs.get("CLAUDE_MONITOR_CLIENT_VERSION"),
            Some(&"0.7.64".to_string())
        );
    }

    #[test]
    fn build_claude_sidecar_env_falls_back_to_launch_config_for_blank_settings() {
        let sdk_entry_path = PathBuf::from("/tmp/sdk-entry.mjs");
        let launch_config = ClaudeLaunchConfig {
            config_dir: Some(PathBuf::from("/tmp/.claude")),
            default_model: Some("sonnet".to_string()),
            permission_mode: Some("plan".to_string()),
            env_overrides: BTreeMap::new(),
        };

        let envs = build_claude_sidecar_env(
            &sdk_entry_path,
            &launch_config,
            Some("   "),
            Some(" "),
            Some(" "),
            "0.7.64",
        )
        .expect("build sidecar env");

        assert!(!envs.contains_key("CLAUDE_MONITOR_PROVIDER_BIN"));
        assert!(!envs.contains_key("CLAUDE_MONITOR_PROVIDER_ARGS"));
        assert_eq!(
            envs.get("CLAUDE_MONITOR_PERMISSION_MODE"),
            Some(&"plan".to_string())
        );
        assert_eq!(
            envs.get("CLAUDE_MONITOR_DEFAULT_MODEL"),
            Some(&"sonnet".to_string())
        );
    }

    #[test]
    fn build_claude_sidecar_env_rejects_unknown_permission_mode() {
        let sdk_entry_path = PathBuf::from("/tmp/sdk-entry.mjs");
        let launch_config = ClaudeLaunchConfig {
            config_dir: None,
            default_model: None,
            permission_mode: Some("acceptEdits".to_string()),
            env_overrides: BTreeMap::new(),
        };

        let result = build_claude_sidecar_env(
            &sdk_entry_path,
            &launch_config,
            None,
            None,
            Some("invalid-mode"),
            "0.7.64",
        );

        assert_eq!(
            result,
            Err(
                "Claude 权限模式无效：invalid-mode。可选值：default、acceptEdits、plan、dontAsk、bypassPermissions。"
                    .to_string()
            )
        );
    }

    #[test]
    fn resolve_claude_sdk_entry_from_root_reports_missing_sdk_path() {
        let temp_dir =
            std::env::temp_dir().join(format!("claude-sdk-entry-missing-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        let result = resolve_claude_sdk_entry_from_root(&temp_dir);

        let error = result.expect_err("expected missing sdk entry error");
        assert!(error.contains("无法定位 Claude Agent SDK 入口："));
        assert!(error.contains("node_modules"));
        assert!(error.contains("claude-agent-sdk"));
        assert!(error.contains("请先执行 `npm install`"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn resolve_claude_sdk_entry_from_binary_path_reads_resources_sdk_path() {
        let temp_dir = std::env::temp_dir().join(format!(
            "claude-sdk-entry-bundled-resources-{}",
            uuid::Uuid::new_v4()
        ));
        let install_dir = temp_dir.join("install");
        let binary_path = install_dir.join("codex-monitor.exe");
        let sdk_entry = install_dir
            .join("resources")
            .join(BUNDLED_CLAUDE_SDK_DIR)
            .join("sdk.mjs");

        std::fs::create_dir_all(sdk_entry.parent().expect("sdk parent"))
            .expect("create bundled sdk dir");
        std::fs::write(&sdk_entry, "export const sdk = true;\n").expect("write bundled sdk");

        let result = resolve_claude_sdk_entry_from_binary_path(&binary_path)
            .expect("resolve bundled sdk entry");

        assert_eq!(
            result,
            sdk_entry.canonicalize().expect("canonical sdk entry")
        );
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn resolve_claude_sdk_entry_from_binary_path_reads_sibling_sdk_path() {
        let temp_dir = std::env::temp_dir().join(format!(
            "claude-sdk-entry-bundled-sibling-{}",
            uuid::Uuid::new_v4()
        ));
        let install_dir = temp_dir.join("install");
        let binary_path = install_dir.join("codex-monitor-daemon.exe");
        let sdk_entry = install_dir.join(BUNDLED_CLAUDE_SDK_DIR).join("sdk.mjs");

        std::fs::create_dir_all(sdk_entry.parent().expect("sdk parent"))
            .expect("create sibling sdk dir");
        std::fs::write(&sdk_entry, "export const sdk = true;\n").expect("write sibling sdk");

        let result = resolve_claude_sdk_entry_from_binary_path(&binary_path)
            .expect("resolve sibling sdk entry");

        assert_eq!(
            result,
            sdk_entry.canonicalize().expect("canonical sdk entry")
        );
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn resolve_claude_sdk_entry_from_binary_path_reports_resource_hint_when_missing() {
        let temp_dir = std::env::temp_dir().join(format!(
            "claude-sdk-entry-bundled-missing-{}",
            uuid::Uuid::new_v4()
        ));
        let install_dir = temp_dir.join("install");
        std::fs::create_dir_all(&install_dir).expect("create install dir");
        let binary_path = install_dir.join("codex-monitor.exe");

        let error = resolve_claude_sdk_entry_from_binary_path(&binary_path)
            .expect_err("expected bundled sdk entry error");

        assert!(error.contains("无法定位打包后的 Claude Agent SDK 入口"));
        assert!(error.contains("claude-agent-sdk"));
        assert!(error.contains("安装包已包含 claude-agent-sdk 资源"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn build_initialize_params_enables_experimental_api() {
        let params = build_initialize_params("1.2.3");
        assert_eq!(
            params
                .get("capabilities")
                .and_then(|caps| caps.get("experimentalApi"))
                .and_then(|value| value.as_bool()),
            Some(true)
        );
    }

    #[test]
    fn ensure_claude_sidecar_script_materializes_bundled_source() {
        let sidecar_path = ensure_claude_sidecar_script().expect("sidecar path");
        let source = std::fs::read_to_string(&sidecar_path).expect("read sidecar source");
        assert!(source.contains("CLAUDE_MONITOR_SDK_ENTRY"));
        assert!(source.contains("process.stdin"));
    }

    #[test]
    fn extract_thread_entries_reads_result_data_items() {
        let value = json!({
            "result": {
                "data": [
                    { "id": "thread-a", "cwd": "/tmp/a" },
                    {
                        "threadId": "thread-b",
                        "cwd": "/tmp/b",
                        "source": { "subAgent": "memory_consolidation" }
                    }
                ]
            }
        });
        let entries = extract_thread_entries_from_thread_list_result(&value);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].thread_id, "thread-a");
        assert_eq!(entries[0].cwd.as_deref(), Some("/tmp/a"));
        assert!(!entries[0].is_memory_consolidation);
        assert_eq!(entries[1].thread_id, "thread-b");
        assert_eq!(entries[1].cwd.as_deref(), Some("/tmp/b"));
        assert!(entries[1].is_memory_consolidation);
    }

    #[test]
    fn extract_related_thread_ids_reads_spawn_hints_from_item_payloads() {
        let value = json!({
            "method": "item/completed",
            "params": {
                "threadId": "thread-parent",
                "item": {
                    "type": "mcpToolCall",
                    "new_thread_id": "thread-child"
                }
            }
        });
        let ids = extract_related_thread_ids(&value);
        assert!(ids.contains(&"thread-parent".to_string()));
        assert!(ids.contains(&"thread-child".to_string()));
    }

    #[test]
    fn extract_related_thread_ids_reads_receiver_agent_references() {
        let value = json!({
            "method": "item/completed",
            "params": {
                "threadId": "thread-parent",
                "item": {
                    "type": "collabToolCall",
                    "receiver_agents": [
                        { "thread_id": "thread-child-a" },
                        { "thread": { "id": "thread-child-b" } }
                    ],
                    "statuses": {
                        "thread-child-c": { "status": "running" }
                    }
                }
            }
        });
        let ids = extract_related_thread_ids(&value);
        assert!(ids.contains(&"thread-parent".to_string()));
        assert!(ids.contains(&"thread-child-a".to_string()));
        assert!(ids.contains(&"thread-child-b".to_string()));
        assert!(ids.contains(&"thread-child-c".to_string()));
    }

    #[test]
    fn extract_related_thread_ids_reads_singular_receiver_agent_reference() {
        let value = json!({
            "method": "item/completed",
            "params": {
                "threadId": "thread-parent",
                "item": {
                    "type": "mcpToolCall",
                    "receiver_agent": { "thread_id": "thread-child-single" }
                }
            }
        });
        let ids = extract_related_thread_ids(&value);
        assert!(ids.contains(&"thread-parent".to_string()));
        assert!(ids.contains(&"thread-child-single".to_string()));
    }

    #[test]
    fn resolve_workspace_for_cwd_normalizes_windows_paths() {
        let mut roots = HashMap::new();
        roots.insert("ws-1".to_string(), normalize_root_path("C:\\Dev\\Codex"));
        assert_eq!(
            resolve_workspace_for_cwd("c:/dev/codex", &roots),
            Some("ws-1".to_string())
        );
    }

    #[test]
    fn resolve_workspace_for_cwd_normalizes_windows_namespace_paths() {
        let mut roots = HashMap::new();
        roots.insert("ws-1".to_string(), normalize_root_path("C:\\Dev\\Codex"));
        assert_eq!(
            resolve_workspace_for_cwd("\\\\?\\C:\\Dev\\Codex", &roots),
            Some("ws-1".to_string())
        );
    }

    #[test]
    fn normalize_root_path_normalizes_windows_namespace_unc_paths() {
        assert_eq!(
            normalize_root_path("\\\\?\\UNC\\SERVER\\Share\\Repo\\"),
            "//server/share/repo"
        );
    }

    #[test]
    fn resolve_workspace_for_cwd_matches_nested_paths() {
        let mut roots = HashMap::new();
        roots.insert("ws-1".to_string(), normalize_root_path("/tmp/codex"));
        assert_eq!(
            resolve_workspace_for_cwd("/tmp/codex/subdir/project", &roots),
            Some("ws-1".to_string())
        );
    }

    #[test]
    fn resolve_workspace_for_cwd_prefers_longest_matching_root() {
        let mut roots = HashMap::new();
        roots.insert("ws-parent".to_string(), normalize_root_path("/tmp/codex"));
        roots.insert(
            "ws-child".to_string(),
            normalize_root_path("/tmp/codex/subdir"),
        );
        assert_eq!(
            resolve_workspace_for_cwd("/tmp/codex/subdir/project", &roots),
            Some("ws-child".to_string())
        );
    }

    #[test]
    fn source_subagent_kind_reads_string_variants() {
        assert_eq!(
            source_subagent_kind(&json!("subagent-memory-consolidation")),
            Some("memory_consolidation".to_string())
        );
        assert_eq!(
            source_subagent_kind(&json!("sub_agent_memory_consolidation")),
            Some("memory_consolidation".to_string())
        );
    }

    #[test]
    fn source_subagent_kind_reads_nested_subagent_object_keys() {
        let source = json!({
            "subAgent": {
                "memory_consolidation": {
                    "thread_spawn": { "parent_thread_id": "thread-parent" }
                }
            }
        });
        assert_eq!(
            source_subagent_kind(&source),
            Some("memory_consolidation".to_string())
        );
    }

    #[test]
    fn thread_started_memory_consolidation_detects_thread_source() {
        let value = json!({
            "method": "thread/started",
            "params": {
                "thread": {
                    "id": "thread-1",
                    "source": {
                        "subagent": "memory_consolidation"
                    }
                }
            }
        });
        assert!(thread_started_is_memory_consolidation(&value));
    }

    #[test]
    fn thread_started_memory_consolidation_detects_params_source_fallback() {
        let value = json!({
            "method": "thread/started",
            "params": {
                "threadId": "thread-1",
                "source": {
                    "subAgent": "memory_consolidation"
                }
            }
        });
        assert!(thread_started_is_memory_consolidation(&value));
    }

    #[test]
    fn thread_started_memory_consolidation_rejects_non_memory_subagent() {
        let value = json!({
            "method": "thread/started",
            "params": {
                "thread": {
                    "id": "thread-1",
                    "source": {
                        "subAgent": "review"
                    }
                }
            }
        });
        assert!(!thread_started_is_memory_consolidation(&value));
    }

    #[test]
    fn hidden_thread_suppression_allows_rpc_responses() {
        assert!(!should_suppress_hidden_thread_event(
            Some("thread/archived"),
            true
        ));
        assert!(!should_suppress_hidden_thread_event(
            Some("thread/updated"),
            true
        ));
        assert!(!should_suppress_hidden_thread_event(None, true));
    }

    #[test]
    fn hidden_thread_suppression_allows_response_required_notifications() {
        assert!(!should_suppress_hidden_thread_event(
            Some("item/tool/requestUserInput"),
            false
        ));
        assert!(!should_suppress_hidden_thread_event(
            Some("item/permissions/requestApproval"),
            false
        ));
        assert!(!should_suppress_hidden_thread_event(
            Some("workspace/requestApproval"),
            false
        ));
    }

    #[test]
    fn hidden_thread_suppression_still_blocks_non_exempt_notifications() {
        assert!(should_suppress_hidden_thread_event(
            Some("thread/updated"),
            false
        ));
        assert!(!should_suppress_hidden_thread_event(
            Some("thread/archived"),
            false
        ));
        assert!(!should_suppress_hidden_thread_event(
            Some("codex/backgroundThread"),
            false
        ));
    }

    #[test]
    fn spawn_workspace_session_rejects_claude_without_sidecar_enabled() {
        run_async_test(async {
            let result = spawn_workspace_session(
                WorkspaceEntry {
                    id: "ws-claude".to_string(),
                    name: "Claude".to_string(),
                    path: ".".to_string(),
                    provider: crate::types::AgentProvider::Claude,
                    kind: crate::types::WorkspaceKind::Main,
                    parent_id: None,
                    worktree: None,
                    settings: crate::types::WorkspaceSettings::default(),
                },
                None,
                None,
                None,
                None,
                None,
                false,
                "0.7.64".to_string(),
                NoopEventSink,
            )
            .await;

            assert!(result.is_err(), "expected sidecar disabled error");
            assert_eq!(
                result.err().unwrap_or_default(),
                "当前仅支持 Claude SDK sidecar，请在设置中开启 claudeUseSdkSidecar。".to_string()
            );
        });
    }

    #[test]
    fn spawn_workspace_session_rejects_invalid_claude_permission_mode() {
        run_async_test(async {
            let result = spawn_workspace_session(
                WorkspaceEntry {
                    id: "ws-claude".to_string(),
                    name: "Claude".to_string(),
                    path: ".".to_string(),
                    provider: crate::types::AgentProvider::Claude,
                    kind: crate::types::WorkspaceKind::Main,
                    parent_id: None,
                    worktree: None,
                    settings: crate::types::WorkspaceSettings::default(),
                },
                None,
                None,
                None,
                None,
                Some("invalid-mode".to_string()),
                true,
                "0.7.64".to_string(),
                NoopEventSink,
            )
            .await;

            assert!(result.is_err(), "expected invalid permission mode error");
            assert_eq!(
                result.err().unwrap_or_default(),
                "Claude 权限模式无效：invalid-mode。可选值：default、acceptEdits、plan、dontAsk、bypassPermissions。"
                    .to_string()
            );
        });
    }

    #[test]
    fn global_workspace_notifications_broadcast_without_thread_or_request_binding() {
        assert!(should_broadcast_global_workspace_notification(
            Some("account/updated"),
            None,
            None
        ));
        assert!(should_broadcast_global_workspace_notification(
            Some("account/rateLimits/updated"),
            None,
            None
        ));
        assert!(should_broadcast_global_workspace_notification(
            Some("account/login/completed"),
            None,
            None
        ));
    }

    #[test]
    fn global_workspace_notifications_do_not_broadcast_when_scoped() {
        let thread_id = "thread-1".to_string();
        assert!(!should_broadcast_global_workspace_notification(
            Some("account/updated"),
            Some(&thread_id),
            None
        ));
        assert!(!should_broadcast_global_workspace_notification(
            Some("account/updated"),
            None,
            Some("ws-1")
        ));
        assert!(!should_broadcast_global_workspace_notification(
            Some("thread/started"),
            None,
            None
        ));
    }

    #[test]
    fn send_request_for_workspace_records_thread_request_context() {
        run_async_test(async {
            let session = make_test_session("ws-owner").await;
            let session_for_assert = Arc::clone(&session);

            let request_task = tokio::spawn(async move {
                session
                    .send_request_for_workspace(
                        "ws-claude",
                        "turn/start",
                        json!({
                            "threadId": "thread-approval",
                            "input": [{ "type": "text", "text": "hello" }]
                        }),
                    )
                    .await
            });

            let request_id = loop {
                let context_map = session_for_assert.request_context.lock().await.clone();
                if let Some((request_id, context)) = context_map.into_iter().next() {
                    assert_eq!(
                        context.workspace_id, "ws-claude",
                        "thread-bound request should retain workspace context"
                    );
                    assert_eq!(context.method, "turn/start");
                    break request_id;
                }
                tokio::task::yield_now().await;
            };

            let mapped_workspace = session_for_assert
                .thread_workspace
                .lock()
                .await
                .get("thread-approval")
                .cloned();
            assert_eq!(mapped_workspace.as_deref(), Some("ws-claude"));

            let pending = session_for_assert.pending.lock().await.remove(&request_id);
            let sender = pending.expect("pending sender");
            sender
                .send(json!({ "id": request_id, "result": { "ok": true } }))
                .expect("send response");

            let response = request_task.await.expect("join request task");
            assert_eq!(
                response,
                Ok(json!({ "id": request_id, "result": { "ok": true } }))
            );
        });
    }

    #[test]
    fn send_request_for_workspace_tracks_workspace_context_without_thread_id() {
        run_async_test(async {
            let session = make_test_session("ws-owner").await;
            let session_for_assert = Arc::clone(&session);

            let request_task = tokio::spawn(async move {
                session
                    .send_request_for_workspace(
                        "ws-claude",
                        "item/tool/respond",
                        json!({
                            "requestId": "req-1",
                            "result": {
                                "answers": {
                                    "confirm": { "answers": ["yes"] }
                                }
                            }
                        }),
                    )
                    .await
            });

            let request_id = loop {
                let context_map = session_for_assert.request_context.lock().await.clone();
                if let Some((request_id, context)) = context_map.into_iter().next() {
                    assert_eq!(context.workspace_id, "ws-claude");
                    assert_eq!(context.method, "item/tool/respond");
                    break request_id;
                }
                tokio::task::yield_now().await;
            };

            assert!(
                session_for_assert.thread_workspace.lock().await.is_empty(),
                "requests without thread id should not mutate thread mapping"
            );

            let pending = session_for_assert.pending.lock().await.remove(&request_id);
            let sender = pending.expect("pending sender");
            sender
                .send(json!({ "id": request_id, "result": { "accepted": true } }))
                .expect("send response");

            let response = request_task.await.expect("join request task");
            assert_eq!(
                response,
                Ok(json!({ "id": request_id, "result": { "accepted": true } }))
            );
        });
    }
}
