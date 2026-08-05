mod env_keys {
    #![allow(dead_code)]
    include!("src/env_keys.rs");
}

mod build_id {
    #![allow(dead_code)]
    include!("src/build_id.rs");
}

use std::path::Path;
use std::process::Command;

/// Embed `apps/native/env.{development,release,e2e}.json` selected by `NIXMAC_ENV`.
fn embed_build_profile() {
    let native_app_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let profile = std::env::var("NIXMAC_ENV").unwrap_or_else(|_| "development".to_string());
    let file = match profile.as_str() {
        "prod" | "production" => "env.release.json",
        "e2e" => "env.e2e.json",
        _ => "env.development.json",
    };
    let path = native_app_dir.join(file);

    println!("cargo:rerun-if-env-changed=NIXMAC_ENV");
    for name in ["env.development.json", "env.release.json", "env.e2e.json"] {
        println!(
            "cargo:rerun-if-changed={}",
            native_app_dir.join(name).display()
        );
    }

    let json = std::fs::read_to_string(&path).unwrap_or_else(|_| "{}".to_string());
    let minified = serde_json::from_str::<serde_json::Value>(&json)
        .ok()
        .and_then(|value| serde_json::to_string(&value).ok())
        .unwrap_or_else(|| "{}".to_string());
    println!("cargo:rustc-env=NIXMAC_ENV_PROFILE_JSON={minified}");
}

/// Embed the Apple signing team for the privileged-helper peer handshake
/// (`privileged_helper/peer_auth.rs` reads `option_env!("NIXMAC_TEAM_ID")`).
///
/// The checked-in `signing-team-id` file is the single source of truth for
/// the team's Developer ID; the release sign scripts read the same file, and
/// `sign-app.sh` refuses a certificate from any other team. An explicit
/// `NIXMAC_TEAM_ID` env var wins so personal-certificate builds can pin
/// their own team. The value is not a secret: every distributed signed
/// binary carries it.
fn embed_signing_team_id() {
    println!("cargo:rerun-if-env-changed=NIXMAC_TEAM_ID");
    let file = Path::new(env!("CARGO_MANIFEST_DIR")).join("signing-team-id");
    println!("cargo:rerun-if-changed={}", file.display());

    // An empty env var falls back to the file, matching the sign scripts'
    // `${NIXMAC_TEAM_ID:-...}`.
    let team_id = std::env::var("NIXMAC_TEAM_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::fs::read_to_string(&file).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    // When absent, leave NIXMAC_TEAM_ID unset: peer validation fails closed
    // and activation falls back to the interactive administrator prompt.
    if let Some(team_id) = team_id {
        println!("cargo:rustc-env=NIXMAC_TEAM_ID={team_id}");
    }
}

/// Embed the build identity (`NIXMAC_BUILD_ID`, supplied by CI from the
/// packaged source revision) into every target of this crate — the GUI, the
/// helper, and the sync agent. Packaged builds (`NIXMAC_ENV` =
/// prod/production) hard-fail on a missing or empty value; development builds
/// fall back to a fixed literal. Git is deliberately never run here: the value
/// must describe the packaged source, which only the build orchestrator knows.
fn embed_build_id() {
    println!("cargo:rerun-if-env-changed=NIXMAC_BUILD_ID");
    println!("cargo:rerun-if-env-changed=NIXMAC_ENV");

    let packaged = matches!(
        std::env::var("NIXMAC_ENV").as_deref(),
        Ok("prod") | Ok("production")
    );
    let raw = std::env::var("NIXMAC_BUILD_ID").ok();
    match build_id::resolve_build_id(raw.as_deref(), packaged) {
        Ok(build_id) => println!("cargo:rustc-env=NIXMAC_BUILD_ID={build_id}"),
        Err(error) => panic!("{error}"),
    }
}

fn add_debug_swift_runtime_rpaths() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos")
        || std::env::var("PROFILE").as_deref() != Ok("debug")
    {
        return;
    }

    println!("cargo:rerun-if-env-changed=DEVELOPER_DIR");

    let Ok(output) = Command::new("xcrun")
        .args(["swift", "-print-target-info"])
        .output()
    else {
        return;
    };

    if !output.status.success() {
        return;
    }

    let Ok(target_info) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return;
    };

    let Some(paths) = target_info
        .pointer("/paths/runtimeLibraryPaths")
        .and_then(|value| value.as_array())
    else {
        return;
    };

    for path in paths.iter().filter_map(|value| value.as_str()) {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{path}");
    }
}

fn main() {
    embed_build_profile();
    embed_signing_team_id();
    embed_build_id();
    add_debug_swift_runtime_rpaths();

    // Set up passthrough for relevant environment variables.
    // This allows configuration to be injected at build time (e.g. by CI)
    // or in development environments. Keys are defined in src/env_keys.rs.
    for key in env_keys::BUILD_EMBED_KEYS {
        println!("cargo:rerun-if-env-changed={key}");

        if let Ok(value) = std::env::var(key) {
            println!("cargo:rustc-env={key}={value}");
        }
    }

    // Determine the version to embed. Prefer an explicit `NIXMAC_VERSION`
    // from the build environment (e.g. set by CI). If not present, fall
    // back to the Cargo package version, and finally to "unknown".
    let nixmac_version = std::env::var("NIXMAC_VERSION")
        .or_else(|_| std::env::var("CARGO_PKG_VERSION"))
        .unwrap_or_else(|_| "unknown".to_string());
    println!("cargo:rustc-env=NIXMAC_VERSION={nixmac_version}");

    // Continue with the normal Tauri build
    tauri_build::build()
}
