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

    run_command_in_dir(
        "darwin-rebuild",
        &[
            "build",
            "--flake",
            &format!(".#{host_attr}"),
            "--show-trace",
            "--verbose",
        ],
        Some(&config_dir),
    )?;

    if !env_flag_enabled("NIXMAC_UNATTENDED_APPLY") {
        println!("nixmac-sync-agent: build completed; unattended activation disabled");
        return Ok(());
    }

    let activate_path = std::path::Path::new(&config_dir).join("result/activate");
    // No canonical-link maintenance here: this agent re-applies the same
    // config dir it was registered with, so the /etc/nix-darwin link set by
    // the interactive apply that registered it is still correct.
    let request =
        privileged_helper::protocol::current_user_activation_request(&activate_path, None)?;
    let response = privileged_helper::client::activate_store_path(request)?;
    if !response.ok {
        return Err(anyhow::anyhow!(
            "activation failed ({}): {}",
            response.code,
            response.error.unwrap_or(response.stderr)
        ));
    }

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
