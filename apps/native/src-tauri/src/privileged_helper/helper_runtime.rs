use crate::privileged_helper::protocol::{
    ActivateStorePathRequest, COMMAND_LINE_TOOLS_GIT, HELPER_SOCKET_DIR, HELPER_SOCKET_PATH,
    HELPER_WARNING_PREFIX, HOMEBREW_PKG_TEAM_ID, HOMEBREW_PKG_URL, HOMEBREW_PKG_USER_PLIST,
    HelperRequest, HelperResponse, escape_xml, validate_canonical_activate_path,
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
        HelperRequest::InstallHomebrew => match install_homebrew(peer) {
            Ok(response) => response,
            Err(error) => HelperResponse::error(-1, error.to_string()),
        },
    }
}

/// Installs Homebrew from its official signed package.
///
/// Replaces driving `install.sh` as the user with a relayed password. That
/// script demands provable `sudo` access on macOS before it inspects anything
/// (it aborts in `have_sudo_access`, reached unconditionally near the top) and
/// refuses to run as root, so there was no arrangement of a pre-created prefix
/// that let it run unprivileged. The package needs neither: it is authenticated
/// as root, which this daemon already is, and carries its whole payload, so a
/// failed download can no longer masquerade as a completed install.
///
/// Order matters: the package is fetched into a root-only directory *first*,
/// then verified there, then installed from there. Nothing the requesting user
/// can write to is ever handed to `installer`.
fn install_homebrew(peer: &PeerIdentity) -> Result<HelperResponse> {
    let account = user_account(peer.uid)?;

    if !Path::new(COMMAND_LINE_TOOLS_GIT).exists() {
        bail!(
            "the Command Line Tools are required by Homebrew and are not installed \
             (expected {COMMAND_LINE_TOOLS_GIT})"
        );
    }

    // Root's own temp directory: not world-writable, and not reachable by the
    // requesting user, so the verified bytes cannot be swapped for others
    // between the signature check and the install.
    let work_dir = std::env::temp_dir().join(format!("nixmac-brew-{}", std::process::id()));
    let _ = fs::remove_dir_all(&work_dir);
    fs::create_dir_all(&work_dir).context("failed to create Homebrew download directory")?;
    fs::set_permissions(&work_dir, fs::Permissions::from_mode(0o700))
        .context("failed to lock down Homebrew download directory")?;
    let guard = WorkDir(work_dir.clone());
    let pkg_path = work_dir.join("Homebrew.pkg");

    download_homebrew_pkg(&pkg_path)?;
    verify_homebrew_pkg(&pkg_path)?;

    // The package scripts otherwise hand the install to whoever owns
    // /dev/console. Point them at the account that actually asked, which the
    // socket told us and the caller could not forge.
    let user_plist = HomebrewPkgUser::pin(&account.name)?;

    let output = Command::new("/usr/sbin/installer")
        .args(["-pkg"])
        .arg(&pkg_path)
        .args(["-target", "/"])
        .env_clear()
        .env("PATH", ACTIVATION_PATH_ENV)
        .output()
        .context("failed to execute installer")?;

    drop(user_plist);
    drop(guard);

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok(HelperResponse {
        ok: output.status.success(),
        code: output.status.code().unwrap_or(-1),
        stdout,
        stderr,
        error: None,
    })
}

