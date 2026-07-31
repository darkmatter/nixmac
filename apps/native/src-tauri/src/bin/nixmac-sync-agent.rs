#![allow(dead_code)]

mod system {
    pub mod nix {
        pub fn get_nix_path() -> String {
            std::env::var("PATH").unwrap_or_else(|_| {
                "/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string()
            })
        }
    }
}

mod privileged_helper {
    pub mod protocol {
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/privileged_helper/protocol.rs"
        ));
    }

    pub mod peer_auth {
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/privileged_helper/peer_auth.rs"
        ));
    }

    pub mod client {
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/privileged_helper/client.rs"
        ));
    }
}

mod out_link {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/rebuild/out_link.rs"
    ));
}

use privileged_helper::client::{HelperClientError, HelperExchange};
use privileged_helper::protocol::{ActivationResult, HelperReply};

fn main() {
    if let Err(error) = run_once() {
        eprintln!("nixmac-sync-agent failed: {error:#}");
        std::process::exit(1);
    }
}

/// What one `TryActivate` dispatch means for this run. The agent is an
/// ordinary exact-build protocol client with no lifecycle role: a delivered
/// result ends the run normally, and every obstacle defers activation to the
/// next scheduled run — never a retry, never `Retire`, never the password
/// path, and never a nonzero exit (the agent plist sets
/// `KeepAlive.SuccessfulExit = false`, so a nonzero exit would trip the
/// launchd restart loop instead of waiting for the next interval).
enum DispatchOutcome {
    /// Delivered success: activation set the durable system-profile GC
    /// root, so the out-link can be cleaned up.
    Activated(ActivationResult),
    /// Delivered failure: reported, out-link kept (it GC-roots the built
    /// closure for the next attempt), clean exit.
    ActivationFailed(ActivationResult),
    /// Any obstacle — `Busy`, `Retired`, a typed refusal, a helper that
    /// fails authentication, an unreachable helper, an unparseable reply, a
    /// lost connection: out-link kept, run reported as activation-deferred,
    /// clean exit. The next scheduled run is a fresh request.
    Deferred(String),
}

impl DispatchOutcome {
    /// Whether this run may release the out-link. Only a delivered success
    /// may: activation has set the durable system-profile GC root by then.
    /// Every other outcome keeps it, because it GC-roots the built closure
    /// for the next scheduled run's attempt.
    fn releases_out_link(&self) -> bool {
        matches!(self, DispatchOutcome::Activated(_))
    }
}

fn classify_dispatch(outcome: Result<HelperExchange, HelperClientError>) -> DispatchOutcome {
    match outcome {
        Ok(exchange) => match exchange.reply {
            HelperReply::ActivationResult(result) if result.ok => {
                DispatchOutcome::Activated(result)
            }
            HelperReply::ActivationResult(result) => DispatchOutcome::ActivationFailed(result),
            reply => DispatchOutcome::Deferred(reply.summary()),
        },
        Err(error) => DispatchOutcome::Deferred(error.to_string()),
    }
}

fn run_once() -> anyhow::Result<()> {
    let Some(config_dir) = non_empty_env("NIXMAC_SYNC_CONFIG_DIR") else {
        report_helper_socket();
        println!("nixmac-sync-agent: no NIXMAC_SYNC_CONFIG_DIR configured; nothing to do");
        return Ok(());
    };
    let host_attr = std::env::var("NIXMAC_SYNC_HOST_ATTR")
        .map_err(|_| anyhow::anyhow!("NIXMAC_SYNC_HOST_ATTR is required"))?;

    if env_flag_enabled("NIXMAC_SYNC_PULL") {
        run_command("git", &["-C", &config_dir, "pull", "--ff-only"])?;
    }

    // Build via nix directly (what darwin-rebuild build runs underneath), with
    // the out-link in app-support so the config dir never grows a `result`
    // symlink. NIX_CONFIG is required here: darwin-rebuild used to enable the
    // experimental features itself, and a launchd context has no user nix.conf
    // guarantees.
    let link = out_link::prepare_out_link(out_link::SYNC_OUT_LINK_NAME)?;
    let safe_host_attr = serde_json::to_string(&host_attr)?;
    run_command_in_dir(
        "nix",
        &[
            "build",
            &format!(".#darwinConfigurations.{safe_host_attr}.system"),
            "--out-link",
            &link.to_string_lossy(),
            "--show-trace",
            "--verbose",
        ],
        Some(&config_dir),
    )?;
    let store_path = out_link::resolve_out_link(&link)?;

    if !env_flag_enabled("NIXMAC_UNATTENDED_APPLY") {
        // Build-only mode keeps nothing pinned: the goal is warming the store,
        // not rooting a closure that may never be activated.
        out_link::cleanup_out_link(&link);
        println!("nixmac-sync-agent: build completed; unattended activation disabled");
        return Ok(());
    }

    let activate_path = store_path.join("activate");
    let request = privileged_helper::protocol::activation_request(&activate_path)?;
    let outcome = classify_dispatch(privileged_helper::client::activate_store_path(&request));

    // One place decides the out-link's fate, so no reporting branch can
    // release it by accident.
    if outcome.releases_out_link() {
        // Activation set the durable system-profile GC root, so the out-link
        // is no longer needed. Also clear the `result` link older nixmac
        // versions left in the config dir.
        out_link::cleanup_out_link(&link);
        out_link::remove_legacy_result_link(&config_dir);
    }

    match outcome {
        DispatchOutcome::Activated(result) => {
            for warning in result.warnings() {
                eprintln!("nixmac-sync-agent: {warning}");
            }
            println!("nixmac-sync-agent: build and activation completed");
        }
        DispatchOutcome::ActivationFailed(result) => {
            eprintln!(
                "nixmac-sync-agent: activation failed ({}): {}",
                result.code,
                result.failure_detail()
            );
            println!("nixmac-sync-agent: build completed; activation failed");
        }
        DispatchOutcome::Deferred(reason) => {
            eprintln!(
                "nixmac-sync-agent: activation deferred until the next scheduled run: {reason}"
            );
            println!("nixmac-sync-agent: build completed; activation deferred");
        }
    }
    // Every dispatch outcome ends the run normally: the agent plist sets
    // `KeepAlive.SuccessfulExit = false`, so a nonzero exit here would trip
    // the launchd restart loop instead of waiting for the next interval.
    Ok(())
}

