use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::OnceLock;

use tokio::sync::Mutex;

use crate::backend::app_server::WorkspaceSession;
use crate::shared::process_core::kill_child_process_tree;
use crate::shared::provider_core::{
    build_provider_session_key, build_provider_session_prefix, ensure_provider_enabled,
    provider_not_ready_error, provider_supports_live_runtime, provider_supports_shared_session,
};
use crate::shared::provider_runtime_core::resolve_provider_runtime_config;
use crate::types::{AgentProvider, AppSettings, WorkspaceEntry};

use super::helpers::resolve_entry_and_parent;

static CONNECT_WORKSPACE_SPAWN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub(super) fn workspace_session_spawn_lock() -> &'static Mutex<()> {
    CONNECT_WORKSPACE_SPAWN_LOCK.get_or_init(|| Mutex::new(()))
}

async fn session_process_is_alive(session: &Arc<WorkspaceSession>) -> bool {
    let mut child = session.child.lock().await;
    matches!(child.try_wait(), Ok(None))
}

async fn remove_session_references(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    session: &Arc<WorkspaceSession>,
) {
    let mut sessions = sessions.lock().await;
    sessions.retain(|_, candidate| !Arc::ptr_eq(candidate, session));
}

pub(super) async fn take_live_shared_session(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    provider: &AgentProvider,
) -> Option<Arc<WorkspaceSession>> {
    if !provider_supports_shared_session(provider) {
        return None;
    }
    loop {
        let existing_session = {
            let sessions = sessions.lock().await;
            let prefix = build_provider_session_prefix(provider);
            sessions
                .iter()
                .find_map(|(key, session)| key.starts_with(&prefix).then(|| session.clone()))
        };
        let Some(existing_session) = existing_session else {
            return None;
        };
        if session_process_is_alive(&existing_session).await {
            return Some(existing_session);
        }
        remove_session_references(sessions, &existing_session).await;
    }
}

pub(crate) async fn connect_workspace_core<F, Fut>(
    workspace_id: String,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    app_settings: &Mutex<AppSettings>,
    spawn_session: F,
) -> Result<(), String>
where
    F: Fn(WorkspaceEntry, Option<String>, Option<String>, Option<PathBuf>) -> Fut,
    Fut: Future<Output = Result<Arc<WorkspaceSession>, String>>,
{
    let (entry, parent_entry) = resolve_entry_and_parent(workspaces, &workspace_id).await?;
    {
        let settings = app_settings.lock().await;
        ensure_provider_enabled(&entry.provider, &settings)?;
    }
    if !provider_supports_live_runtime(&entry.provider) {
        return Err(provider_not_ready_error(&entry.provider));
    }
    let _spawn_guard = workspace_session_spawn_lock().lock().await;
    let session_key = build_provider_session_key(&entry.provider, &entry.id);
    if let Some(existing_for_entry) = {
        let sessions = sessions.lock().await;
        sessions.get(&session_key).cloned()
    } {
        if session_process_is_alive(&existing_for_entry).await {
            return Ok(());
        }
        remove_session_references(sessions, &existing_for_entry).await;
    }
    if let Some(existing_session) = take_live_shared_session(sessions, &entry.provider).await {
        existing_session
            .register_workspace_with_path(&entry.id, Some(&entry.path))
            .await;
        sessions.lock().await.insert(session_key, existing_session);
        return Ok(());
    }
    let runtime_config = {
        let settings = app_settings.lock().await;
        resolve_provider_runtime_config(&entry, parent_entry.as_ref(), &settings)
    };
    let session = spawn_session(
        entry.clone(),
        runtime_config.default_bin,
        runtime_config.runtime_args,
        runtime_config.runtime_home,
    )
    .await?;
    session
        .register_workspace_with_path(&entry.id, Some(&entry.path))
        .await;
    sessions.lock().await.insert(session_key, session);
    Ok(())
}

/// 断开指定工作区与共享运行时的连接。
///
/// `workspace_id`：目标工作区 ID。
/// `workspaces`：工作区存储，用于解析 provider。
/// `sessions`：provider 维度的会话池。
pub(crate) async fn disconnect_workspace_core(
    workspace_id: String,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
) -> Result<(), String> {
    let entry = {
        let workspaces = workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .cloned()
            .ok_or_else(|| "workspace not found".to_string())?
    };
    kill_session_by_id(sessions, &entry.provider, &entry.id).await;
    Ok(())
}

