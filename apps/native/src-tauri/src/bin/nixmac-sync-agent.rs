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

fn main() {
    if let Err(error) = run_once() {
        eprintln!("nixmac-sync-agent failed: {error:#}");
        std::process::exit(1);
    }
}

fn run_once() -> anyhow::Result<()> {
    let Some(config_dir) = non_empty_env("NIXMAC_SYNC_CONFIG_DIR") else {
        verify_helper_ready();
        println!("nixmac-sync-agent: no NIXMAC_SYNC_CONFIG_DIR configured; readiness probe only");
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
    // No canonical-link maintenance here: this agent re-applies the same
    // config dir it was registered with, so the /etc/nix-darwin link set by
    // the interactive apply that registered it is still correct.
    let request =
        privileged_helper::protocol::current_user_activation_request(&activate_path, None)?;
    let response = privileged_helper::client::activate_store_path(request)?;
    if !response.ok {
        // Leave the out-link in place: it keeps the built closure GC-rooted
        // for the next attempt, and that attempt's --out-link replaces it.
        return Err(anyhow::anyhow!(
            "activation failed ({}): {}",
            response.code,
            response.error.unwrap_or(response.stderr)
        ));
    }

    // Activation set the durable system-profile GC root, so the out-link is
    // no longer needed. Also clear the `result` link older nixmac versions
    // left in the config dir.
    out_link::cleanup_out_link(&link);
    out_link::remove_legacy_result_link(&config_dir);

    println!("nixmac-sync-agent: build and activation completed");
    Ok(())
}

fn verify_helper_ready() {
    match privileged_helper::client::status() {
        Ok(response) if response.ok => {
            println!("nixmac-sync-agent: helper ready");
        }
        Ok(response) => {
            eprintln!(
                "nixmac-sync-agent: helper unhealthy: {}",
                response.error.unwrap_or(response.stderr)
            );
            std::process::exit(2);
        }
        Err(error) => {
            eprintln!("nixmac-sync-agent: helper unavailable: {error:#}");
            std::process::exit(1);
        }
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
