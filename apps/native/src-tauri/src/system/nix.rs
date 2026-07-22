//! Nix command execution and PATH resolution for macOS GUI apps.
//!
//! This module provides two approaches for resolving PATH when executing Nix commands:
//!
//! ## 1. Regular PATH (`get_nix_path()`)
//! - Uses process environment + fallback Nix paths
//! - **Fast:** No shell spawning
//! - **Use for:** Frequent operations (git polling, nix eval)
//! - **Trade-off:** May not find Nix if app launched from Finder without shell environment
//!
//! ## 2. Login Shell PATH (`get_nix_path_with_login_shell()`)
//! - Spawns `/bin/bash -l` to source shell init files
//! - **Reliable:** Finds Nix even in GUI contexts
//! - **Use for:** One-time checks (is_nix_installed, initial detection)
//! - **Warning:** Triggers shell init which may invoke `xcrun` from Nix's `xcbuild`,
//!   causing repeated `warning: unhandled Platform key FamilyDisplayName` in logs
//!
//! ## Why Two Approaches?
//!
//! The git watcher polls status every 2.5 seconds, executing multiple git commands per poll.
//! If each command spawned a login shell, we'd get hundreds of xcrun warnings per minute.
//! By using the simple PATH for frequent operations and login shell only for initial detection,
//! we get reliability where needed without polluting logs.
//!
//! See: <https://github.com/NixOS/nixpkgs/issues/376958>

use anyhow::{Context, Result};
use log::{error, info};
use serde::Deserialize;

use std::collections::BTreeMap;
use std::io::{Read as _, Write as _};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

use crate::shared_types::LaunchdItemType;
use crate::utils::normalize_path_input;

const NIX_PATHS_FALLBACK: &[&str] = &[
    "/run/current-system/sw/bin",
    "/nix/var/nix/profiles/default/bin",
    "/etc/profiles/per-user/root/bin",
    "/usr/local/bin",
    "/opt/homebrew/bin",
];

#[derive(Debug)]
#[allow(dead_code)]
pub struct NixLaunchdItem {
    pub label: String,
    pub program_arguments: Vec<String>,
    pub item_type: LaunchdItemType,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NixLaunchdEvalItem {
    label: String,
    #[serde(default)]
    program_arguments: Vec<String>,
}

/// A single enabled `environment.etc.<name>` entry, reduced to the fields the
/// `/etc` clobber preflight needs. `target` is the path relative to `/etc`;
/// `known_sha256_hashes` is nix-darwin's allow-list of safe-to-overwrite hashes
/// (empty for most generated files and secrets).
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NixEnvironmentEtcEntry {
    pub target: String,
    #[serde(default)]
    pub known_sha256_hashes: Vec<String>,
}

/// A single enabled Home Manager `xdg.configFile.<name>` entry, reduced to the
/// fields needed for preflight collision warnings.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NixHomeManagerXdgConfigFileEntry {
    pub user: String,
    pub target: String,
    pub xdg_config_home: String,
    pub source: Option<String>,
    pub force: bool,
    pub backup_file_extension: Option<String>,
}

/// A Home Manager user with `targets.darwin.copyApps` enabled and permission
/// checks turned on.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NixHomeManagerCopyAppsEntry {
    pub user: String,
    pub home_directory: String,
    pub directory: String,
}

