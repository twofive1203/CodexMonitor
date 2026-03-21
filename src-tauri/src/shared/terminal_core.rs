use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::sync::Mutex;

use crate::backend::events::{EventSink, TerminalExit, TerminalOutput};

/// 终端会话共享核心。
///
/// 负责保存 PTY 主端、输入 writer 和子进程句柄，供桌面端与 daemon 复用。
///
/// @author lichong
pub(crate) struct TerminalSession {
    pub(crate) id: String,
    pub(crate) master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    pub(crate) writer: Mutex<Box<dyn Write + Send>>,
    pub(crate) child: Mutex<Box<dyn portable_pty::Child + Send>>,
}

/// 关闭清理回调。
///
/// 参数依次为 `workspace_id`、`terminal_id` 和当前会话实例。
pub(crate) type TerminalCleanup =
    Arc<dyn Fn(String, String, Arc<TerminalSession>) + Send + Sync + 'static>;

/// 判断 PTY 是否已经关闭。
///
/// `message`：底层读写返回的错误文本。
pub(crate) fn is_terminal_closed_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("broken pipe")
        || lower.contains("input/output error")
        || lower.contains("os error 5")
        || lower.contains("eio")
        || lower.contains("io error")
        || lower.contains("not connected")
        || lower.contains("closed")
}

#[cfg(target_os = "windows")]
fn shell_path() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
}

#[cfg(not(target_os = "windows"))]
fn shell_path() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

#[cfg(any(target_os = "windows", test))]
fn windows_shell_args(shell: &str) -> Vec<&'static str> {
    let shell = shell.to_ascii_lowercase();
    if shell.contains("powershell") || shell.ends_with("pwsh.exe") || shell.ends_with("\\pwsh") {
        vec!["-NoLogo", "-NoExit"]
    } else if shell.ends_with("cmd.exe") || shell.ends_with("\\cmd") {
        vec!["/K"]
    } else {
        Vec::new()
    }
}

#[cfg(not(target_os = "windows"))]
fn unix_shell_args() -> Vec<&'static str> {
    vec!["-i"]
}

#[cfg(target_os = "windows")]
fn configure_shell_args(cmd: &mut CommandBuilder) {
    for arg in windows_shell_args(&shell_path()) {
        cmd.arg(arg);
    }
}

#[cfg(not(target_os = "windows"))]
fn configure_shell_args(cmd: &mut CommandBuilder) {
    for arg in unix_shell_args() {
        cmd.arg(arg);
    }
}

fn resolve_locale() -> String {
    let candidate = std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LANG"))
        .unwrap_or_else(|_| "en_US.UTF-8".to_string());
    let lower = candidate.to_lowercase();
    if lower.contains("utf-8") || lower.contains("utf8") {
        return candidate;
    }
    "en_US.UTF-8".to_string()
}

