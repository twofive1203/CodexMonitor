//! Shared TCP listener inspection helpers.
//! Author: lichong.

use std::io::ErrorKind;
use std::net::SocketAddr;

use crate::shared::process_core::tokio_command;

/// Checks whether the bind error represents an occupied local address.
///
/// `error`: bind error returned by the operating system.
fn is_addr_in_use_error(error: &std::io::Error) -> bool {
    error.kind() == ErrorKind::AddrInUse || error.raw_os_error() == Some(10048)
}

/// Builds a user-facing startup error for an occupied listen address.
///
/// `target_name`: human-readable service name that is trying to bind.
/// `listen_addr`: TCP listen address that could not be acquired.
/// `pid`: optional process identifier currently holding the port.
pub fn occupied_listen_addr_message(
    target_name: &str,
    listen_addr: &str,
    pid: Option<u32>,
) -> String {
    match pid {
        Some(pid) => format!(
            "Cannot start {target_name} because {listen_addr} is already in use by another process (PID {pid})."
        ),
        None => format!(
            "Cannot start {target_name} because {listen_addr} is already in use by another process."
        ),
    }
}

/// Extracts the port number from a CLI address token.
///
/// `value`: address token emitted by `ss`, `netstat`, or similar tools.
fn parse_port_from_addr_token(value: &str) -> Option<u16> {
    value
        .trim()
        .rsplit_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok())
}

/// Parses `ss -ltnp` output and resolves the listener PID for the requested port.
///
/// `output`: raw stdout payload returned by `ss`.
/// `port`: TCP port that should be matched.
#[cfg(any(test, target_os = "linux"))]
fn parse_ss_listener_pid(output: &str, port: u16) -> Option<u32> {
    for line in output.lines() {
        if !line.contains("LISTEN") {
            continue;
        }
        let columns: Vec<&str> = line.split_whitespace().collect();
        let local_addr = match columns.get(3) {
            Some(value) => *value,
            None => continue,
        };
        if parse_port_from_addr_token(local_addr) != Some(port) {
            continue;
        }
        for token in line.split(|ch: char| ch.is_whitespace() || matches!(ch, '(' | ')' | ',')) {
            if let Some(value) = token.strip_prefix("pid=") {
                if let Ok(pid) = value.parse::<u32>() {
                    return Some(pid);
                }
            }
        }
    }
    None
}

/// Parses Linux `netstat -ltnp` output and resolves the listener PID for the requested port.
///
/// `output`: raw stdout payload returned by Linux `netstat`.
/// `port`: TCP port that should be matched.
#[cfg(any(test, target_os = "linux"))]
fn parse_linux_netstat_listener_pid(output: &str, port: u16) -> Option<u32> {
    for line in output.lines() {
        if !line.contains("LISTEN") {
            continue;
        }
        let columns: Vec<&str> = line.split_whitespace().collect();
        let local_addr = match columns.get(3) {
            Some(value) => *value,
            None => continue,
        };
        if parse_port_from_addr_token(local_addr) != Some(port) {
            continue;
        }
        for token in line.split_whitespace().rev() {
            if token == "-" {
                continue;
            }
            if let Some((pid_str, _)) = token.split_once('/') {
                if let Ok(pid) = pid_str.parse::<u32>() {
                    return Some(pid);
                }
            }
        }
    }
    None
}

/// Parses Windows `netstat -ano -p tcp` output and resolves the listener PID for the requested port.
///
/// `output`: raw stdout payload returned by Windows `netstat`.
/// `port`: TCP port that should be matched.
#[cfg(any(test, target_os = "windows"))]
fn parse_windows_netstat_listener_pid(output: &str, port: u16) -> Option<u32> {
    for line in output.lines() {
        let columns: Vec<&str> = line.split_whitespace().collect();
        if columns.len() < 5 {
            continue;
        }
        if !columns[0].eq_ignore_ascii_case("TCP") {
            continue;
        }
        if !columns[3].to_ascii_uppercase().contains("LISTEN") {
            continue;
        }
        if parse_port_from_addr_token(columns[1]) != Some(port) {
            continue;
        }
        if let Ok(pid) = columns[4].parse::<u32>() {
            return Some(pid);
        }
    }
    None
}

