use crate::privileged_helper::protocol::{
    ActivateStorePathRequest, HELPER_SOCKET_DIR, HELPER_SOCKET_PATH, HELPER_WARNING_PREFIX,
    HelperRequest, HelperResponse, validate_canonical_activate_path,
};
use anyhow::{Context, Result, bail};
use std::fs;
use std::io::{BufRead, BufReader, Write};
#[cfg(target_os = "macos")]
use std::os::fd::AsRawFd;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::process::Command;

/// Fixed PATH for the privileged activation: root-owned system and Nix
/// profile directories only. The requester's `nix_path` never reaches root
/// command lookup.
const ACTIVATION_PATH_ENV: &str =
    "/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const SYSTEM_PROFILE: &str = "/nix/var/nix/profiles/system";
const NIX_ENV_CANDIDATES: [&str; 2] = [
    "/nix/var/nix/profiles/default/bin/nix-env",
    "/run/current-system/sw/bin/nix-env",
];
/// Sudoers rule older helpers created (and could leave behind on forced
/// termination). No longer written; removed on startup if present.
const LEGACY_SUDOERS_PATH: &str = "/etc/sudoers.d/nixmac-activate-helper";

pub fn run_daemon() -> Result<()> {
    if let Err(error) = fs::remove_file(LEGACY_SUDOERS_PATH)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        // Keep serving — failing startup would not remove the rule either —
        // but a stale NOPASSWD grant must never go unnoticed.
        eprintln!(
            "nixmac-helper: SECURITY: failed to remove legacy sudoers rule {LEGACY_SUDOERS_PATH}: {error}"
        );
    }
    fs::create_dir_all(HELPER_SOCKET_DIR)?;
    let socket_path = Path::new(HELPER_SOCKET_PATH);
    if socket_path.exists() {
        fs::remove_file(socket_path)?;
    }

    let listener = UnixListener::bind(socket_path)?;
    harden_socket_permissions(socket_path)?;

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                if let Err(error) = handle_stream(stream) {
                    eprintln!("nixmac-helper: request failed: {error:#}");
                }
            }
            Err(error) => eprintln!("nixmac-helper: connection failed: {error}"),
        }
    }

    Ok(())
}

fn harden_socket_permissions(socket_path: &Path) -> Result<()> {
    if let Some(console_user) = console_user() {
        let owner = format!("{console_user}:admin");
        let _ = Command::new("/usr/sbin/chown")
            .arg(owner)
            .arg(socket_path)
            .status();
        fs::set_permissions(socket_path, fs::Permissions::from_mode(0o600))?;
    } else {
        let _ = Command::new("/usr/sbin/chown")
            .arg("root:admin")
            .arg(socket_path)
            .status();
        fs::set_permissions(socket_path, fs::Permissions::from_mode(0o660))?;
    }
    Ok(())
}

fn handle_stream(mut stream: UnixStream) -> Result<()> {
    let mut line = String::new();
    BufReader::new(stream.try_clone()?).read_line(&mut line)?;
    let request: HelperRequest = serde_json::from_str(&line)?;
    let response = match peer_identity(&stream) {
        Ok(peer) => match authorize_request(&peer, &request) {
            Ok(()) => handle_request(&peer, request),
            Err(error) => HelperResponse::error(-1, error.to_string()),
        },
        Err(error) => HelperResponse::error(-1, error.to_string()),
    };
    serde_json::to_writer(&mut stream, &response)?;
    stream.write_all(b"\n")?;
    stream.flush()?;
    Ok(())
}

pub fn handle_request(peer: &PeerIdentity, request: HelperRequest) -> HelperResponse {
    match request {
        HelperRequest::Status => HelperResponse::ok("nixmac helper ready"),
        HelperRequest::ActivateStorePath { request } => match activate_store_path(peer, &request) {
            Ok(response) => response,
            Err(error) => HelperResponse::error(-1, error.to_string()),
        },
    }
}

