use crate::privileged_helper::peer_auth::{self, PeerIdentity};
use crate::privileged_helper::protocol::{
    ActivateStorePathRequest, HELPER_SOCKET_DIR, HELPER_SOCKET_PATH, HELPER_WARNING_PREFIX,
    HelperOp, HelperRequest, HelperResponse, UNAUTHORIZED_CLIENT_ERROR,
    validate_canonical_activate_path,
};
use anyhow::{Context, Result, anyhow, bail};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::process::Command;

/// Post-auth cap on the request line; real requests are well under 4 KiB.
const MAX_REQUEST_BYTES: u64 = 64 * 1024;

/// Fixed PATH for the privileged activation: root-owned system and Nix
/// profile directories only. The protocol has no field for a requester to
/// offer a PATH, so nothing requester-supplied reaches root command lookup.
const ACTIVATION_PATH_ENV: &str =
    "/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const SYSTEM_PROFILE: &str = "/nix/var/nix/profiles/system";
const NIX_ENV_CANDIDATES: [&str; 2] = [
    "/nix/var/nix/profiles/default/bin/nix-env",
    "/run/current-system/sw/bin/nix-env",
];
const EXECUTE_BITS: u32 = 0o111;
const OTHER_WRITE_BIT: u32 = 0o002;
const GROUP_WRITE_BIT: u32 = 0o020;
const STICKY_BIT: u32 = 0o1000;
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
        Ok(peer) => respond_authorized(&peer, &stream)?,
        Err(error) => HelperResponse::error(-1, format!("{UNAUTHORIZED_CLIENT_ERROR}: {error:#}")),
    };
    serde_json::to_writer(&mut stream, &response)?;
    stream.write_all(b"\n")?;
    stream.flush()?;
    Ok(())
}