/// 重载指定工作区的运行时会话。
///
/// `workspace_id`：目标工作区 ID。
/// `workspaces`：工作区存储。
/// `sessions`：provider 维度的会话池。
/// `app_settings`：当前应用设置快照。
/// `spawn_session`：用于创建新运行时会话的回调。
pub(crate) async fn reload_workspace_session_core<F, Fut>(
    workspace_id: String,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    app_settings: &Mutex<AppSettings>,
    spawn_session: F,
) -> Result<(), String>
where
    F: Fn(WorkspaceEntry, Option<String>, Option<String>, Option<PathBuf>) -> Fut,
    Fut: Future<Output = Result<Arc<WorkspaceSession>, String>>,
{
    let (entry, parent_entry) = resolve_entry_and_parent(workspaces, &workspace_id).await?;
    {
        let settings = app_settings.lock().await;
        ensure_provider_enabled(&entry.provider, &settings)?;
    }
    if !provider_supports_live_runtime(&entry.provider) {
        return Err(provider_not_ready_error(&entry.provider));
    }

    let _spawn_guard = workspace_session_spawn_lock().lock().await;
    let session_key = build_provider_session_key(&entry.provider, &entry.id);
    let current_session = {
        let sessions = sessions.lock().await;
        sessions.get(&session_key).cloned()
    }
    .ok_or_else(|| "workspace not connected".to_string())?;
    let runtime_config = {
        let settings = app_settings.lock().await;
        resolve_provider_runtime_config(&entry, parent_entry.as_ref(), &settings)
    };
    let new_session = spawn_session(
        entry.clone(),
        runtime_config.default_bin,
        runtime_config.runtime_args,
        runtime_config.runtime_home,
    )
    .await?;
    new_session
        .register_workspace_with_path(&entry.id, Some(&entry.path))
        .await;
    sessions
        .lock()
        .await
        .insert(session_key, Arc::clone(&new_session));

    current_session.unregister_workspace(&entry.id).await;
    let still_referenced = {
        let sessions = sessions.lock().await;
        sessions
            .values()
            .any(|candidate| Arc::ptr_eq(candidate, &current_session))
    };
    if still_referenced {
        return Ok(());
    }

    let mut child = current_session.child.lock().await;
    kill_child_process_tree(&mut child).await;
    Ok(())
}

