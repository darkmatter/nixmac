use crate::privileged_helper::protocol::{
    ActivateStorePathRequest, HELPER_SOCKET_DIR, HELPER_SOCKET_PATH, HelperRequest, HelperResponse,
    canonical_link_shell_snippet, validate_canonical_activate_path, validate_canonical_link_target,
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

pub fn run_daemon() -> Result<()> {
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
    let response = match peer_identity(&stream).and_then(|peer| authorize_request(&peer, &request))
    {
        Ok(()) => handle_request(request),
        Err(error) => HelperResponse::error(-1, error.to_string()),
    };
    serde_json::to_writer(&mut stream, &response)?;
    stream.write_all(b"\n")?;
    stream.flush()?;
    Ok(())
}

pub fn handle_request(request: HelperRequest) -> HelperResponse {
    match request {
        HelperRequest::Status => HelperResponse::ok("nixmac helper ready"),
        HelperRequest::ActivateStorePath { request } => match activate_store_path(&request) {
            Ok(response) => response,
            Err(error) => HelperResponse::error(-1, error.to_string()),
        },
    }
}

fn activate_store_path(request: &ActivateStorePathRequest) -> Result<HelperResponse> {
    validate_activation_request(request)?;
    let script = root_activation_script(request)?;
    let output = Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .output()
        .context("failed to execute activation shell")?;

    Ok(HelperResponse {
        ok: output.status.success(),
        code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        error: None,
    })
}

pub fn validate_activation_request(request: &ActivateStorePathRequest) -> Result<()> {
    validate_canonical_activate_path(&request.activate_path)?;
    if let Some(target) = &request.canonical_link_target {
        validate_canonical_link_target(target)?;
        // Checked here, as root: the link must point at a real directory.
        if !Path::new(target).is_dir() {
            bail!("canonical link target is not a directory: {target}");
        }
    }
    if request.user_name.trim().is_empty() {
        bail!("activation user is required");
    }
    if request.home.trim().is_empty() {
        bail!("activation home is required");
    }
    if request.nix_path.trim().is_empty() {
        bail!("activation PATH is required");
    }

    let id_output = Command::new("/usr/bin/id")
        .args(["-u", &request.user_name])
        .output()
        .with_context(|| format!("failed to look up user {}", request.user_name))?;
    if !id_output.status.success() {
        bail!("activation user {} does not exist", request.user_name);
    }
    let actual_uid = String::from_utf8_lossy(&id_output.stdout)
        .trim()
        .parse::<u32>()
        .context("failed to parse user id")?;
    if actual_uid != request.user_id {
        bail!(
            "activation user id mismatch for {}: expected {}, got {}",
            request.user_name,
            request.user_id,
            actual_uid
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

    if let HelperRequest::ActivateStorePath { request } = request {
        if peer.uid != request.user_id {
            bail!(
                "activation peer uid {} does not match requested uid {}",
                peer.uid,
                request.user_id
            );
        }
    }

    Ok(())
}

#[derive(Debug, Clone)]
struct PeerIdentity {
    uid: u32,
    executable: Option<String>,
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

pub fn root_activation_script(request: &ActivateStorePathRequest) -> Result<String> {
    validate_canonical_activate_path(&request.activate_path)?;
    let sudoers_path = "/etc/sudoers.d/nixmac-activate-helper";
    let ssh_sock = request.ssh_auth_sock.as_deref().unwrap_or("");
    // The canonical-link lines run after activation succeeded (`set -e`) and
    // are best-effort themselves — a link failure must not fail the apply.
    let canonical_link = match &request.canonical_link_target {
        Some(target) => {
            validate_canonical_link_target(target)?;
            format!("{}\n", canonical_link_shell_snippet(target))
        }
        None => String::new(),
    };
    Ok(format!(
        "set -e\n\
         ACTIVATE='{activate}'\n\
         USER_ID='{user_id}'\n\
         USER_NAME='{user_name}'\n\
         trap 'rm -f {sudoers_path}' EXIT\n\
         printf '%s ALL=(ALL) NOPASSWD: %s\\n' \"$USER_NAME\" \"$ACTIVATE\" > {sudoers_path}\n\
         chmod 440 {sudoers_path}\n\
         visudo -cf {sudoers_path} >/dev/null\n\
         export PATH='{path}'\n\
         export HOME='{home}'\n\
         export SSH_AUTH_SOCK='{sock}'\n\
         launchctl asuser \"$USER_ID\" sudo -E -n \"$ACTIVATE\" 2>&1\n\
         SYSTEM_PATH=$(dirname \"$ACTIVATE\")\n\
         nix-env -p /nix/var/nix/profiles/system --set \"$SYSTEM_PATH\" || true\n\
         {canonical_link}",
        activate = shell_single_quote(&request.activate_path),
        user_id = request.user_id,
        user_name = shell_single_quote(&request.user_name),
        path = shell_single_quote(&request.nix_path),
        home = shell_single_quote(&request.home),
        sock = shell_single_quote(ssh_sock),
    ))
}

fn shell_single_quote(value: &str) -> String {
    value.replace('\'', "'\\''")
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
            nix_path: "/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin".to_string(),
            canonical_link_target: None,
        }
    }

    #[test]
    fn root_activation_script_contains_exact_activate_path() {
        let script = root_activation_script(&request(
            "/nix/store/abc123-darwin-system-25.05.20260629/activate",
        ))
        .expect("build script");

        assert!(script.contains("/nix/store/abc123-darwin-system-25.05.20260629/activate"));
        assert!(script.contains("launchctl asuser"));
        assert!(script.contains("NOPASSWD"));
    }

    #[test]
    fn root_activation_script_rejects_non_store_path() {
        assert!(root_activation_script(&request("/tmp/activate")).is_err());
    }

    #[test]
    fn root_activation_script_appends_canonical_link_after_activation() {
        let mut with_link = request("/nix/store/abc123-darwin-system-25.05.20260629/activate");
        with_link.canonical_link_target = Some("/Users/alice/.darwin".to_string());

        let script = root_activation_script(&with_link).expect("build script");

        let activate_pos = script.find("launchctl asuser").expect("activation line");
        let link_pos = script
            .find("ln -sfn '/Users/alice/.darwin' '/etc/nix-darwin' || true")
            .expect("link line");
        assert!(link_pos > activate_pos, "link must run after activation");
    }

    #[test]
    fn root_activation_script_omits_link_lines_without_target() {
        let script = root_activation_script(&request(
            "/nix/store/abc123-darwin-system-25.05.20260629/activate",
        ))
        .expect("build script");

        assert!(!script.contains("ln -sfn"));
    }

    #[test]
    fn root_activation_script_rejects_relative_link_target() {
        let mut with_link = request("/nix/store/abc123-darwin-system-25.05.20260629/activate");
        with_link.canonical_link_target = Some("relative/dir".to_string());

        assert!(root_activation_script(&with_link).is_err());
    }

    #[test]
    fn helper_status_request_returns_ready_response() {
        let response = handle_request(HelperRequest::Status);

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