fn activate_store_path(
    peer: &PeerIdentity,
    request: &ActivateStorePathRequest,
) -> Result<HelperResponse> {
    validate_canonical_activate_path(&request.activate_path)?;
    // Account values are derived from the socket peer credentials; the
    // request's `user_name`/`user_id`/`home` are never trusted here.
    let account = user_account(peer.uid)?;
    let argv = activation_argv(
        peer.uid,
        &account,
        &request.activate_path,
        request.ssh_auth_sock.as_deref(),
    );
    let (status, mut stdout) = run_activation_command(&argv)?;

    // Profile maintenance runs only after a successful activation and is
    // best-effort: the system switch already happened, so its failures
    // surface as warnings instead of failing the apply.
    if status.success() {
        for warning in post_activation_maintenance(&request.activate_path) {
            stdout.push_str(&format!("\n{HELPER_WARNING_PREFIX} {warning}"));
        }
    }

    Ok(HelperResponse {
        ok: status.success(),
        code: status.code().unwrap_or(-1),
        stdout,
        stderr: String::new(),
        error: None,
    })
}

/// Runs a prepared activation argv with stderr merged into stdout (the old
/// script's `2>&1`): consumers stream, log, and summarize a single output
/// stream, and the activate script writes most of its output to stderr.
/// Shared by the helper daemon and the interactive fallback's root re-entry
/// (`privileged_helper::root_activation`).
pub(crate) fn run_activation_command(
    argv: &[String],
) -> Result<(std::process::ExitStatus, String)> {
    let (mut reader, writer) = std::io::pipe().context("failed to create activation pipe")?;
    let mut command = Command::new(&argv[0]);
    command
        .args(&argv[1..])
        .stdout(
            writer
                .try_clone()
                .context("failed to clone activation pipe")?,
        )
        .stderr(writer);
    let mut child = command.spawn().context("failed to execute activation")?;
    // The command still holds write ends of the pipe; drop them so the read
    // below ends when the child (and its descendants) exit.
    drop(command);
    let mut output = Vec::new();
    std::io::Read::read_to_end(&mut reader, &mut output)
        .context("failed to read activation output")?;
    let status = child.wait().context("failed to wait for activation")?;
    Ok((status, String::from_utf8_lossy(&output).to_string()))
}

/// Direct-exec activation command: no shell, absolute programs only, a fixed
/// root-owned PATH, and an otherwise empty environment (`env -i`).
pub(crate) fn activation_argv(
    uid: u32,
    account: &UserAccount,
    activate_path: &str,
    ssh_auth_sock: Option<&str>,
) -> Vec<String> {
    let mut argv = vec![
        "/bin/launchctl".to_string(),
        "asuser".to_string(),
        uid.to_string(),
        "/usr/bin/env".to_string(),
        "-i".to_string(),
        format!("PATH={ACTIVATION_PATH_ENV}"),
        format!("HOME={}", account.home),
        format!("USER={}", account.name),
        format!("LOGNAME={}", account.name),
    ];
    if let Some(sock) = ssh_auth_sock.filter(|sock| !sock.is_empty()) {
        argv.push(format!("SSH_AUTH_SOCK={sock}"));
    }
    argv.push(activate_path.to_string());
    argv
}

pub(crate) fn post_activation_maintenance(activate_path: &str) -> Vec<String> {
    let mut warnings = Vec::new();
    if let Err(error) = set_system_profile(activate_path) {
        warnings.push(format!("failed to update system profile: {error:#}"));
    }
    warnings
}