/// Reads `lsof` output and resolves the listener PID for the requested port.
///
/// `port`: TCP port that should be matched.
#[cfg(unix)]
async fn find_listener_pid_with_lsof(port: u16) -> Option<u32> {
    let target = format!(":{port}");
    let output = match tokio_command("lsof")
        .args(["-nP", "-iTCP"])
        .arg(&target)
        .args(["-sTCP:LISTEN", "-t"])
        .output()
        .await
    {
        Ok(output) => output,
        Err(err) if err.kind() == ErrorKind::NotFound => return None,
        Err(_) => return None,
    };

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        if output.status.code() == Some(1) && stdout.trim().is_empty() && stderr.trim().is_empty() {
            return None;
        }
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .find_map(|line| line.trim().parse::<u32>().ok())
}

/// Reads Linux `ss -ltnp` output and resolves the listener PID for the requested port.
///
/// `port`: TCP port that should be matched.
#[cfg(target_os = "linux")]
async fn find_listener_pid_with_ss(port: u16) -> Option<u32> {
    let output = match tokio_command("ss").args(["-ltnp"]).output().await {
        Ok(output) => output,
        Err(err) if err.kind() == ErrorKind::NotFound => return None,
        Err(_) => return None,
    };
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_ss_listener_pid(&stdout, port)
}

/// Reads Linux `netstat -ltnp` output and resolves the listener PID for the requested port.
///
/// `port`: TCP port that should be matched.
#[cfg(target_os = "linux")]
async fn find_listener_pid_with_linux_netstat(port: u16) -> Option<u32> {
    let output = match tokio_command("netstat").args(["-ltnp"]).output().await {
        Ok(output) => output,
        Err(err) if err.kind() == ErrorKind::NotFound => return None,
        Err(_) => return None,
    };
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_linux_netstat_listener_pid(&stdout, port)
}

/// Reads Windows `netstat -ano -p tcp` output and resolves the listener PID for the requested port.
///
/// `port`: TCP port that should be matched.
#[cfg(target_os = "windows")]
async fn find_listener_pid_with_windows_netstat(port: u16) -> Option<u32> {
    let output = match tokio_command("netstat")
        .args(["-ano", "-p", "tcp"])
        .output()
        .await
    {
        Ok(output) => output,
        Err(err) if err.kind() == ErrorKind::NotFound => return None,
        Err(_) => return None,
    };
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_windows_netstat_listener_pid(&stdout, port)
}

/// Finds the listener PID for the provided local TCP port.
///
/// `port`: local TCP port that should be matched.
#[cfg(unix)]
pub async fn find_listener_pid(port: u16) -> Option<u32> {
    if let Some(pid) = find_listener_pid_with_lsof(port).await {
        return Some(pid);
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(pid) = find_listener_pid_with_ss(port).await {
            return Some(pid);
        }
        if let Some(pid) = find_listener_pid_with_linux_netstat(port).await {
            return Some(pid);
        }
    }

    None
}

/// Finds the listener PID for the provided local TCP port.
///
/// `port`: local TCP port that should be matched.
#[cfg(target_os = "windows")]
pub async fn find_listener_pid(port: u16) -> Option<u32> {
    find_listener_pid_with_windows_netstat(port).await
}

/// Finds the listener PID for the provided local TCP port.
///
/// `port`: local TCP port that should be matched.
#[cfg(not(any(unix, target_os = "windows")))]
pub async fn find_listener_pid(_port: u16) -> Option<u32> {
    None
}

/// Extracts the port from a loopback or unspecified listen address.
///
/// `listen_addr`: socket address that should represent a local bind target.
pub fn local_listener_port(listen_addr: &str) -> Option<u16> {
    let addr = listen_addr.trim().parse::<SocketAddr>().ok()?;
    let ip = addr.ip();
    if ip.is_loopback() || ip.is_unspecified() {
        Some(addr.port())
    } else {
        None
    }
}