/// Post-authorization request handling: only a request that clears the
/// version gate reaches an operation handler; anything else — version skew,
/// a v1 shape, unknown fields, framing violations — becomes a versioned
/// protocol-error response without an operation being derived.
fn respond_authorized(peer: &PeerIdentity, stream: &UnixStream) -> Result<HelperResponse> {
    Ok(match read_request(stream.try_clone()?) {
        Ok(op) => handle_request(peer, op),
        Err(error) => HelperResponse::error(-1, error.to_string()),
    })
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

/// Reads one framed request and returns the operation only if the sender
/// speaks this daemon's protocol version. A version mismatch and an
/// unrecognized field are both hard errors here, so no operation is derived
/// from a request the daemon does not fully understand.
fn read_request(stream: impl Read) -> Result<HelperOp> {
    let mut line = String::new();
    BufReader::new(stream)
        .take(MAX_REQUEST_BYTES)
        .read_line(&mut line)?;
    if !line.ends_with('\n') && line.len() as u64 >= MAX_REQUEST_BYTES {
        bail!("request exceeds {MAX_REQUEST_BYTES} bytes");
    }
    HelperRequest::parse(&line)
}

fn handle_request(peer: &PeerIdentity, op: HelperOp) -> HelperResponse {
    match op {
        HelperOp::Status => HelperResponse::ok("nixmac helper ready"),
        HelperOp::ActivateStorePath(request) => match activate_store_path(peer, &request) {
            Ok(response) => response,
            Err(error) => HelperResponse::error(-1, error.to_string()),
        },
    }
}

fn activate_store_path(
    peer: &PeerIdentity,
    request: &ActivateStorePathRequest,
) -> Result<HelperResponse> {
    let activate_path = canonical_activation_target(&request.activate_path)?;
    let argv = activation_argv_for_peer(peer, &activate_path)?;
    let (status, mut stdout) = run_activation_command(&argv)?;

    // Profile maintenance runs only after a successful activation and is
    // best-effort: the system switch already happened, so its failures
    // surface as warnings instead of failing the apply.
    if status.success() {
        for warning in post_activation_maintenance(&activate_path) {
            stdout.push_str(&format!("\n{HELPER_WARNING_PREFIX} {warning}"));
        }
    }

    Ok(HelperResponse::from_exit(
        status.success(),
        status.code().unwrap_or(-1),
        stdout,
    ))
}

/// Resolves and authorizes the activation target at the privileged boundary,
/// immediately before execution. The client's own canonicalization is a
/// convenience, never a security input: a lexically valid request path can
/// still contain symlinked or requester-writable components. The path is
/// canonicalized here, revalidated, and every component is proved immutable
/// to the (non-root) requester before root executes it. Shared by the helper
/// daemon and the interactive fallback's root re-entry
/// (`privileged_helper::root_activation`).
pub(crate) fn canonical_activation_target(activate_path: &str) -> Result<String> {
    // Lexical shape first, so a relative or non-store request never reaches
    // the filesystem (`canonicalize` would resolve it against the daemon's
    // cwd).
    validate_canonical_activate_path(activate_path)?;
    let canonical = fs::canonicalize(activate_path)
        .with_context(|| format!("failed to resolve activation path {activate_path}"))?;
    let canonical = validate_canonical_activate_path(canonical)?;
    check_activation_path_unwritable(&canonical)?;
    canonical
        .into_os_string()
        .into_string()
        .map_err(|path| anyhow!("canonical activation path is not valid UTF-8: {path:?}"))
}

/// Walks every component of the canonical activation path — `/`, `/nix`,
/// `/nix/store`, the store item, and the activate executable — and rejects
/// any the requester could retarget. Root ownership plus no group/other
/// write access is what makes check-then-exec sound here: once the walk
/// passes, a non-root requester cannot swap any component between this walk
/// and the exec.
fn check_activation_path_unwritable(canonical: &Path) -> Result<()> {
    let mut chain: Vec<&Path> = canonical.ancestors().collect();
    chain.reverse();
    for path in &chain {
        let metadata = fs::symlink_metadata(path)
            .with_context(|| format!("failed to inspect {}", path.display()))?;
        check_component_metadata(path, &metadata, *path == canonical)?;
    }
    Ok(())
}

fn check_component_metadata(
    path: &Path,
    metadata: &fs::Metadata,
    is_activation_target: bool,
) -> Result<()> {
    // The path was resolved a moment ago, so a symlink here means the tree
    // changed underneath us.
    if metadata.file_type().is_symlink() {
        bail!("{} is a symlink", path.display());
    }
    if is_activation_target {
        if !metadata.is_file() {
            bail!("activation target {} is not a regular file", path.display());
        }
        if metadata.mode() & EXECUTE_BITS == 0 {
            bail!("activation target {} is not executable", path.display());
        }
    } else if !metadata.is_dir() {
        bail!("{} is not a directory", path.display());
    }
    check_component_policy(path, metadata.uid(), metadata.mode(), metadata.is_dir())
}

/// Ownership/mode policy for one path component: root-owned, never
/// world-writable, and never group-writable — except the store root itself,
/// which is 1775 root:nixbld in the standard multi-user layout. The sticky
/// bit stops group members from replacing or removing the resolved store
/// item, and creating unrelated siblings gains them nothing. That is not
/// true anywhere else on the path: entries created *inside* a store item
/// sit next to the activation executable, so the exception must never
/// extend past `/nix/store`.
fn check_component_policy(path: &Path, owner_uid: u32, mode: u32, is_dir: bool) -> Result<()> {
    if owner_uid != 0 {
        bail!("{} is owned by uid {owner_uid}, not root", path.display());
    }
    if mode & OTHER_WRITE_BIT != 0 {
        bail!("{} is world-writable", path.display());
    }
    let sticky_store_root = is_dir && mode & STICKY_BIT != 0 && path == Path::new("/nix/store");
    if mode & GROUP_WRITE_BIT != 0 && !sticky_store_root {
        bail!("{} is group-writable", path.display());
    }
    Ok(())
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
/// SSH_AUTH_SOCK is deliberately absent: builds and fetches already ran as
/// the user, so privileged activation receives no capability to reach a
/// user's SSH agent.
pub(crate) fn activation_argv(uid: u32, account: &UserAccount, activate_path: &str) -> Vec<String> {
    vec![
        "/bin/launchctl".to_string(),
        "asuser".to_string(),
        uid.to_string(),
        "/usr/bin/env".to_string(),
        "-i".to_string(),
        format!("PATH={ACTIVATION_PATH_ENV}"),
        format!("HOME={}", account.home),
        format!("USER={}", account.name),
        format!("LOGNAME={}", account.name),
        activate_path.to_string(),
    ]
}

/// The privileged command for one authenticated peer. Every
/// requester-derived input comes from the peer's socket credentials: the
/// account is looked up by the authenticated uid — the protocol has no field
/// to override it — and that uid, name, and home populate the activation
/// argv and environment.
fn activation_argv_for_peer(peer: &PeerIdentity, activate_path: &str) -> Result<Vec<String>> {
    let account = user_account(peer.euid)?;
    Ok(activation_argv(peer.euid, &account, activate_path))
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
    #[cfg(target_os = "macos")]
    use crate::privileged_helper::protocol::HELPER_PROTOCOL_VERSION;

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
        );

        assert_eq!(argv[0], "/bin/launchctl");
        assert_eq!(&argv[1..3], ["asuser", "501"]);
        assert_eq!(&argv[3..5], ["/usr/bin/env", "-i"]);
        assert!(argv.contains(&format!("PATH={ACTIVATION_PATH_ENV}")));
        // Account values come from the peer lookup. The protocol no longer
        // has fields for a client to claim these with.
        assert!(argv.contains(&"HOME=/Users/peer-alice".to_string()));
        assert!(argv.contains(&"USER=peer-alice".to_string()));
        assert_eq!(
            argv.last().map(String::as_str),
            Some("/nix/store/abc123-darwin-system-25.05.20260629/activate")
        );
    }

    #[test]
    fn activation_argv_never_builds_shell_sudoers_or_agent_access() {
        let argv = activation_argv(
            501,
            &account(),
            "/nix/store/abc123-darwin-system-25.05.20260629/activate",
        );

        assert!(!argv.iter().any(|arg| arg.contains("/bin/sh")));
        assert!(!argv.iter().any(|arg| arg.contains("sudo")));
        assert!(!argv.iter().any(|arg| arg.contains("sudoers")));
        // The privileged activation deliberately receives no capability to
        // reach a user's SSH agent.
        assert!(!argv.iter().any(|arg| arg.starts_with("SSH_AUTH_SOCK=")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn helper_status_request_returns_ready_response() {
        // A status request never inspects the peer; any real identity works.
        let (stream, _other_end) = UnixStream::pair().expect("socketpair");
        let peer = peer_auth::peer_identity(&stream).expect("peer identity");
        let response = handle_request(&peer, HelperOp::Status);

        assert!(response.ok);
        assert_eq!(response.code, 0);
        assert_eq!(response.protocol_version, HELPER_PROTOCOL_VERSION);
        assert!(!response.helper_build_version.is_empty());
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
    fn component_policy_accepts_root_owned_unwritable_components() {
        let path = Path::new("/nix");
        assert!(check_component_policy(path, 0, 0o755, true).is_ok());
        assert!(check_component_policy(path, 0, 0o555, false).is_ok());
    }

    #[test]
    fn component_policy_accepts_sticky_group_writable_store_dir() {
        // The standard multi-user store: drwxrwxr-t root:nixbld.
        assert!(check_component_policy(Path::new("/nix/store"), 0, 0o1775, true).is_ok());
    }

    #[test]
    fn component_policy_rejects_non_root_owner() {
        let error =
            check_component_policy(Path::new("/nix/store/item"), 501, 0o755, true).unwrap_err();

        assert!(error.to_string().contains("not root"));
    }

    #[test]
    fn component_policy_rejects_group_writable_without_sticky() {
        assert!(check_component_policy(Path::new("/nix"), 0, 0o775, true).is_err());
        // The sticky exception applies to directories only, never to the
        // activate executable itself.
        let file = Path::new("/nix/store/item/activate");
        assert!(check_component_policy(file, 0, 0o1775, false).is_err());
    }

    #[test]
    fn component_policy_limits_sticky_exception_to_the_store_root() {
        // Group members can create entries in any sticky group-writable
        // directory, so a 1775 store *item* is not immutable — only the
        // store root itself gets the exception.
        let item = Path::new("/nix/store/item");
        assert!(check_component_policy(item, 0, 0o1775, true).is_err());
    }

    #[test]
    fn component_policy_rejects_world_writable_even_with_sticky() {
        // A /tmp-shaped directory (drwxrwxrwt) must never pass.
        assert!(check_component_policy(Path::new("/tmp"), 0, 0o1777, true).is_err());
    }

    #[test]
    fn component_metadata_rejects_symlinks() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("target");
        fs::create_dir(&target).expect("create target dir");
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&target, &link).expect("create symlink");

        let metadata = fs::symlink_metadata(&link).expect("lstat link");
        let error = check_component_metadata(&link, &metadata, false).unwrap_err();

        assert!(error.to_string().contains("symlink"));
    }

    #[test]
    fn component_metadata_rejects_non_executable_or_non_file_target() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("activate");
        fs::write(&file, "#!/bin/sh\n").expect("write file");
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).expect("chmod");

        let metadata = fs::symlink_metadata(&file).expect("lstat file");
        let error = check_component_metadata(&file, &metadata, true).unwrap_err();
        assert!(error.to_string().contains("not executable"));

        let dir_metadata = fs::symlink_metadata(dir.path()).expect("lstat dir");
        let error = check_component_metadata(dir.path(), &dir_metadata, true).unwrap_err();
        assert!(error.to_string().contains("not a regular file"));
    }

    #[test]
    fn activation_walk_rejects_requester_writable_tree() {
        // A tempdir tree is owned by the (non-root) test user — exactly what
        // the walk exists to reject. Canonicalized first so the macOS /var
        // symlink does not short-circuit the walk before the ownership check.
        let dir = tempfile::tempdir().expect("tempdir");
        let item = dir
            .path()
            .canonicalize()
            .expect("canonicalize")
            .join("item");
        fs::create_dir(&item).expect("create item dir");
        let activate = item.join("activate");
        fs::write(&activate, "#!/bin/sh\n").expect("write activate");
        fs::set_permissions(&activate, fs::Permissions::from_mode(0o755)).expect("chmod");

        let error = check_activation_path_unwritable(&activate).unwrap_err();

        // macOS tempdirs live under /var/folders and trip the ownership
        // check; on Linux the walk crosses /tmp (1777 root) first and trips
        // the world-writable check. Either way the requester-writable tree
        // is rejected.
        let message = error.to_string();
        assert!(
            message.contains("not root") || message.contains("world-writable"),
            "unexpected rejection: {message}"
        );
    }

    #[test]
    fn canonical_target_rejects_non_store_and_missing_paths() {
        assert!(canonical_activation_target("/tmp/activate").is_err());
        assert!(canonical_activation_target("/nix/store/no-such-item-c1-test/activate").is_err());
    }

    fn framed(request: &HelperRequest) -> Vec<u8> {
        let mut body = serde_json::to_vec(request).expect("serialize request");
        body.push(b'\n');
        body
    }

    #[cfg(target_os = "macos")]
    fn authorized_response_to(body: &[u8]) -> HelperResponse {
        let (client, server) = UnixStream::pair().expect("socketpair");
        let peer = peer_auth::peer_identity(&server).expect("peer identity");
        (&client).write_all(body).expect("write request");

        respond_authorized(&peer, &server).expect("responds")
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn authorized_current_version_request_crosses_the_gate_to_the_handler() {
        let response = authorized_response_to(&framed(&HelperRequest::new(HelperOp::Status)));

        assert!(response.ok);
        assert_eq!(response.stdout, "nixmac helper ready");
        assert_eq!(response.protocol_version, HELPER_PROTOCOL_VERSION);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn version_rejection_becomes_a_versioned_protocol_error_without_a_handler() {
        // Missing, lower, and higher versions, each on a body the version
        // gate must stop. `ok: false` on the status shape proves the status
        // handler never ran (it would answer ok "ready"); the skew
        // classification on the others — whose operations are invalid or
        // carry the v1 claimed fields — proves the gate rejected them before
        // any operation shape was interpreted, let alone executed.
        for body in [
            // Missing: v1 status, no version field at all.
            "{\"op\":\"status\"}\n".to_string(),
            // Missing: v1 activation carrying the claimed identity/PATH fields.
            r#"{"op":"activateStorePath","request":{"activatePath":"/nix/store/abc-darwin-system/activate","userName":"alice","userId":501,"home":"/Users/alice","nixPath":"/tmp/attacker-bin"}}
"#
            .to_string(),
            // Lower and higher versions on deliberately invalid operations.
            "{\"protocolVersion\":1,\"op\":\"selfDestruct\"}\n".to_string(),
            format!(
                "{{\"protocolVersion\":{},\"op\":\"selfDestruct\"}}\n",
                HELPER_PROTOCOL_VERSION + 1
            ),
        ] {
            let response = authorized_response_to(body.as_bytes());

            assert!(!response.ok);
            assert_eq!(response.protocol_version, HELPER_PROTOCOL_VERSION);
            assert!(!response.helper_build_version.is_empty());
            assert!(response.reports_protocol_skew());
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn activation_argv_derives_from_the_authenticated_peer_account() {
        // The peer identity of a socketpair end is this test process, so the
        // argv must carry this process's uid and its user-database account —
        // the lookup keys on the authenticated uid and nothing else.
        let (stream, _other_end) = UnixStream::pair().expect("socketpair");
        let peer = peer_auth::peer_identity(&stream).expect("peer identity");
        let me = nix::unistd::User::from_uid(nix::unistd::Uid::from_raw(peer.euid))
            .expect("user lookup")
            .expect("account exists");

        let argv = activation_argv_for_peer(&peer, "/nix/store/abc-darwin-system/activate")
            .expect("argv for peer");

        assert_eq!(argv[1], "asuser");
        assert_eq!(argv[2], peer.euid.to_string());
        assert!(argv.contains(&format!("USER={}", me.name)));
        assert!(argv.contains(&format!("HOME={}", me.dir.display())));
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

        // Authorization errors are versioned responses like every other:
        // the strict client-side parse must accept the reply.
        let response = HelperResponse::parse(&reply).expect("versioned response");
        assert!(!response.ok);
        assert_eq!(response.protocol_version, HELPER_PROTOCOL_VERSION);
        assert!(!response.helper_build_version.is_empty());
        assert!(response.reports_unauthorized_client());
    }
}