pub(super) async fn kill_session_by_id(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    provider: &AgentProvider,
    id: &str,
) {
    let (removed, still_referenced) = {
        let mut sessions = sessions.lock().await;
        let removed = sessions.remove(&build_provider_session_key(provider, id));
        let still_referenced = removed.as_ref().is_some_and(|session| {
            sessions
                .values()
                .any(|candidate| Arc::ptr_eq(candidate, session))
        });
        (removed, still_referenced)
    };
    if let Some(session) = removed {
        session.unregister_workspace(id).await;
        if still_referenced {
            return;
        }
        let mut child = session.child.lock().await;
        kill_child_process_tree(&mut child).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::collections::{HashMap, HashSet};
    use std::process::Stdio;
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    use std::sync::Arc;

    use tokio::process::Command;
    use tokio::sync::Mutex;

    use crate::types::{AgentProvider, WorkspaceKind, WorkspaceSettings};

    fn make_workspace_entry(id: &str) -> WorkspaceEntry {
        make_workspace_entry_with_provider(id, AgentProvider::Codex)
    }

    fn make_workspace_entry_with_provider(id: &str, provider: AgentProvider) -> WorkspaceEntry {
        WorkspaceEntry {
            id: id.to_string(),
            name: id.to_string(),
            path: "/tmp".to_string(),
            provider,
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    fn make_session(_entry: WorkspaceEntry) -> Arc<WorkspaceSession> {
        let mut cmd = if cfg!(windows) {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", "more"]);
            cmd
        } else {
            let mut cmd = Command::new("sh");
            cmd.args(["-c", "cat"]);
            cmd
        };

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let mut child = cmd.spawn().expect("spawn dummy child");
        let stdin = child.stdin.take().expect("dummy child stdin");

        Arc::new(WorkspaceSession {
            codex_args: None,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            request_context: Mutex::new(HashMap::new()),
            thread_workspace: Mutex::new(HashMap::new()),
            hidden_thread_ids: Mutex::new(HashSet::new()),
            next_id: AtomicU64::new(0),
            background_thread_callbacks: Mutex::new(HashMap::new()),
            owner_workspace_id: "test-owner".to_string(),
            workspace_ids: Mutex::new(HashSet::from(["test-owner".to_string()])),
            workspace_roots: Mutex::new(HashMap::new()),
        })
    }

    #[test]
    fn connect_workspace_is_noop_when_already_connected() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let entry = make_workspace_entry("ws-1");
            let workspaces = Mutex::new(HashMap::from([(entry.id.clone(), entry.clone())]));
            let sessions = Mutex::new(HashMap::from([(
                build_provider_session_key(&entry.provider, &entry.id),
                make_session(entry.clone()),
            )]));
            let app_settings = Mutex::new(AppSettings::default());
            let spawn_calls = Arc::new(AtomicUsize::new(0));
            let spawn_calls_ref = spawn_calls.clone();

            connect_workspace_core(
                entry.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                move |_entry, _default_bin, _codex_args, _codex_home| {
                    let spawn_calls_ref = spawn_calls_ref.clone();
                    async move {
                        spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Err("should not spawn".to_string())
                    }
                },
            )
            .await
            .expect("connect should be noop");

            assert_eq!(spawn_calls.load(Ordering::SeqCst), 0);
            kill_session_by_id(&sessions, &entry.provider, &entry.id).await;
        });
    }

    #[test]
    fn connect_workspace_spawns_when_not_connected() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let entry = make_workspace_entry("ws-2");
            let workspaces = Mutex::new(HashMap::from([(entry.id.clone(), entry.clone())]));
            let sessions = Mutex::new(HashMap::<String, Arc<WorkspaceSession>>::new());
            let app_settings = Mutex::new(AppSettings::default());
            let spawn_calls = Arc::new(AtomicUsize::new(0));
            let spawn_calls_ref = spawn_calls.clone();
            let entry_for_spawn = entry.clone();

            connect_workspace_core(
                entry.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                move |_entry, _default_bin, _codex_args, _codex_home| {
                    let spawn_calls_ref = spawn_calls_ref.clone();
                    let entry_for_spawn = entry_for_spawn.clone();
                    async move {
                        spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Ok(make_session(entry_for_spawn))
                    }
                },
            )
            .await
            .expect("connect should spawn");

            assert_eq!(spawn_calls.load(Ordering::SeqCst), 1);
            assert!(sessions
                .lock()
                .await
                .contains_key(&build_provider_session_key(&entry.provider, &entry.id)));
            kill_session_by_id(&sessions, &entry.provider, &entry.id).await;
        });
    }

    #[test]
    fn connect_workspace_reuses_codex_shared_session_between_workspaces() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let first = make_workspace_entry_with_provider("ws-codex-1", AgentProvider::Codex);
            let second = make_workspace_entry_with_provider("ws-codex-2", AgentProvider::Codex);
            let workspaces = Mutex::new(HashMap::from([
                (first.id.clone(), first.clone()),
                (second.id.clone(), second.clone()),
            ]));
            let sessions = Mutex::new(HashMap::<String, Arc<WorkspaceSession>>::new());
            let app_settings = Mutex::new(AppSettings::default());
            let spawn_calls = Arc::new(AtomicUsize::new(0));
            let spawn_calls_ref = spawn_calls.clone();
            let first_for_spawn = first.clone();

            let spawn = move |_entry, _default_bin, _codex_args, _codex_home| {
                let spawn_calls_ref = spawn_calls_ref.clone();
                let first_for_spawn = first_for_spawn.clone();
                async move {
                    spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                    Ok(make_session(first_for_spawn))
                }
            };

            connect_workspace_core(
                first.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                spawn,
            )
            .await
            .expect("first codex workspace should connect");

            connect_workspace_core(
                second.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                move |_entry, _default_bin, _codex_args, _codex_home| async move {
                    Err("codex shared session should have been reused".to_string())
                },
            )
            .await
            .expect("second codex workspace should reuse session");

            let sessions_guard = sessions.lock().await;
            let first_session = sessions_guard
                .get(&build_provider_session_key(&first.provider, &first.id))
                .expect("first session should exist");
            let second_session = sessions_guard
                .get(&build_provider_session_key(&second.provider, &second.id))
                .expect("second session should exist");
            assert_eq!(spawn_calls.load(Ordering::SeqCst), 1);
            assert!(Arc::ptr_eq(first_session, second_session));
            drop(sessions_guard);

            kill_session_by_id(&sessions, &first.provider, &first.id).await;
            kill_session_by_id(&sessions, &second.provider, &second.id).await;
        });
    }

    #[test]
    fn connect_workspace_keeps_claude_sessions_isolated_per_workspace() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let first = make_workspace_entry_with_provider("ws-claude-1", AgentProvider::Claude);
            let second = make_workspace_entry_with_provider("ws-claude-2", AgentProvider::Claude);
            let workspaces = Mutex::new(HashMap::from([
                (first.id.clone(), first.clone()),
                (second.id.clone(), second.clone()),
            ]));
            let sessions = Mutex::new(HashMap::<String, Arc<WorkspaceSession>>::new());
            let app_settings = Mutex::new(AppSettings::default());
            let spawn_calls = Arc::new(AtomicUsize::new(0));

            let first_for_spawn = first.clone();
            let second_for_spawn = second.clone();
            let spawn_calls_ref = spawn_calls.clone();

            connect_workspace_core(
                first.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                move |_entry, _default_bin, _codex_args, _codex_home| {
                    let spawn_calls_ref = spawn_calls_ref.clone();
                    let first_for_spawn = first_for_spawn.clone();
                    async move {
                        spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Ok(make_session(first_for_spawn))
                    }
                },
            )
            .await
            .expect("first claude workspace should connect");

            let spawn_calls_ref = spawn_calls.clone();
            connect_workspace_core(
                second.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                move |_entry, _default_bin, _codex_args, _codex_home| {
                    let spawn_calls_ref = spawn_calls_ref.clone();
                    let second_for_spawn = second_for_spawn.clone();
                    async move {
                        spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Ok(make_session(second_for_spawn))
                    }
                },
            )
            .await
            .expect("second claude workspace should connect");

            let sessions_guard = sessions.lock().await;
            let first_session = sessions_guard
                .get(&build_provider_session_key(&first.provider, &first.id))
                .expect("first claude session should exist");
            let second_session = sessions_guard
                .get(&build_provider_session_key(&second.provider, &second.id))
                .expect("second claude session should exist");
            assert_eq!(spawn_calls.load(Ordering::SeqCst), 2);
            assert!(!Arc::ptr_eq(first_session, second_session));
            drop(sessions_guard);

            kill_session_by_id(&sessions, &first.provider, &first.id).await;
            kill_session_by_id(&sessions, &second.provider, &second.id).await;
        });
    }

    #[test]
    fn connect_workspace_rejects_claude_when_experimental_flag_is_disabled() {
        let runtime = tokio::runtime::Runtime::new().expect("create runtime");
        runtime.block_on(async {
            let entry = make_workspace_entry_with_provider("ws-claude", AgentProvider::Claude);
            let workspaces = Mutex::new(HashMap::from([(entry.id.clone(), entry.clone())]));
            let sessions = Mutex::new(HashMap::new());
            let app_settings = Mutex::new(AppSettings::default());

            let result = connect_workspace_core(
                entry.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                |_entry, _default_bin, _args, _home| async {
                    panic!("claude should not spawn while experimental flag is disabled");
                },
            )
            .await;

            assert_eq!(
                result.expect_err("claude connect should be rejected"),
                "Claude Provider 当前属于实验功能，请先在设置 -> 功能 中开启。"
            );
        });
    }

    #[test]
    fn reload_workspace_session_replaces_only_target_workspace_binding() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let first = make_workspace_entry_with_provider("ws-codex-1", AgentProvider::Codex);
            let second = make_workspace_entry_with_provider("ws-codex-2", AgentProvider::Codex);
            let workspaces = Mutex::new(HashMap::from([
                (first.id.clone(), first.clone()),
                (second.id.clone(), second.clone()),
            ]));
            let sessions = Mutex::new(HashMap::<String, Arc<WorkspaceSession>>::new());
            let app_settings = Mutex::new(AppSettings::default());
            let original_spawn_calls = Arc::new(AtomicUsize::new(0));
            let original_spawn_calls_ref = original_spawn_calls.clone();
            let first_for_spawn = first.clone();

            connect_workspace_core(
                first.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                move |_entry, _default_bin, _codex_args, _codex_home| {
                    let original_spawn_calls_ref = original_spawn_calls_ref.clone();
                    let first_for_spawn = first_for_spawn.clone();
                    async move {
                        original_spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Ok(make_session(first_for_spawn))
                    }
                },
            )
            .await
            .expect("first workspace should connect");

            connect_workspace_core(
                second.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                move |_entry, _default_bin, _codex_args, _codex_home| async move {
                    Err("shared codex session should be reused".to_string())
                },
            )
            .await
            .expect("second workspace should reuse session");

            let original_session = {
                let sessions_guard = sessions.lock().await;
                sessions_guard
                    .get(&build_provider_session_key(&first.provider, &first.id))
                    .cloned()
                    .expect("original session should exist")
            };

            let reload_spawn_calls = Arc::new(AtomicUsize::new(0));
            let reload_spawn_calls_ref = reload_spawn_calls.clone();
            let reloaded_entry = first.clone();
            reload_workspace_session_core(
                first.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                move |_entry, _default_bin, _codex_args, _codex_home| {
                    let reload_spawn_calls_ref = reload_spawn_calls_ref.clone();
                    let reloaded_entry = reloaded_entry.clone();
                    async move {
                        reload_spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Ok(make_session(reloaded_entry))
                    }
                },
            )
            .await
            .expect("reload should respawn target workspace");

            let sessions_guard = sessions.lock().await;
            let first_session = sessions_guard
                .get(&build_provider_session_key(&first.provider, &first.id))
                .expect("reloaded first session should exist");
            let second_session = sessions_guard
                .get(&build_provider_session_key(&second.provider, &second.id))
                .expect("second session should still exist");

            assert_eq!(original_spawn_calls.load(Ordering::SeqCst), 1);
            assert_eq!(reload_spawn_calls.load(Ordering::SeqCst), 1);
            assert!(!Arc::ptr_eq(first_session, &original_session));
            assert!(Arc::ptr_eq(second_session, &original_session));
            assert!(!Arc::ptr_eq(first_session, second_session));
            drop(sessions_guard);

            kill_session_by_id(&sessions, &first.provider, &first.id).await;
            kill_session_by_id(&sessions, &second.provider, &second.id).await;
        });
    }

    #[test]
    fn disconnect_workspace_removes_target_binding_and_keeps_shared_session_for_others() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let first = make_workspace_entry_with_provider("ws-codex-1", AgentProvider::Codex);
            let second = make_workspace_entry_with_provider("ws-codex-2", AgentProvider::Codex);
            let workspaces = Mutex::new(HashMap::from([
                (first.id.clone(), first.clone()),
                (second.id.clone(), second.clone()),
            ]));
            let sessions = Mutex::new(HashMap::<String, Arc<WorkspaceSession>>::new());
            let app_settings = Mutex::new(AppSettings::default());
            let first_for_spawn = first.clone();

            connect_workspace_core(
                first.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                move |_entry, _default_bin, _codex_args, _codex_home| {
                    let first_for_spawn = first_for_spawn.clone();
                    async move { Ok(make_session(first_for_spawn)) }
                },
            )
            .await
            .expect("first workspace should connect");

            connect_workspace_core(
                second.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                move |_entry, _default_bin, _codex_args, _codex_home| async move {
                    Err("shared codex session should be reused".to_string())
                },
            )
            .await
            .expect("second workspace should reuse session");

            disconnect_workspace_core(first.id.clone(), &workspaces, &sessions)
                .await
                .expect("disconnect should succeed");

            let sessions_guard = sessions.lock().await;
            assert!(!sessions_guard
                .contains_key(&build_provider_session_key(&first.provider, &first.id)));
            assert!(sessions_guard
                .contains_key(&build_provider_session_key(&second.provider, &second.id)));
            drop(sessions_guard);

            kill_session_by_id(&sessions, &second.provider, &second.id).await;
        });
    }
}