fn set_system_profile(activate_path: &str) -> Result<()> {
    let system_path = Path::new(activate_path)
        .parent()
        .context("activation path has no parent")?;
    let nix_env = NIX_ENV_CANDIDATES
        .iter()
        .find(|candidate| Path::new(candidate).exists())
        .context("nix-env not found in root-owned profile directories")?;
    let output = Command::new(nix_env)
        .args(["-p", SYSTEM_PROFILE, "--set"])
        .arg(system_path)
        .env_clear()
        .env("PATH", ACTIVATION_PATH_ENV)
        .output()
        .context("failed to execute nix-env")?;
    if !output.status.success() {
        bail!(
            "nix-env --set failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

fn authorize_request(peer: &PeerIdentity, request: &HelperRequest) -> Result<()> {
    if !peer_executable_allowed(peer.executable.as_deref()) {
        bail!(
            "unauthorized helper client{}",
            peer.executable
                .as_deref()
                .map(|path| format!(": {path}"))
                .unwrap_or_default()
        );
    }

    if let HelperRequest::ActivateStorePath { request } = request
        && peer.uid != request.user_id
    {
        bail!(
            "activation peer uid {} does not match requested uid {}",
            peer.uid,
            request.user_id
        );
    }

    Ok(())
}

#[derive(Debug, Clone)]
pub struct PeerIdentity {
    pub uid: u32,
    pub executable: Option<String>,
}

pub(crate) struct UserAccount {
    name: String,
    home: String,
}

/// Resolves the account name and home directory for `uid` from the user
/// database, so privileged activation never trusts requester-supplied
/// account values.
#[cfg(target_os = "macos")]
pub(crate) fn user_account(uid: u32) -> Result<UserAccount> {
    let user = nix::unistd::User::from_uid(nix::unistd::Uid::from_raw(uid))
        .context("failed to look up peer account")?
        .with_context(|| format!("no account found for peer uid {uid}"))?;
    let name = user.name;
    let home = user.dir.to_string_lossy().into_owned();
    if name.is_empty() || home.is_empty() {
        bail!("peer uid {uid} resolves to an account without a name or home");
    }
    Ok(UserAccount { name, home })
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn user_account(_uid: u32) -> Result<UserAccount> {
    bail!("peer account lookup is only implemented on macOS")
}

#[cfg(target_os = "macos")]
fn peer_identity(stream: &UnixStream) -> Result<PeerIdentity> {
    let fd = stream.as_raw_fd();
    let mut uid: libc::uid_t = 0;
    let mut gid: libc::gid_t = 0;
    let result = unsafe { libc::getpeereid(fd, &mut uid, &mut gid) };
    if result != 0 {
        return Err(std::io::Error::last_os_error()).context("failed to read peer credentials");
    }

    Ok(PeerIdentity {
        uid,
        executable: peer_executable_path(fd).ok(),
    })
}

#[cfg(not(target_os = "macos"))]
fn peer_identity(_stream: &UnixStream) -> Result<PeerIdentity> {
    bail!("peer credential validation is only implemented on macOS")
}

#[cfg(target_os = "macos")]
fn peer_executable_path(fd: std::os::fd::RawFd) -> Result<String> {
    let mut pid: libc::pid_t = 0;
    let mut len = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_LOCAL,
            libc::LOCAL_PEERPID,
            (&mut pid as *mut libc::pid_t).cast(),
            &mut len,
        )
    };
    if result != 0 {
        return Err(std::io::Error::last_os_error()).context("failed to read peer pid");
    }

    executable_path_for_pid(pid)
}

#[cfg(not(target_os = "macos"))]
fn peer_executable_path(_fd: std::os::fd::RawFd) -> Result<String> {
    bail!("peer executable validation is only implemented on macOS")
}

#[cfg(target_os = "macos")]
fn executable_path_for_pid(pid: libc::pid_t) -> Result<String> {
    const PROC_PIDPATHINFO_MAXSIZE: usize = 4096;
    let mut buffer = [0u8; PROC_PIDPATHINFO_MAXSIZE];
    let len = unsafe {
        proc_pidpath(
            pid,
            buffer.as_mut_ptr().cast(),
            PROC_PIDPATHINFO_MAXSIZE as u32,
        )
    };
    if len <= 0 {
        return Err(std::io::Error::last_os_error()).context("failed to read peer executable path");
    }
    let len = len as usize;
    Ok(String::from_utf8_lossy(&buffer[..len]).to_string())
}

#[cfg(target_os = "macos")]
#[link(name = "proc")]
unsafe extern "C" {
    fn proc_pidpath(pid: libc::c_int, buffer: *mut libc::c_void, buffersize: u32) -> libc::c_int;
}

fn peer_executable_allowed(path: Option<&str>) -> bool {
    let Some(path) = path else {
        return false;
    };
    let allowed_name = path.ends_with("/nixmac") || path.ends_with("/nixmac-sync-agent");
    let allowed_location = path.contains(".app/Contents/MacOS/") || path.contains("/target/debug/");
    allowed_name && allowed_location
}

fn console_user() -> Option<String> {
    let output = Command::new("/usr/bin/stat")
        .args(["-f", "%Su", "/dev/console"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let user = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if user.is_empty() || user == "root" {
        None
    } else {
        Some(user)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(path: &str) -> ActivateStorePathRequest {
        ActivateStorePathRequest {
            activate_path: path.to_string(),
            user_name: "alice".to_string(),
            user_id: 501,
            home: "/Users/alice".to_string(),
            ssh_auth_sock: Some("/tmp/ssh.sock".to_string()),
            nix_path: "/tmp/attacker-bin:/usr/bin".to_string(),
        }
    }

    fn account() -> UserAccount {
        UserAccount {
            name: "peer-alice".to_string(),
            home: "/Users/peer-alice".to_string(),
        }
    }

    #[test]
    fn activation_argv_execs_directly_with_fixed_path_and_derived_account() {
        let argv = activation_argv(
            501,
            &account(),
            "/nix/store/abc123-darwin-system-25.05.20260629/activate",
            Some("/tmp/ssh.sock"),
        );

        assert_eq!(argv[0], "/bin/launchctl");
        assert_eq!(&argv[1..3], ["asuser", "501"]);
        assert_eq!(&argv[3..5], ["/usr/bin/env", "-i"]);
        assert!(argv.contains(&format!("PATH={ACTIVATION_PATH_ENV}")));
        // Account values come from the peer lookup, not the request.
        assert!(argv.contains(&"HOME=/Users/peer-alice".to_string()));
        assert!(argv.contains(&"USER=peer-alice".to_string()));
        assert!(!argv.iter().any(|arg| arg.contains("/tmp/attacker-bin")));
        assert!(!argv.iter().any(|arg| arg.contains("/Users/alice")));
        assert_eq!(
            argv.last().map(String::as_str),
            Some("/nix/store/abc123-darwin-system-25.05.20260629/activate")
        );
    }

    #[test]
    fn activation_argv_never_builds_shell_or_sudoers() {
        let argv = activation_argv(
            501,
            &account(),
            "/nix/store/abc123-darwin-system-25.05.20260629/activate",
            Some("/tmp/ssh.sock"),
        );

        assert!(!argv.iter().any(|arg| arg.contains("/bin/sh")));
        assert!(!argv.iter().any(|arg| arg.contains("sudo")));
        assert!(!argv.iter().any(|arg| arg.contains("sudoers")));
    }

    #[test]
    fn activation_argv_omits_ssh_sock_when_absent_or_empty() {
        for sock in [None, Some("")] {
            let argv = activation_argv(
                501,
                &account(),
                "/nix/store/abc123-darwin-system-25.05.20260629/activate",
                sock,
            );

            assert!(!argv.iter().any(|arg| arg.starts_with("SSH_AUTH_SOCK=")));
        }
    }

    #[test]
    fn helper_status_request_returns_ready_response() {
        let peer = PeerIdentity {
            uid: 501,
            executable: None,
        };
        let response = handle_request(&peer, HelperRequest::Status);

        assert!(response.ok);
        assert_eq!(response.code, 0);
    }

    #[test]
    fn peer_executable_allows_bundled_app_and_sync_agent() {
        assert!(peer_executable_allowed(Some(
            "/Applications/nixmac.app/Contents/MacOS/nixmac"
        )));
        assert!(peer_executable_allowed(Some(
            "/Applications/nixmac.app/Contents/MacOS/nixmac-sync-agent"
        )));
    }

    #[test]
    fn peer_executable_rejects_unrelated_paths() {
        assert!(!peer_executable_allowed(Some("/tmp/nixmac-sync-agent")));
        assert!(!peer_executable_allowed(Some("/bin/sh")));
        assert!(!peer_executable_allowed(None));
    }
}