/// 打开新的 PTY 终端会话。
///
/// `cwd`：终端启动目录；`terminal_id`：终端标识；`cols`：初始列数；`rows`：初始行数。
pub(crate) fn open_terminal_session(
    cwd: PathBuf,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(Arc<TerminalSession>, Box<dyn Read + Send>), String> {
    if !cwd.is_dir() {
        return Err(format!("工作区路径不存在，或不是目录：{}", cwd.display()));
    }

    let pty_system = native_pty_system();
    let size = PtySize {
        rows: rows.max(2),
        cols: cols.max(2),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system
        .openpty(size)
        .map_err(|error| format!("打开伪终端失败：{error}"))?;

    let mut cmd = CommandBuilder::new(shell_path());
    cmd.cwd(cwd);
    configure_shell_args(&mut cmd);
    cmd.env("TERM", "xterm-256color");
    let locale = resolve_locale();
    cmd.env("LANG", &locale);
    cmd.env("LC_ALL", &locale);
    cmd.env("LC_CTYPE", &locale);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|error| format!("启动终端 Shell 失败：{error}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("打开伪终端读取器失败：{error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("打开伪终端写入器失败：{error}"))?;

    let session = Arc::new(TerminalSession {
        id: terminal_id,
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
    });
    Ok((session, reader))
}

/// 启动终端输出读取线程。
///
/// `event_sink`：输出事件发射器；`session`：会话实例；`workspace_id`：工作区标识；
/// `terminal_id`：终端标识；`reader`：PTY reader；`cleanup`：会话退出后的清理回调。
pub(crate) fn spawn_terminal_reader(
    event_sink: impl EventSink,
    session: Arc<TerminalSession>,
    workspace_id: String,
    terminal_id: String,
    mut reader: Box<dyn Read + Send>,
    cleanup: TerminalCleanup,
) {
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    pending.extend_from_slice(&buffer[..count]);
                    loop {
                        match std::str::from_utf8(&pending) {
                            Ok(decoded) => {
                                if !decoded.is_empty() {
                                    event_sink.emit_terminal_output(TerminalOutput {
                                        workspace_id: workspace_id.clone(),
                                        terminal_id: terminal_id.clone(),
                                        data: decoded.to_string(),
                                    });
                                }
                                pending.clear();
                                break;
                            }
                            Err(error) => {
                                let valid_up_to = error.valid_up_to();
                                if valid_up_to == 0 {
                                    if error.error_len().is_none() {
                                        break;
                                    }
                                    let invalid_len = error.error_len().unwrap_or(1);
                                    pending.drain(..invalid_len.min(pending.len()));
                                    continue;
                                }
                                let chunk =
                                    String::from_utf8_lossy(&pending[..valid_up_to]).to_string();
                                if !chunk.is_empty() {
                                    event_sink.emit_terminal_output(TerminalOutput {
                                        workspace_id: workspace_id.clone(),
                                        terminal_id: terminal_id.clone(),
                                        data: chunk,
                                    });
                                }
                                pending.drain(..valid_up_to);
                                if error.error_len().is_none() {
                                    break;
                                }
                                let invalid_len = error.error_len().unwrap_or(1);
                                pending.drain(..invalid_len.min(pending.len()));
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }

        event_sink.emit_terminal_exit(TerminalExit {
            workspace_id: workspace_id.clone(),
            terminal_id: terminal_id.clone(),
        });
        cleanup(workspace_id, terminal_id, session);
    });
}

/// 向终端写入输入数据。
///
/// `session`：终端会话；`data`：待写入的原始终端输入。
pub(crate) async fn write_terminal_session(
    session: Arc<TerminalSession>,
    data: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut writer = session.writer.blocking_lock();
        writer
            .write_all(data.as_bytes())
            .map_err(|error| format!("写入伪终端失败：{error}"))?;
        writer
            .flush()
            .map_err(|error| format!("刷新伪终端失败：{error}"))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| format!("终端写入任务失败：{error}"))?
}

/// 调整终端窗口大小。
///
/// `session`：终端会话；`cols`：目标列数；`rows`：目标行数。
pub(crate) async fn resize_terminal_session(
    session: Arc<TerminalSession>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let size = PtySize {
        rows: rows.max(2),
        cols: cols.max(2),
        pixel_width: 0,
        pixel_height: 0,
    };
    tokio::task::spawn_blocking(move || {
        let master = session.master.blocking_lock();
        master
            .resize(size)
            .map_err(|error| format!("调整伪终端大小失败：{error}"))
    })
    .await
    .map_err(|error| format!("终端尺寸调整任务失败：{error}"))?
}

/// 主动关闭终端会话。
///
/// `session`：终端会话实例。
pub(crate) async fn close_terminal_session(session: Arc<TerminalSession>) -> Result<(), String> {
    let _ = tokio::task::spawn_blocking(move || {
        let mut child = session.child.blocking_lock();
        let _ = child.kill();
    })
    .await;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[cfg(not(target_os = "windows"))]
    use super::unix_shell_args;
    use super::windows_shell_args;

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn unix_shell_args_contains_interactive_flag() {
        assert_eq!(unix_shell_args(), vec!["-i"]);
    }

    #[test]
    fn windows_shell_args_supports_powershell() {
        assert_eq!(
            windows_shell_args("powershell.exe"),
            vec!["-NoLogo", "-NoExit"]
        );
    }

    #[test]
    fn windows_shell_args_supports_cmd() {
        assert_eq!(windows_shell_args("cmd.exe"), vec!["/K"]);
    }

    #[test]
    fn windows_shell_args_are_empty_for_other_shells() {
        assert!(windows_shell_args("nu.exe").is_empty());
    }
}
