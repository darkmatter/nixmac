//! Root re-entry point for the interactive activation fallback.
//!
//! When the privileged helper is unavailable, the app elevates through one
//! native admin prompt (`osascript ... with administrator privileges`). The
//! privileged step used to be a generated shell script that wrote a temporary
//! NOPASSWD rule to `/etc/sudoers.d/nixmac-activate-temp` and cleaned it up
//! with an EXIT trap. That mechanism is gone: the unprivileged app now
//! re-executes its own binary with [`ROOT_ACTIVATE_ARG`], and this mode
//! applies the same hardening rules as the helper daemon — direct exec with
//! absolute programs, a fixed root-owned PATH and otherwise empty environment
//! (`env -i`), and account values derived from the target uid (no sudoers,
//! no shell logic as root).

use crate::privileged_helper::helper_runtime;
use crate::privileged_helper::protocol::validate_canonical_activate_path;
use anyhow::{Context, Result, bail};

/// First argv element that switches the app binary into root-activation mode.
/// Deliberately not a user-facing CLI subcommand: it exists only for the
/// osascript elevation and is dispatched before any other argument parsing.
pub const ROOT_ACTIVATE_ARG: &str = "__nixmac-root-activate";

/// Sudoers rule older app versions wrote for the osascript fallback (and
/// could leave behind if the elevated shell died before its EXIT trap ran).
/// No longer written; removed on every root activation if present.
const LEGACY_SUDOERS_PATH: &str = "/etc/sudoers.d/nixmac-activate-temp";

/// Prefix on post-activation maintenance warnings, so they read as warnings
/// (not activation output) in the streamed apply log.
const WARNING_PREFIX: &str = "nixmac: warning:";

/// Validated inputs of a root activation. Built by the unprivileged side
/// (which knows its own uid and environment) and re-validated after the
/// privilege boundary by [`parse_args`].
#[derive(Debug)]
pub struct RootActivationArgs {
    pub uid: u32,
    pub activate_path: String,
    pub ssh_auth_sock: Option<String>,
}

/// The exact command line handed to `osascript ... with administrator
/// privileges`: this binary re-executed in root-activation mode. Every
/// element is an absolute path, a fixed literal, or a single-quoted value,
/// and the leading `exec` makes the elevated shell replace itself with this
/// argv instead of staying alive as its parent.
pub fn shell_command(exe: &str, args: &RootActivationArgs) -> String {
    let mut argv = vec![
        exe.to_string(),
        ROOT_ACTIVATE_ARG.to_string(),
        "--uid".to_string(),
        args.uid.to_string(),
        "--activate".to_string(),
        args.activate_path.clone(),
    ];
    if let Some(sock) = args
        .ssh_auth_sock
        .as_deref()
        .filter(|sock| !sock.is_empty())
    {
        argv.push("--ssh-auth-sock".to_string());
        argv.push(sock.to_string());
    }
    let quoted = argv
        .iter()
        .map(|arg| shell_quote(arg))
        .collect::<Vec<_>>()
        .join(" ");
    format!("exec {quoted}")
}

/// Single-quotes `value` for /bin/sh: the only character that needs escaping
/// inside single quotes is the single quote itself.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Parses and validates the argv after [`ROOT_ACTIVATE_ARG`]. Validation
/// runs on the privileged side of the boundary: the activate path must be a
/// canonical /nix/store activation script, exactly as the helper daemon
/// requires.
pub fn parse_args(args: impl IntoIterator<Item = String>) -> Result<RootActivationArgs> {
    let mut uid = None;
    let mut activate_path = None;
    let mut ssh_auth_sock = None;

    let mut args = args.into_iter();
    while let Some(flag) = args.next() {
        let value = args
            .next()
            .with_context(|| format!("missing value for {flag}"))?;
        match flag.as_str() {
            "--uid" => {
                uid = Some(value.parse::<u32>().context("--uid must be an integer")?);
            }
            "--activate" => activate_path = Some(value),
            "--ssh-auth-sock" => ssh_auth_sock = Some(value),
            other => bail!("unknown root-activation argument: {other}"),
        }
    }

    let uid = uid.context("--uid is required")?;
    if uid == 0 {
        bail!("root activation must target a non-root user");
    }
    let activate_path = activate_path.context("--activate is required")?;
    validate_canonical_activate_path(&activate_path)?;

    Ok(RootActivationArgs {
        uid,
        activate_path,
        ssh_auth_sock,
    })
}

/// Entry point for the root-activation dispatch in `main()`. Returns the
/// process exit code: the activation's own code, or 1 when the mode itself
/// fails before activation runs.
pub fn run(args: impl IntoIterator<Item = String>) -> i32 {
    match run_root_activation(args) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("nixmac root activation failed: {error:#}");
            1
        }
    }
}