/// Raw `nix eval` shape including `enable`, which we filter on before exposing
/// the trimmed [`NixEnvironmentEtcEntry`] (nix-darwin skips disabled entries).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NixEnvironmentEtcEvalEntry {
    target: String,
    enable: bool,
    #[serde(default)]
    known_sha256_hashes: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NixHomeManagerXdgConfigFileEvalEntry {
    user: String,
    target: String,
    xdg_config_home: String,
    source: Option<String>,
    enable: bool,
    force: bool,
    backup_file_extension: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NixHomeManagerCopyAppsEvalEntry {
    user: String,
    home_directory: String,
    directory: String,
    enable: bool,
    enable_checks: bool,
}

static NIX_PATH_CACHE: OnceLock<String> = OnceLock::new();

/// Gets a command with our typical setup to execute `nix`.
pub fn nix_command(config_dir: &str) -> Command {
    let mut cmd = Command::new("nix");
    let normalized_config_dir =
        normalize_path_input(config_dir).unwrap_or_else(|_| config_dir.into());
    cmd.env("PATH", get_nix_path())
        .env("NIX_CONFIG", "experimental-features = nix-command flakes")
        .current_dir(normalized_config_dir);
    cmd
}

fn nix_eval_value_to_string(value: serde_json::Value) -> String {
    match value {
        serde_json::Value::String(value) => value,
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => value.to_string(),
        value => value.to_string(),
    }
}

/// Check to see if a rebuild is needed for the given host and config dir.
/// This can happen when (for example) the user pulled git changes from the upstream.
pub fn is_rebuild_needed(hostname: &str, config_dir: &str) -> Result<bool> {
    /* General approach:
        expected=$(nix eval --raw ".#darwinConfigurations.${host}.system")
        active=$(readlink /run/current-system)
    */
    let host_attr = serde_json::to_string(hostname)?;
    let flake_attr = format!(".#darwinConfigurations.{}.system", host_attr);

    let expected_output = nix_command(config_dir)
        .args(["eval", "--raw", &flake_attr])
        .output()?;

    if !expected_output.status.success() {
        anyhow::bail!(
            "Failed to evaluate expected system for host {}: {}",
            hostname,
            String::from_utf8_lossy(&expected_output.stderr)
        );
    }

    let expected_system = String::from_utf8(expected_output.stdout)?
        .trim()
        .to_string();

    let actual_system_output = Command::new("readlink")
        .arg("/run/current-system")
        .output()?;
    if !actual_system_output.status.success() {
        anyhow::bail!(
            "Failed to read current system symlink: {}",
            String::from_utf8_lossy(&actual_system_output.stderr)
        );
    }
    let actual_system = String::from_utf8(actual_system_output.stdout)?
        .trim()
        .to_string();
    Ok(expected_system != actual_system)
}

/// Gets the `system.primaryUser` for the given host by running `nix eval` if it's
/// defined. This is required for (for example) setting system.defaults.
pub fn get_system_primary_user(hostname: &str, config_dir: &str) -> Option<String> {
    let host_attr = serde_json::to_string(hostname).ok()?;
    let flake_attr = format!(
        ".#darwinConfigurations.{}.config.system.primaryUser",
        host_attr
    );

    let output = nix_command(config_dir)
        .args(["eval", "--json", &flake_attr])
        .output()
        .ok()?;

    if !output.status.success() {
        log::debug!(
            "Failed to evaluate system.primaryUser for host {}: {}",
            hostname,
            String::from_utf8_lossy(&output.stderr)
        );
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    let primary_user: Option<String> = serde_json::from_str(&stdout).ok()?;
    primary_user
}

/// Gets the current system.defaults values for a given host by running `nix eval`.
/// NOTE that this only returns key entries for non-null values since `nix eval` always
/// lists all available keys regardless of whether they are "set" in a flake or not.
pub fn get_nix_system_defaults_for_domain(
    hostname: &str,
    config_dir: &str,
    domain: &str,
) -> Result<BTreeMap<String, String>> {
    // nix eval ~{config_dir}/#darwinConfigurations.<hostname>.config.system.defaults --json
    let host_attr = serde_json::to_string(hostname)?;
    let flake_attr = format!(
        ".#darwinConfigurations.{}.config.system.defaults.{}",
        host_attr, domain
    );

    let output = nix_command(config_dir)
        .args(["eval", "--json", &flake_attr])
        .output()
        .with_context(|| {
            format!(
                "Failed to run nix eval for system.defaults using domain {} and attr {}",
                domain, flake_attr
            )
        })?;

    // Read the JSON into the result map, omitting keys with null values.
    if !output.status.success() {
        anyhow::bail!(
            "Failed to evaluate system.defaults for host {}: {}",
            hostname,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let stdout = String::from_utf8(output.stdout)
        .with_context(|| "nix eval for system.defaults returned invalid UTF-8".to_string())?;
    let evaluated_items: BTreeMap<String, Option<serde_json::Value>> =
        serde_json::from_str(&stdout)
            .with_context(|| "Failed to parse nix eval JSON for system.defaults".to_string())?;

    let non_null_items = evaluated_items
        .into_iter()
        .filter_map(|(k, v)| v.map(|val| (k, nix_eval_value_to_string(val))))
        .collect::<BTreeMap<String, String>>();

    Ok(non_null_items)
}

/// Gets short info on all the nix-managed launchd items using `nix eval --json`.
pub fn get_nix_launchd_items(hostname: &str, config_dir: &str) -> Result<Vec<NixLaunchdItem>> {
    let mut items = Vec::new();

    // 1. nix eval ~{config_dir}/#darwinConfigurations.<hostname>.config.launchd.user.agents --json
    items.extend(eval_nix_launchd_items(
        config_dir,
        hostname,
        "launchd.user.agents",
        LaunchdItemType::LaunchdUserAgent,
    )?);

    // 2. nix eval ~{config_dir}/#darwinConfigurations.<hostname>.config.launchd.agents --json
    items.extend(eval_nix_launchd_items(
        config_dir,
        hostname,
        "launchd.agents",
        LaunchdItemType::LaunchAgent,
    )?);

    // 3. nix eval ~{config_dir}/#darwinConfigurations.<hostname>.config.launchd.daemons --json
    items.extend(eval_nix_launchd_items(
        config_dir,
        hostname,
        "launchd.daemons",
        LaunchdItemType::LaunchDaemon,
    )?);

    Ok(items)
}

/// Helper to run `nix eval` for a specific launchd item type and parse the results.
fn eval_nix_launchd_items(
    config_dir: &str,
    hostname: &str,
    option_path: &str,
    item_type: LaunchdItemType,
) -> Result<Vec<NixLaunchdItem>> {
    let host_attr = serde_json::to_string(hostname)?;
    let flake_attr = format!(
        ".#darwinConfigurations.{}.config.{}",
        host_attr, option_path
    );

    let output = nix_command(config_dir)
        .args([
            "eval",
            "--json",
            &flake_attr,
            "--apply",
            r#"builtins.mapAttrs (name: value:
              let cfg = value.config or {};
              in {
                label = cfg.Label or name;
                programArguments =
                  if cfg ? ProgramArguments then cfg.ProgramArguments
                  else if cfg ? Program then [ cfg.Program ]
                  else [];
              })"#,
        ])
        .output()
        .with_context(|| format!("Failed to run nix eval for {}", option_path))?;

    if !output.status.success() {
        anyhow::bail!(
            "Failed to evaluate {} for host {}: {}",
            option_path,
            hostname,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let stdout = String::from_utf8(output.stdout)
        .with_context(|| format!("nix eval for {} returned invalid UTF-8", option_path))?;
    let evaluated_items: BTreeMap<String, NixLaunchdEvalItem> = serde_json::from_str(&stdout)
        .with_context(|| format!("Failed to parse nix eval JSON for {}", option_path))?;

    Ok(evaluated_items
        .into_values()
        .map(|item| NixLaunchdItem {
            label: item.label,
            program_arguments: item.program_arguments,
            item_type,
        })
        .collect())
}

/// Resolves PATH for Nix commands by prepending known Nix paths to the current environment.
///
/// **Important:** This version uses the process environment PATH directly without spawning
/// a login shell. This is the correct choice for high-frequency operations like git polling
/// (which happens every 2.5 seconds).
///
/// The result is computed once and cached for the lifetime of the process.
///
/// See: https://github.com/NixOS/nixpkgs/issues/376958
pub fn get_nix_path() -> String {
    NIX_PATH_CACHE
        .get_or_init(|| {
            let base_path = std::env::var("PATH").unwrap_or_default();
            let nix_paths = NIX_PATHS_FALLBACK.join(":");
            if base_path.is_empty() {
                nix_paths
            } else {
                format!("{}:{}", nix_paths, base_path)
            }
        })
        .clone()
}

/// Resolves PATH using a login shell to find Nix binaries in GUI app contexts.
///
/// **Warning:** Do NOT use this for repeated/frequent operations!
/// - Each call spawns a bash process and sources shell init files
/// - Shell init may trigger `xcrun` from Nix's `xcbuild`, causing warning spam
/// - For frequent operations, use `get_nix_path()` instead
///
pub fn get_nix_path_with_login_shell() -> String {
    if let Ok(output) = Command::new("/bin/bash")
        .args(["-l", "-c", "echo $PATH"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
    {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if output.status.success() && !path.is_empty() {
            return path;
        }
    }

    // Fallback to environment PATH if login shell fails
    get_nix_path()
}

pub fn determine_host_attr<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    crate::storage::store::get_host_attr(app).ok().flatten()
}

pub fn list_darwin_hosts(config_dir: &str) -> Result<Vec<String>> {
    let output = nix_command(config_dir)
        .args([
            "eval",
            "--json",
            ".#darwinConfigurations",
            "--apply",
            "builtins.attrNames",
        ])
        .output()?;

    if !output.status.success() {
        anyhow::bail!(
            "Failed to list hosts: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let stdout = String::from_utf8(output.stdout)?;
    let hosts: Vec<String> = serde_json::from_str(&stdout)?;
    Ok(hosts)
}

/// Gets enabled nix-darwin `environment.etc` targets and safe hashes.
///
/// This is the structured-data source for the `/etc` clobber preflight: instead
/// of parsing activation logs, we read the same `environment.etc` attrset
/// nix-darwin consumes. The `--apply` projection keeps only the three fields we
/// need so the JSON stays small and stable across nix-darwin versions.
pub fn get_nix_environment_etc_entries(
    hostname: &str,
    config_dir: &str,
) -> Result<Vec<NixEnvironmentEtcEntry>> {
    // Serialize via serde_json so an unusual hostname can't break out of the
    // flake attribute path (e.g. embedded quotes).
    let host_attr = serde_json::to_string(hostname)?;
    let flake_attr = format!(
        ".#darwinConfigurations.{}.config.environment.etc",
        host_attr
    );

    let output = nix_command(config_dir)
        .args([
            "eval",
            "--json",
            &flake_attr,
            "--apply",
            r#"builtins.mapAttrs (_name: value: {
              target = value.target;
              enable = value.enable;
              knownSha256Hashes = value.knownSha256Hashes;
            })"#,
        ])
        .output()
        .with_context(|| "Failed to run nix eval for environment.etc".to_string())?;

    if !output.status.success() {
        anyhow::bail!(
            "Failed to evaluate environment.etc for host {}: {}",
            hostname,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let stdout = String::from_utf8(output.stdout)
        .with_context(|| "nix eval for environment.etc returned invalid UTF-8".to_string())?;
    let evaluated_items: BTreeMap<String, NixEnvironmentEtcEvalEntry> =
        serde_json::from_str(&stdout)
            .with_context(|| "Failed to parse nix eval JSON for environment.etc".to_string())?;

    Ok(evaluated_items
        .into_values()
        .filter(|entry| entry.enable)
        .map(|entry| NixEnvironmentEtcEntry {
            target: entry.target,
            known_sha256_hashes: entry.known_sha256_hashes,
        })
        .collect())
}

/// Gets enabled Home Manager `xdg.configFile` targets managed by nix-darwin.
pub fn get_nix_home_manager_xdg_config_file_entries(
    hostname: &str,
    config_dir: &str,
) -> Result<Vec<NixHomeManagerXdgConfigFileEntry>> {
    let host_attr = serde_json::to_string(hostname)?;
    let flake_attr = format!(".#darwinConfigurations.{}.config", host_attr);

    let output = nix_command(config_dir)
        .args([
            "eval",
            "--json",
            &flake_attr,
            "--apply",
            r#"config:
              let
                users = config.home-manager.users or {};
                backupFileExtension = config.home-manager.backupFileExtension or null;
              in builtins.concatLists (builtins.attrValues (builtins.mapAttrs (user: userConfig:
                builtins.attrValues (builtins.mapAttrs (_name: value: {
                  inherit user;
                  target = value.target;
                  xdgConfigHome = userConfig.xdg.configHome;
                  source = if value ? source && value.source != null then toString value.source else null;
                  enable = value.enable;
                  force = value.force or false;
                  inherit backupFileExtension;
                }) (userConfig.xdg.configFile or {}))
              ) users))"#,
        ])
        .output()
        .with_context(|| "Failed to run nix eval for home-manager xdg.configFile".to_string())?;

    if !output.status.success() {
        anyhow::bail!(
            "Failed to evaluate home-manager xdg.configFile for host {}: {}",
            hostname,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let stdout = String::from_utf8(output.stdout).with_context(|| {
        "nix eval for home-manager xdg.configFile returned invalid UTF-8".to_string()
    })?;
    let evaluated_items: Vec<NixHomeManagerXdgConfigFileEvalEntry> = serde_json::from_str(&stdout)
        .with_context(|| {
            "Failed to parse nix eval JSON for home-manager xdg.configFile".to_string()
        })?;

    Ok(evaluated_items
        .into_iter()
        .filter(|entry| entry.enable)
        .map(|entry| NixHomeManagerXdgConfigFileEntry {
            user: entry.user,
            target: entry.target,
            xdg_config_home: entry.xdg_config_home,
            source: entry.source,
            force: entry.force,
            backup_file_extension: entry.backup_file_extension,
        })
        .collect())
}

/// Gets enabled Home Manager `targets.darwin.copyApps` configs managed by
/// nix-darwin.
pub fn get_nix_home_manager_copy_apps_entries(
    hostname: &str,
    config_dir: &str,
) -> Result<Vec<NixHomeManagerCopyAppsEntry>> {
    let host_attr = serde_json::to_string(hostname)?;
    let flake_attr = format!(".#darwinConfigurations.{}.config", host_attr);

    let output = nix_command(config_dir)
        .args([
            "eval",
            "--json",
            &flake_attr,
            "--apply",
            r#"config:
              let
                users = config.home-manager.users or {};
              in builtins.attrValues (builtins.mapAttrs (user: userConfig:
                let cfg = userConfig.targets.darwin.copyApps or {};
                in {
                  inherit user;
                  homeDirectory = userConfig.home.homeDirectory;
                  directory = cfg.directory or "Applications/Home Manager Apps";
                  enable = cfg.enable or false;
                  enableChecks = cfg.enableChecks or true;
                }
              ) users)"#,
        ])
        .output()
        .with_context(|| {
            "Failed to run nix eval for home-manager targets.darwin.copyApps".to_string()
        })?;

    if !output.status.success() {
        anyhow::bail!(
            "Failed to evaluate home-manager targets.darwin.copyApps for host {}: {}",
            hostname,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let stdout = String::from_utf8(output.stdout).with_context(|| {
        "nix eval for home-manager targets.darwin.copyApps returned invalid UTF-8".to_string()
    })?;
    let evaluated_items: Vec<NixHomeManagerCopyAppsEvalEntry> = serde_json::from_str(&stdout)
        .with_context(|| {
            "Failed to parse nix eval JSON for home-manager targets.darwin.copyApps".to_string()
        })?;

    Ok(evaluated_items
        .into_iter()
        .filter(|entry| entry.enable && entry.enable_checks)
        .map(|entry| NixHomeManagerCopyAppsEntry {
            user: entry.user,
            home_directory: entry.home_directory,
            directory: entry.directory,
        })
        .collect())
}

/// Checks if Nix is installed by attempting to run `nix --version`.
pub fn is_nix_installed() -> bool {
    Command::new("/bin/bash")
        .args(["-l", "-c", "nix --version"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Checks if `darwin-rebuild` is available in the Nix PATH.
pub fn is_darwin_rebuild_available() -> bool {
    for dir in get_nix_path().split(':') {
        if std::path::Path::new(dir).join("darwin-rebuild").exists() {
            return true;
        }
    }
    false
}

/// Gets the installed Nix version string.
///
/// Uses the login shell because it's typically called in contexts where we want to reliably detect Nix
/// even if launched from Finder. The original use case is for nix-install.
pub fn get_nix_version() -> Option<String> {
    let output = Command::new("nix")
        .arg("--version")
        .env("PATH", get_nix_path_with_login_shell())
        .output()
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// Runs `nixfmt` (from nixpkgs via `nix run`) against the provided file in `config_dir`.
/// Executes the command:
/// `nix run nixpkgs#nixfmt -- <file>`
pub fn nix_format(config_dir: &str, file: &str) -> Result<String> {
    log::debug!("Running nix format on file: {}", file);

    let output = nix_command(config_dir)
        .args(["run", "nixpkgs#nixfmt", "--", file])
        .output()?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        anyhow::bail!(
            "Failed to format with nixfmt: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

/// Prefetches darwin-rebuild by running `nix build --no-link nix-darwin/master#darwin-rebuild`.
/// This caches the derivation in the nix store so the `nix run` fallback in darwin.rs is fast.
/// Emits `nix:darwin-rebuild:end` with `{ ok: bool, error?: string }` on completion.
pub fn prefetch_darwin_rebuild_stream(app: &AppHandle) -> Result<()> {
    info!("[nix] prefetch_darwin_rebuild_stream called");

    let app_handle = app.clone();

    // All emit calls below are fire-and-forget: background thread; window may not be
    // listening. Tauri emit returns Err only when no listeners are registered.
    // Intentionall doesn't use `nix_command` in order to use get_nix_path_with_login_shell.
    std::thread::spawn(move || {
        crate::state::nix_install_state::update(&app_handle, |state| state.prefetching = true);
        let result = Command::new("nix")
            .args(["build", "--no-link", "nix-darwin/master#darwin-rebuild"])
            .env("PATH", get_nix_path_with_login_shell())
            .env("NIX_CONFIG", "experimental-features = nix-command flakes")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output();

        match result {
            Ok(output) if output.status.success() => {
                info!("[nix] darwin-rebuild prefetch succeeded");
                crate::state::nix_install_state::update(&app_handle, |state| {
                    state.prefetching = false;
                    state.darwin_rebuild_available = Some(true);
                    state.last_error = None;
                });
                let _ =
                    app_handle.emit("nix:darwin-rebuild:end", serde_json::json!({ "ok": true }));
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                error!("[nix] darwin-rebuild prefetch failed: {}", stderr);
                crate::state::nix_install_state::update(&app_handle, |state| {
                    state.prefetching = false;
                    state.last_error = Some(stderr.clone());
                });
                let _ = app_handle.emit(
                    "nix:darwin-rebuild:end",
                    serde_json::json!({ "ok": false, "error": stderr }),
                );
            }
            Err(e) => {
                error!("[nix] darwin-rebuild prefetch error: {}", e);
                crate::state::nix_install_state::update(&app_handle, |state| {
                    state.prefetching = false;
                    state.last_error = Some(e.to_string());
                });
                let _ = app_handle.emit(
                    "nix:darwin-rebuild:end",
                    serde_json::json!({ "ok": false, "error": e.to_string() }),
                );
            }
        }
    });

    info!("[nix] prefetch_darwin_rebuild_stream started background thread");
    Ok(())
}

pub fn install_nix_stream(app: &AppHandle) -> Result<()> {
    info!("[nix] install_nix_stream called");

    let app_handle = app.clone();

    std::thread::spawn(move || {
        if let Err(e) = run_nix_install(&app_handle) {
            error!("[nix] install failed: {}", e);
            crate::state::nix_install_state::record_install_end(
                &app_handle,
                false,
                None,
                Some(e.to_string()),
            );
            let _ = app_handle.emit(
                "nix:install:end",
                serde_json::json!({
                    "ok": false,
                    "code": -1,
                    "error_type": "internal",
                    "error": e.to_string(),
                }),
            );
        }
    });

    info!("[nix] install_nix_stream started background thread");
    Ok(())
}

const PKG_DOWNLOAD_URL: &str =
    "https://install.determinate.systems/determinate-pkg/stable/Universal";

/// Downloads the Determinate Nix .pkg installer with progress reporting.
///
/// Emits `nix:install:progress` events with `phase: "downloading"` and
/// `downloaded`/`total` byte counts so the frontend can show a progress bar.
fn download_nix_pkg(app: &AppHandle) -> Result<std::path::PathBuf> {
    info!("[nix] Downloading .pkg from {}", PKG_DOWNLOAD_URL);

    let client = crate::http_client::logged_blocking();
    let mut response = client.get(PKG_DOWNLOAD_URL)?;

    if !response.status().is_success() {
        anyhow::bail!("Download failed with status {}", response.status());
    }

    let total = response.content_length().unwrap_or(0);
    let pkg_path = std::env::temp_dir().join("Determinate Nix.pkg");
    let mut file = std::fs::File::create(&pkg_path)?;
    let mut downloaded: u64 = 0;
    let mut buffer = [0u8; 65536];
    let mut last_emit = std::time::Instant::now();

    loop {
        let n = response.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        file.write_all(&buffer[..n])?;
        downloaded += n as u64;

        // Throttle progress events to ~20/sec max
        if last_emit.elapsed() > std::time::Duration::from_millis(50) {
            let _ = app.emit(
                "nix:install:progress",
                serde_json::json!({
                    "phase": "downloading",
                    "downloaded": downloaded,
                    "total": total,
                }),
            );
            last_emit = std::time::Instant::now();
        }
    }

    // Final progress event
    let _ = app.emit(
        "nix:install:progress",
        serde_json::json!({
            "phase": "downloading",
            "downloaded": downloaded,
            "total": total,
        }),
    );

    info!("[nix] Download complete: {} bytes", downloaded);
    Ok(pkg_path)
}

/// Timeout for each installation phase — nix install and nix-darwin prefetch (5 minutes each).
const INSTALL_PHASE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

fn run_nix_install(app: &AppHandle) -> Result<()> {
    let nix_installed = is_nix_installed();
    let dr_available = nix_installed && is_darwin_rebuild_available();
    crate::state::nix_install_state::update(app, |state| {
        state.installing = true;
        state.installed = Some(nix_installed);
        state.darwin_rebuild_available = Some(dr_available);
        state.last_error = None;
    });
    // Each phase gets its own 5-minute deadline.
    let mut deadline;

    // Both already available — nothing to do
    if nix_installed && dr_available {
        let version = get_nix_version().unwrap_or_default();
        info!(
            "[nix] already installed, darwin-rebuild available: {}",
            version
        );
        crate::state::nix_install_state::record_install_end(app, true, Some(true), None);
        app.emit(
            "nix:install:end",
            serde_json::json!({
                "ok": true,
                "code": 0,
                "nix_version": version,
                "darwin_rebuild_available": true,
            }),
        )?;
        return Ok(());
    }

    if !nix_installed {
        // Phase 1: Download .pkg and open with macOS Installer.app
        crate::state::nix_install_state::update(app, |state| {
            state.install_phase = Some("downloading".to_string());
        });
        let _ = app.emit(
            "nix:install:progress",
            serde_json::json!({ "phase": "downloading", "downloaded": 0, "total": 0 }),
        );

        let pkg_path = match download_nix_pkg(app) {
            Ok(path) => path,
            Err(e) => {
                crate::state::nix_install_state::record_install_end(
                    app,
                    false,
                    None,
                    Some(format!("Failed to download Nix installer: {}", e)),
                );
                app.emit(
                    "nix:install:end",
                    serde_json::json!({
                        "ok": false,
                        "code": -1,
                        "error_type": "download_failed",
                        "error": format!("Failed to download Nix installer: {}", e),
                    }),
                )?;
                return Ok(());
            }
        };

        // Open the .pkg with macOS Installer.app
        info!("[nix] Opening .pkg with macOS Installer: {:?}", pkg_path);
        crate::state::nix_install_state::update(app, |state| {
            state.install_phase = Some("waiting-for-installer".to_string());
        });
        let _ = app.emit(
            "nix:install:progress",
            serde_json::json!({ "phase": "waiting-for-installer" }),
        );

        if let Err(e) = Command::new("open").arg(&pkg_path).status() {
            // fire-and-forget cleanup: temp pkg may not exist if open() aborted early.
            let _ = std::fs::remove_file(&pkg_path);
            crate::state::nix_install_state::record_install_end(
                app,
                false,
                None,
                Some(format!("Failed to open installer: {}", e)),
            );
            app.emit(
                "nix:install:end",
                serde_json::json!({
                    "ok": false,
                    "code": -1,
                    "error_type": "installer_failed",
                    "error": format!("Failed to open installer: {}", e),
                }),
            )?;
            return Ok(());
        }

        // Start the 5-minute deadline for nix installation (download time doesn't count)
        deadline = std::time::Instant::now() + INSTALL_PHASE_TIMEOUT;

        // Poll until Nix is installed (user completes the macOS Installer wizard)
        let poll_interval = std::time::Duration::from_secs(3);
        let mut poll_count = 0u32;

        loop {
            std::thread::sleep(poll_interval);
            poll_count += 1;
            info!(
                "[nix] Poll #{}: checking if nix is installed...",
                poll_count
            );

            if is_nix_installed() {
                info!("[nix] Poll #{}: nix detected!", poll_count);
                // fire-and-forget cleanup: temp pkg; benign if already removed.
                let _ = std::fs::remove_file(&pkg_path);
                if let Err(e) = crate::bootstrap::default_config::finalize_flake_lock(app) {
                    info!("[nix] Could not finalize flake.lock: {}", e);
                }
                break;
            }

            if std::time::Instant::now() >= deadline {
                // fire-and-forget cleanup on timeout path.
                let _ = std::fs::remove_file(&pkg_path);
                crate::state::nix_install_state::record_install_end(
                    app,
                    false,
                    None,
                    Some(("Installation timed out after 5 minutes. Please try again.").to_string()),
                );
                app.emit(
                    "nix:install:end",
                    serde_json::json!({
                        "ok": false,
                        "code": -1,
                        "error_type": "timeout",
                        "error": "Installation timed out after 5 minutes. Please try again.",
                    }),
                )?;
                return Ok(());
            }
        }
    }

    // Phase 2: Prefetch darwin-rebuild directly (no Terminal needed)
    // Fresh 5-minute deadline for this phase
    deadline = std::time::Instant::now() + INSTALL_PHASE_TIMEOUT;
    // fire-and-forget: progress event; non-fatal if no listener.
    crate::state::nix_install_state::update(app, |state| {
        state.installed = Some(true);
        state.install_phase = Some("prefetching".to_string());
    });
    let _ = app.emit(
        "nix:install:progress",
        serde_json::json!({ "phase": "prefetching" }),
    );

    info!("[nix] Prefetching darwin-rebuild in background");
    let mut child = match Command::new("nix")
        .args(["build", "--no-link", "nix-darwin/master#darwin-rebuild"])
        .env("PATH", get_nix_path_with_login_shell())
        .env("NIX_CONFIG", "experimental-features = nix-command flakes")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            error!("[nix] darwin-rebuild prefetch error: {}", e);
            crate::state::nix_install_state::record_install_end(
                app,
                false,
                None,
                Some(format!("Failed to set up nix-darwin: {}", e)),
            );
            app.emit(
                "nix:install:end",
                serde_json::json!({
                    "ok": false,
                    "code": -1,
                    "error_type": "darwin_rebuild",
                    "error": format!("Failed to set up nix-darwin: {}", e),
                }),
            )?;
            return Ok(());
        }
    };

    // Poll until the child exits or the deadline is reached
    let poll_interval = std::time::Duration::from_secs(1);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    // fire-and-forget: kill() fails only if process already exited.
                    // wait() cleanup after kill may also fail — both are acceptable here.
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err("timed out");
                }
                std::thread::sleep(poll_interval);
            }
            Err(e) => {
                error!("[nix] darwin-rebuild wait error: {}", e);
                break Err("wait failed");
            }
        }
    };

    match status {
        Ok(s) if s.success() => {
            info!("[nix] darwin-rebuild prefetch succeeded");
        }
        Ok(_) => {
            error!("[nix] darwin-rebuild prefetch failed");
            crate::state::nix_install_state::record_install_end(
                app,
                false,
                None,
                Some(("Failed to set up nix-darwin. Please try again.").to_string()),
            );
            app.emit(
                "nix:install:end",
                serde_json::json!({
                    "ok": false,
                    "code": -1,
                    "error_type": "darwin_rebuild",
                    "error": "Failed to set up nix-darwin. Please try again.",
                }),
            )?;
            return Ok(());
        }
        Err(_) => {
            error!("[nix] darwin-rebuild prefetch timed out");
            crate::state::nix_install_state::record_install_end(
                app,
                false,
                None,
                Some(("Installation timed out after 5 minutes. Please try again.").to_string()),
            );
            app.emit(
                "nix:install:end",
                serde_json::json!({
                    "ok": false,
                    "code": -1,
                    "error_type": "timeout",
                    "error": "Installation timed out after 5 minutes. Please try again.",
                }),
            )?;
            return Ok(());
        }
    }

    // Both ready
    let version = get_nix_version().unwrap_or_default();
    info!(
        "[nix] Setup complete: nix={}, darwin-rebuild cached",
        version
    );
    crate::state::nix_install_state::record_install_end(app, true, Some(true), None);
    app.emit(
        "nix:install:end",
        serde_json::json!({
            "ok": true,
            "code": 0,
            "nix_version": version,
            "darwin_rebuild_available": true,
        }),
    )?;
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    // Create a test that runs the launchd eval on the current system and prints the results.
    // Leave it off by default.
    #[test]
    #[ignore = "Runs against the local system; enable explicitly when debugging the nix launchd eval."]
    #[cfg(target_os = "macos")]
    fn test_get_nix_launchd_items() {
        use crate::bootstrap::default_config::detect_hostname;

        let this_host_name = detect_hostname().expect("failed to get hostname");
        const CONFIG_DIR: &str = "~/.darwin";
        let items = get_nix_launchd_items(&this_host_name, CONFIG_DIR);
        match items {
            Ok(items) => {
                for item in items {
                    println!("{:#?}", item);
                }
            }
            Err(err) => {
                eprintln!("Error evaluating nix launchd items: {}", err);
            }
        }
    }

    #[test]
    #[ignore = "Runs against the local system; enable explicitly when debugging the nix rebuild check."]
    #[cfg(target_os = "macos")]
    fn test_is_rebuild_needed() -> Result<()> {
        use crate::bootstrap::default_config::detect_hostname;

        let this_host_name = detect_hostname().expect("failed to get hostname");
        const CONFIG_DIR: &str = "~/.darwin";

        let rebuild_needed = is_rebuild_needed(&this_host_name, CONFIG_DIR)?;
        println!(
            "Rebuild needed for host {}: {}",
            this_host_name, rebuild_needed
        );

        Ok(())
    }

    #[test]
    #[ignore = "Runs against the local system; enable explicitly when debugging the nix system defaults."]
    #[cfg(target_os = "macos")]
    fn test_get_nix_system_defaults_for_domain() -> Result<()> {
        use crate::bootstrap::default_config::detect_hostname;

        let this_host_name = detect_hostname().expect("failed to get hostname");
        const CONFIG_DIR: &str = "~/.darwin";
        let domain = "finder";

        let defaults = get_nix_system_defaults_for_domain(&this_host_name, CONFIG_DIR, domain)?;
        println!("System defaults for domain {}: {:#?}", domain, defaults);

        Ok(())
    }

    #[ignore = "Runs against the local system; enable explicitly when debugging the nix system defaults."]
    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_system_primary_user() {
        use crate::bootstrap::default_config::detect_hostname;

        let this_host_name = detect_hostname().expect("failed to get hostname");
        const CONFIG_DIR: &str = "~/.darwin";

        match get_system_primary_user(&this_host_name, CONFIG_DIR) {
            Some(user) => println!("Primary user for host {}: {}", this_host_name, user),
            None => println!("No primary user defined for host {}", this_host_name),
        }
    }
}