/// Ensures that the listen address can be bound before spawning a TCP server.
///
/// `target_name`: human-readable service name that is trying to bind.
/// `listen_addr`: socket address that should be checked.
pub async fn ensure_listen_addr_available(
    target_name: &str,
    listen_addr: &str,
) -> Result<(), String> {
    match tokio::net::TcpListener::bind(listen_addr).await {
        Ok(listener) => {
            drop(listener);
            Ok(())
        }
        Err(error) => {
            if is_addr_in_use_error(&error) {
                let pid = match local_listener_port(listen_addr) {
                    Some(port) => find_listener_pid(port).await,
                    None => None,
                };
                return Err(occupied_listen_addr_message(target_name, listen_addr, pid));
            }
            Err(format!(
                "Cannot start {target_name} because {listen_addr} is unavailable: {error}"
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_listen_addr_available, local_listener_port, occupied_listen_addr_message,
        parse_linux_netstat_listener_pid, parse_ss_listener_pid,
        parse_windows_netstat_listener_pid,
    };

    #[test]
    fn occupied_message_includes_pid_when_available() {
        let message =
            occupied_listen_addr_message("mobile access daemon", "0.0.0.0:4732", Some(4321));
        assert!(message.contains("PID 4321"));
    }

    #[test]
    fn occupied_message_omits_pid_when_missing() {
        let message = occupied_listen_addr_message("mobile access daemon", "0.0.0.0:4732", None);
        assert!(!message.contains("PID"));
    }

    #[test]
    fn local_listener_port_allows_local_addresses_only() {
        assert_eq!(local_listener_port("127.0.0.1:4732"), Some(4732));
        assert_eq!(local_listener_port("[::1]:4732"), Some(4732));
        assert_eq!(local_listener_port("0.0.0.0:4732"), Some(4732));
        assert_eq!(local_listener_port("[::]:4732"), Some(4732));
        assert_eq!(local_listener_port("192.168.1.42:4732"), None);
        assert_eq!(local_listener_port("100.64.0.1:4732"), None);
    }

    #[test]
    fn ensure_listen_addr_available_reports_addr_in_use() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");

        runtime.block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .expect("bind ephemeral listener");
            let occupied = listener.local_addr().expect("local addr").to_string();

            let error = ensure_listen_addr_available("mobile access daemon", &occupied)
                .await
                .expect_err("expected occupied port error");
            assert!(error.contains("already in use by another process"));
        });
    }

    #[test]
    fn parses_pid_from_ss_output() {
        let output = r#"State  Recv-Q Send-Q Local Address:Port Peer Address:PortProcess
LISTEN 0      4096   0.0.0.0:4732      0.0.0.0:*    users:(("codex-monitor-da",pid=12345,fd=7))
"#;
        assert_eq!(parse_ss_listener_pid(output, 4732), Some(12345));
        assert_eq!(parse_ss_listener_pid(output, 9000), None);
    }

    #[test]
    fn parses_pid_from_linux_netstat_output() {
        let output = r#"Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name
tcp        0      0 0.0.0.0:4732            0.0.0.0:*               LISTEN      6789/codex-monitor-da
"#;
        assert_eq!(parse_linux_netstat_listener_pid(output, 4732), Some(6789));
        assert_eq!(parse_linux_netstat_listener_pid(output, 9000), None);
    }

    #[test]
    fn parses_pid_from_windows_netstat_output() {
        let output = r#"Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:4732           0.0.0.0:0              LISTENING       24680
  TCP    [::]:4732              [::]:0                 LISTENING       24680
"#;
        assert_eq!(
            parse_windows_netstat_listener_pid(output, 4732),
            Some(24680)
        );
        assert_eq!(parse_windows_netstat_listener_pid(output, 9000), None);
    }

    #[test]
    fn ss_parser_does_not_match_port_prefix() {
        let output = r#"State  Recv-Q Send-Q Local Address:Port Peer Address:PortProcess
LISTEN 0      4096   0.0.0.0:47320     0.0.0.0:*    users:(("other",pid=45678,fd=7))
"#;
        assert_eq!(parse_ss_listener_pid(output, 4732), None);
    }

    #[test]
    fn linux_netstat_parser_does_not_match_port_prefix() {
        let output = r#"Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name
tcp        0      0 0.0.0.0:47320           0.0.0.0:*               LISTEN      8765/other
"#;
        assert_eq!(parse_linux_netstat_listener_pid(output, 4732), None);
    }

    #[test]
    fn windows_netstat_parser_does_not_match_port_prefix() {
        let output = r#"Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:47320          0.0.0.0:0              LISTENING       13579
"#;
        assert_eq!(parse_windows_netstat_listener_pid(output, 4732), None);
    }
}