fn run_root_activation(args: impl IntoIterator<Item = String>) -> Result<i32> {
    let args = parse_args(args)?;
    if !nix::unistd::Uid::effective().is_root() {
        bail!(
            "root-activation mode must run as root (it is only ever invoked via the admin prompt)"
        );
    }
    let legacy_sudoers_warning = remove_legacy_sudoers();
    // stderr is what `do shell script` surfaces on any failure — a nonzero
    // activation or any early `?` return below — so emit the warning there
    // eagerly; no failure path can lose it. A successful run discards stderr
    // and returns stdout, so the success branch repeats it there.
    if let Some(warning) = &legacy_sudoers_warning {
        eprintln!("{WARNING_PREFIX} {warning}");
    }

    // Mirror the helper daemon: account values come from the uid lookup, and
    // the activation is a direct exec of absolute programs with a fixed
    // environment — the caller's environment never reaches root.
    let account = helper_runtime::user_account(args.uid)?;
    let argv = helper_runtime::activation_argv(
        args.uid,
        &account,
        &args.activate_path,
        args.ssh_auth_sock.as_deref(),
    );
    let (status, output) = helper_runtime::run_activation_command(&argv)?;

    if status.success() {
        // `do shell script` returns the elevated command's stdout as its
        // result, which the app surfaces in the apply stream. stderr is
        // discarded on success, so warnings must ride stdout.
        print!("{output}");
        // Warnings must start their own line even when the activation's
        // last output line has no trailing newline.
        if !output.is_empty() && !output.ends_with('\n') {
            println!();
        }
        if let Some(warning) = &legacy_sudoers_warning {
            println!("{WARNING_PREFIX} {warning}");
        }
        // Best-effort, same as the helper: the system switch already
        // happened, so maintenance failures are warnings, not errors.
        for warning in helper_runtime::post_activation_maintenance(&args.activate_path) {
            println!("{WARNING_PREFIX} {warning}");
        }
    } else {
        // A failed `do shell script` discards stdout and surfaces stderr
        // through the AppleScript error, so route diagnostics there.
        eprint!("{output}");
    }
    Ok(status.code().unwrap_or(-1))
}

/// Removes the legacy fallback sudoers rule, best-effort. Returns a warning
/// when a stale NOPASSWD grant could not be removed: it must never go
/// unnoticed, but must not block the activation either (blocking would not
/// remove it any better). The caller routes it through whichever stream
/// `do shell script` actually surfaces for the run's outcome.
fn remove_legacy_sudoers() -> Option<String> {
    match std::fs::remove_file(LEGACY_SUDOERS_PATH) {
        Ok(()) => None,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => Some(format!(
            "SECURITY: failed to remove legacy sudoers rule {LEGACY_SUDOERS_PATH}: {error}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACTIVATE: &str = "/nix/store/abc123-darwin-system-25.05.20260629/activate";

    fn args(flags: &[&str]) -> Result<RootActivationArgs> {
        parse_args(flags.iter().map(|flag| flag.to_string()))
    }

    #[test]
    fn parse_accepts_full_argument_set() {
        let parsed = args(&[
            "--uid",
            "501",
            "--activate",
            ACTIVATE,
            "--ssh-auth-sock",
            "/tmp/ssh.sock",
        ])
        .expect("valid args");

        assert_eq!(parsed.uid, 501);
        assert_eq!(parsed.activate_path, ACTIVATE);
        assert_eq!(parsed.ssh_auth_sock.as_deref(), Some("/tmp/ssh.sock"));
    }

    #[test]
    fn parse_rejects_root_uid() {
        let error = args(&["--uid", "0", "--activate", ACTIVATE]).expect_err("uid 0 must fail");

        assert!(error.to_string().contains("non-root user"));
    }

    #[test]
    fn parse_rejects_missing_uid_and_missing_activate() {
        assert!(args(&["--activate", ACTIVATE]).is_err());
        assert!(args(&["--uid", "501"]).is_err());
    }

    #[test]
    fn parse_rejects_non_store_activate_path() {
        assert!(args(&["--uid", "501", "--activate", "/tmp/activate"]).is_err());
    }

    #[test]
    fn parse_rejects_unknown_arguments() {
        let error = args(&["--uid", "501", "--activate", ACTIVATE, "--shell", "/bin/sh"])
            .expect_err("unknown flag must fail");

        assert!(error.to_string().contains("unknown root-activation"));
    }

    fn full_args() -> RootActivationArgs {
        RootActivationArgs {
            uid: 501,
            activate_path: ACTIVATE.to_string(),
            ssh_auth_sock: Some("/tmp/ssh.sock".to_string()),
        }
    }

    #[test]
    fn shell_command_re_execs_the_app_binary_with_quoted_arguments() {
        let command = shell_command(
            "/Applications/nix mac.app/Contents/MacOS/nixmac",
            &full_args(),
        );

        assert!(command.starts_with("exec '/Applications/nix mac.app/Contents/MacOS/nixmac'"));
        assert!(command.contains(&format!("'{ROOT_ACTIVATE_ARG}'")));
        assert!(command.contains("'--uid' '501'"));
        assert!(command.contains(&format!("'--activate' '{ACTIVATE}'")));
    }

    #[test]
    fn shell_command_never_builds_sudoers_traps_or_redirections() {
        let command = shell_command(
            "/Applications/nixmac.app/Contents/MacOS/nixmac",
            &full_args(),
        );

        for forbidden in ["sudo", "sudoers", "trap", "rm ", "visudo", ">", "$", ";"] {
            assert!(
                !command.contains(forbidden),
                "shell command must not contain {forbidden:?}: {command}"
            );
        }
    }

    #[test]
    fn shell_command_omits_empty_ssh_sock() {
        let mut args = full_args();
        args.ssh_auth_sock = Some(String::new());

        let command = shell_command("/Applications/nixmac.app/Contents/MacOS/nixmac", &args);

        assert!(!command.contains("--ssh-auth-sock"));
    }

    #[test]
    fn shell_quote_escapes_single_quotes() {
        assert_eq!(shell_quote("/Users/al'ice"), "'/Users/al'\\''ice'");
    }
}