fn download_homebrew_pkg(pkg_path: &Path) -> Result<()> {
    let output = Command::new("/usr/bin/curl")
        .args([
            "-fL",
            "--proto",
            "=https",
            "--tlsv1.2",
            "--max-time",
            "1800",
        ])
        .arg("-o")
        .arg(pkg_path)
        .arg(HOMEBREW_PKG_URL)
        .env_clear()
        .env("PATH", ACTIVATION_PATH_ENV)
        .output()
        .context("failed to execute curl")?;
    if !output.status.success() {
        bail!(
            "failed to download the Homebrew installer: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    // An empty or truncated file would fail verification below anyway, but a
    // zero-byte download deserves its own message.
    let size = fs::metadata(pkg_path)
        .context("downloaded Homebrew installer is missing")?
        .len();
    if size == 0 {
        bail!("the downloaded Homebrew installer is empty");
    }
    Ok(())
}

/// Requires a Developer ID signature from Homebrew's team that Apple's notary
/// service trusts. Runs before `installer` ever sees the file.
fn verify_homebrew_pkg(pkg_path: &Path) -> Result<()> {
    let output = Command::new("/usr/sbin/pkgutil")
        .arg("--check-signature")
        .arg(pkg_path)
        .env_clear()
        .env("PATH", ACTIVATION_PATH_ENV)
        .output()
        .context("failed to execute pkgutil")?;
    if !output.status.success() {
        bail!(
            "the downloaded Homebrew installer is not signed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    check_signature_report(&String::from_utf8_lossy(&output.stdout))
}

/// Decides whether a `pkgutil --check-signature` report describes a package
/// this daemon is willing to run as root.
///
/// Split out from the command so the accept/reject rules are directly
/// testable: this is the only thing standing between a network download and
/// root-authenticated execution.
///
/// The team ID is matched on the *leaf* certificate line rather than anywhere
/// in the report, so a team ID appearing elsewhere — deeper in the chain, or
/// in some other field — cannot stand in for the real signer. Apple, not the
/// developer, sets the common name on a Developer ID certificate, so a signer
/// cannot mint one that merely reads like Homebrew's.
pub(crate) fn check_signature_report(report: &str) -> Result<()> {
    let leaf_signed_by_homebrew = report.lines().any(|line| {
        let line = line.trim();
        line.starts_with("1. Developer ID Installer:")
            && line.ends_with(&format!("({HOMEBREW_PKG_TEAM_ID})"))
    });
    if !leaf_signed_by_homebrew {
        bail!(
            "the downloaded Homebrew installer is not signed by Homebrew \
             (expected a Developer ID Installer certificate for team \
             {HOMEBREW_PKG_TEAM_ID})"
        );
    }
    if !report.contains("trusted by the Apple notary service") {
        bail!("the downloaded Homebrew installer is not notarized by Apple");
    }
    Ok(())
}

/// Removes a directory tree when dropped.
struct WorkDir(std::path::PathBuf);

impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Root-owned `0600` plist naming the account that should own the install.
///
/// An existing file is left completely alone: the same path is how MDM pins an
/// install user, and clobbering an administrator's choice would be worse than
/// falling back to the console user.
struct HomebrewPkgUser {
    created: bool,
}

impl HomebrewPkgUser {
    fn pin(user_name: &str) -> Result<Self> {
        let path = Path::new(HOMEBREW_PKG_USER_PLIST);
        if path.exists() {
            return Ok(Self { created: false });
        }
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>HOMEBREW_PKG_USER</key>
  <string>{}</string>
</dict>
</plist>
"#,
            escape_xml(user_name)
        );
        fs::write(path, plist).context("failed to write the Homebrew install-user plist")?;
        // The scripts ignore this file unless it is exactly root-owned 0600.
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .context("failed to lock down the Homebrew install-user plist")?;
        Ok(Self { created: true })
    }
}

impl Drop for HomebrewPkgUser {
    fn drop(&mut self) {
        if self.created {
            let _ = fs::remove_file(HOMEBREW_PKG_USER_PLIST);
        }
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

    /// Verbatim `pkgutil --check-signature` output for Homebrew 6.0.15,
    /// leading indentation included — the chain lines really are indented, and
    /// the check has to cope with that.
    const HOMEBREW_REPORT: &str = concat!(
        "Package \"Homebrew.pkg\":\n",
        "   Status: signed by a developer certificate issued by Apple for distribution\n",
        "   Notarization: trusted by the Apple notary service\n",
        "   Signed with a trusted timestamp on: 2026-08-03 07:51:53 +0000\n",
        "   Certificate Chain:\n",
        "    1. Developer ID Installer: Patrick Linnane (927JGANW46)\n",
        "       Expires: 2027-02-01 22:12:15 +0000\n",
        "    2. Developer ID Certification Authority\n",
        "    3. Apple Root CA\n",
    );

    #[test]
    fn signature_report_accepts_homebrews_notarized_package() {
        assert!(check_signature_report(HOMEBREW_REPORT).is_ok());
    }

    #[test]
    fn signature_report_rejects_another_developers_package() {
        // Valid Developer ID, wrong team: being signed by *someone* is not
        // enough when the result runs as root.
        let report = HOMEBREW_REPORT.replace("927JGANW46", "ABCDE12345");

        assert!(check_signature_report(&report).is_err());
    }

    #[test]
    fn signature_report_rejects_an_unnotarized_package() {
        let report =
            HOMEBREW_REPORT.replace("Notarization: trusted by the Apple notary service\n", "");

        assert!(check_signature_report(&report).is_err());
    }

    #[test]
    fn signature_report_rejects_an_unsigned_package() {
        assert!(
            check_signature_report("Package \"Homebrew.pkg\":\n   Status: no signature\n").is_err()
        );
    }

    // The team ID counts only on the leaf certificate. A report that mentions
    // it anywhere else describes a package signed by somebody else.
    #[test]
    fn signature_report_rejects_the_team_id_away_from_the_leaf_certificate() {
        let report = HOMEBREW_REPORT
            .replace("(927JGANW46)", "(ABCDE12345)")
            .replace(
                "Certificate Chain:",
                "Certificate Chain: (see also 927JGANW46)",
            );

        assert!(check_signature_report(&report).is_err());
    }

    // ...including when it is the intermediate rather than the signer.
    #[test]
    fn signature_report_rejects_a_matching_team_id_on_a_deeper_certificate() {
        let report = HOMEBREW_REPORT
            .replace(
                "    1. Developer ID Installer: Patrick Linnane (927JGANW46)\n",
                "    1. Developer ID Installer: Someone Else (ABCDE12345)\n",
            )
            .replace(
                "    2. Developer ID Certification Authority\n",
                "    2. Developer ID Certification Authority (927JGANW46)\n",
            );

        assert!(check_signature_report(&report).is_err());
    }
}
