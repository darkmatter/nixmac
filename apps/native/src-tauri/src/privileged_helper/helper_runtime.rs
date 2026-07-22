use crate::privileged_helper::peer_auth::{self, PeerIdentity};
use crate::privileged_helper::protocol::{
    ActivateStorePathRequest, HELPER_SOCKET_DIR, HELPER_SOCKET_PATH, HELPER_WARNING_PREFIX,
    HelperRequest, HelperResponse, UNAUTHORIZED_CLIENT_ERROR, validate_canonical_activate_path,
};
use anyhow::{Context, Result, bail};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::process::Command;

/// Post-auth cap on the request line; real requests are well under 4 KiB.
const MAX_REQUEST_BYTES: u64 = 64 * 1024;

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
    let admin_gid = admin_group_id();
    if let Some(console_uid) = peer_auth::console_user_uid() {
        let _ = std::os::unix::fs::chown(socket_path, Some(console_uid), admin_gid);
        fs::set_permissions(socket_path, fs::Permissions::from_mode(0o600))?;
    } else {
        let _ = std::os::unix::fs::chown(socket_path, Some(0), admin_gid);
        fs::set_permissions(socket_path, fs::Permissions::from_mode(0o660))?;
    }
    Ok(())
}

/// Gid of the macOS `admin` group, the socket's group owner.
fn admin_group_id() -> Option<u32> {
    nix::unistd::Group::from_name("admin")
        .ok()
        .flatten()
        .map(|group| group.gid.as_raw())
}

fn handle_stream(mut stream: UnixStream) -> Result<()> {
    // The peer is authorized from its socket credentials before the request
    // body is touched: an unauthorized peer must never reach the reader or
    // the JSON parser.
    let response = match authorize_peer(&stream) {
        Ok(peer) => match read_request(stream.try_clone()?) {
            Ok(request) => match authorize_request(&peer, &request) {
                Ok(()) => handle_request(&peer, request),
                Err(error) => HelperResponse::error(-1, error.to_string()),
            },
            Err(error) => HelperResponse::error(-1, error.to_string()),
        },
        Err(error) => HelperResponse::error(-1, format!("{UNAUTHORIZED_CLIENT_ERROR}: {error:#}")),
    };
    serde_json::to_writer(&mut stream, &response)?;
    stream.write_all(b"\n")?;
    stream.flush()?;
    Ok(())
}

fn authorize_peer(stream: &UnixStream) -> Result<PeerIdentity> {
    let peer = peer_auth::peer_identity(stream)?;
    check_peer_policy(peer.euid, peer_auth::console_user_uid())?;
    peer_auth::validate_client_code(&peer)?;
    Ok(peer)
}

/// The peer must be the active console user; root is rejected outright (the
/// GUI and sync agent always run in the user session).
fn check_peer_policy(peer_euid: u32, console_uid: Option<u32>) -> Result<()> {
    if peer_euid == 0 {
        bail!("root peers may not drive activation");
    }
    let Some(console_uid) = console_uid else {
        bail!("no active console user");
    };
    if peer_euid != console_uid {
        bail!("peer uid {peer_euid} does not match console user uid {console_uid}");
    }
    Ok(())
}

fn read_request(stream: impl Read) -> Result<HelperRequest> {
    let mut line = String::new();
    BufReader::new(stream)
        .take(MAX_REQUEST_BYTES)
        .read_line(&mut line)?;
    if !line.ends_with('\n') && line.len() as u64 >= MAX_REQUEST_BYTES {
        bail!("request exceeds {MAX_REQUEST_BYTES} bytes");
    }
    Ok(serde_json::from_str(&line)?)
}

fn handle_request(peer: &PeerIdentity, request: HelperRequest) -> HelperResponse {
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
    let account = user_account(peer.euid)?;
    let argv = activation_argv(
        peer.euid,
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

/// Request-level cross-check, after the peer itself is already authorized:
/// activation must be requested for the peer's own uid.
fn authorize_request(peer: &PeerIdentity, request: &HelperRequest) -> Result<()> {
    if let HelperRequest::ActivateStorePath { request } = request
        && peer.euid != request.user_id
    {
        bail!(
            "activation peer uid {} does not match requested uid {}",
            peer.euid,
            request.user_id
        );
    }

    Ok(())
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

    #[cfg(target_os = "macos")]
    #[test]
    fn helper_status_request_returns_ready_response() {
        // A status request never inspects the peer; any real identity works.
        let (stream, _other_end) = UnixStream::pair().expect("socketpair");
        let peer = peer_auth::peer_identity(&stream).expect("peer identity");
        let response = handle_request(&peer, HelperRequest::Status);

        assert!(response.ok);
        assert_eq!(response.code, 0);
    }

    #[test]
    fn peer_policy_rejects_root_peer() {
        assert!(check_peer_policy(0, Some(501)).is_err());
    }

    #[test]
    fn peer_policy_rejects_uid_not_matching_console_user() {
        assert!(check_peer_policy(502, Some(501)).is_err());
    }

    #[test]
    fn peer_policy_rejects_when_no_console_user() {
        assert!(check_peer_policy(501, None).is_err());
    }

    #[test]
    fn peer_policy_accepts_console_user_peer() {
        assert!(check_peer_policy(501, Some(501)).is_ok());
    }

    #[test]
    fn read_request_parses_status_request() {
        let request = read_request(&b"{\"op\":\"status\"}\n"[..]).expect("parse status");

        assert_eq!(request, HelperRequest::Status);
    }

    #[test]
    fn read_request_rejects_oversized_line() {
        let mut body = vec![b' '; MAX_REQUEST_BYTES as usize + 1];
        body.push(b'\n');

        let error = read_request(&body[..]).expect_err("oversized request must fail");

        assert!(error.to_string().contains("exceeds"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn unauthorized_peer_gets_error_response_without_its_body_being_read() {
        // The unsigned test binary can never pass code validation, so
        // handle_stream must answer with an authorization error even though
        // this end never sends a request line — proof the body is not read
        // (or parsed) before authorization.
        let (client, server) = UnixStream::pair().expect("socketpair");
        let handler = std::thread::spawn(move || handle_stream(server));

        let mut reply = String::new();
        BufReader::new(client)
            .read_line(&mut reply)
            .expect("read response");
        handler
            .join()
            .expect("handler thread")
            .expect("stream handled");

        let response: HelperResponse = serde_json::from_str(&reply).expect("response json");
        assert!(!response.ok);
        assert!(
            response
                .error
                .expect("error message")
                .contains(UNAUTHORIZED_CLIENT_ERROR)
        );
    }
}