/// Diagnostic-only note for the mode with no sync config set. The agent may
/// only send `TryActivate` — asking the helper what it is belongs to the GUI —
/// so this reports the socket's presence and nothing more. It gates nothing,
/// and it never fails the run: a nonzero exit here would trip the launchd
/// restart loop.
fn report_helper_socket() {
    if privileged_helper::client::socket_available() {
        println!("nixmac-sync-agent: privileged helper socket present");
    } else {
        eprintln!("nixmac-sync-agent: privileged helper socket absent");
    }
}

fn non_empty_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name).as_deref() == Ok("1")
}

fn run_command(program: &str, args: &[&str]) -> anyhow::Result<()> {
    run_command_in_dir(program, args, None)
}

fn run_command_in_dir(
    program: &str,
    args: &[&str],
    current_dir: Option<&str>,
) -> anyhow::Result<()> {
    let mut command = std::process::Command::new(program);
    command.args(args).env("PATH", system::nix::get_nix_path());
    command.env("NIX_CONFIG", "experimental-features = nix-command flakes");
    if let Some(current_dir) = current_dir {
        command.current_dir(current_dir);
    }
    let status = command.status()?;
    if !status.success() {
        return Err(anyhow::anyhow!(
            "{program} failed with exit code {}",
            status.code().unwrap_or(-1)
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use privileged_helper::protocol::{ActivationInfo, HelperStateName};

    fn exchange(reply: HelperReply) -> Result<HelperExchange, HelperClientError> {
        let (connection, _other_end) = std::os::unix::net::UnixStream::pair().expect("socketpair");
        Ok(HelperExchange { reply, connection })
    }

    fn activation_info() -> ActivationInfo {
        ActivationInfo {
            request_id: "req-1".to_string(),
            script_path: "/nix/store/abc-darwin-system/activate".to_string(),
            client_kind: privileged_helper::peer_auth::ClientKind::Gui,
        }
    }

    #[test]
    fn delivered_success_is_the_only_outcome_that_releases_the_out_link() {
        let outcome =
            classify_dispatch(exchange(HelperReply::ActivationResult(ActivationResult {
                ok: true,
                code: 0,
                stdout: "activated".to_string(),
                error: None,
            })));

        assert!(matches!(outcome, DispatchOutcome::Activated(_)));
        assert!(outcome.releases_out_link());
    }

    #[test]
    fn delivered_failure_is_reported_with_the_out_link_kept() {
        // A delivered failure ends the run normally — reported, out-link
        // kept, no restart-loop exit (run_once returns Ok on this path).
        let outcome =
            classify_dispatch(exchange(HelperReply::ActivationResult(ActivationResult {
                ok: false,
                code: 2,
                stdout: "activation exploded".to_string(),
                error: None,
            })));

        assert!(matches!(outcome, DispatchOutcome::ActivationFailed(_)));
        assert!(!outcome.releases_out_link());
    }

    #[test]
    fn every_obstacle_defers_and_keeps_the_out_link() {
        // Busy, Retired, each typed refusal, an unreachable helper, a failed
        // helper authentication, a closed connection, an ambiguous I/O
        // failure, and an unparseable reply: all defer to the next scheduled
        // run. run_once returns Ok on the deferred path, so each of these is
        // also a clean (zero) exit — never a launchd restart loop.
        let obstacles: Vec<Result<HelperExchange, HelperClientError>> = vec![
            exchange(HelperReply::Busy {
                activation: activation_info(),
            }),
            exchange(HelperReply::Retired {
                activation: Some(activation_info()),
            }),
            exchange(HelperReply::Retired { activation: None }),
            exchange(HelperReply::BuildMismatch {
                helper_build_id: "build-b".to_string(),
            }),
            exchange(HelperReply::CallerNotPermitted),
            exchange(HelperReply::RequestNotUnderstood),
            // A Status reply to TryActivate would be nonsense — still defer.
            exchange(HelperReply::Status {
                state: HelperStateName::Idle,
                helper_build_id: "build-b".to_string(),
                activation: None,
            }),
            Err(HelperClientError::Unreachable(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "no socket",
            ))),
            Err(HelperClientError::AuthenticationFailed(anyhow::anyhow!(
                "not the signed helper"
            ))),
            Err(HelperClientError::ClosedBeforeReply),
            Err(HelperClientError::Io(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "read timed out",
            ))),
            Err(HelperClientError::UnparseableReply(
                "unknown reply tag".to_string(),
            )),
        ];

        for obstacle in obstacles {
            let outcome = classify_dispatch(obstacle);
            assert!(
                matches!(outcome, DispatchOutcome::Deferred(_)),
                "expected a deferral"
            );
            assert!(!outcome.releases_out_link());
        }
    }
}
