//! macOS launchd item scanner.
//!
//! Scans launchd items for potential import to nix.
//! Currently this just handles launchd items that can be
//! managed via `brew` but in the future it may be extended
//! to include LaunchAgents, LaunchDaemons, and Login Items.
//!

use crate::shared_types::{LaunchdItem, LaunchdItemType};
use crate::system::nix::get_nix_path;
use crate::{system::nix::get_nix_launchd_items, utils::normalize_path_input};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Represents the tabular output of `brew services list`.
/// Note that the JSON output doesn't have the same info, namely the *actual*
/// plist file that's running the service, which is necessary for us to determine
/// the service type and the command to run it in a version-upgrade-insensitive way.
#[derive(Serialize, Deserialize, Debug)]
pub struct BrewService {
    name: String,
    status: String,
    user: Option<String>,
    file: String,
}

/// Represents the launchd plist format commonly used by brew services.

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
pub struct BrewServicePlist {
    pub label: String,

    #[serde(default)]
    pub program_arguments: Vec<String>,

    #[serde(default)]
    pub keep_alive: bool,

    #[serde(default)]
    pub run_at_load: bool,

    #[serde(default)]
    pub limit_load_to_session_type: Vec<String>,

    #[serde(default)]
    pub environment_variables: BTreeMap<String, String>,

    pub standard_error_path: Option<String>,
    pub standard_out_path: Option<String>,
    pub working_directory: Option<String>,
}

/// Represents a brew-manageable launchd item, combining the service info and its plist.
#[derive(Debug)]
pub struct BrewManagedLaunchdItem {
    #[allow(dead_code)]
    pub service: BrewService,
    #[allow(dead_code)]
    pub plist: BrewServicePlist,
    #[allow(dead_code)]
    pub item_type: LaunchdItemType,
}

impl From<BrewManagedLaunchdItem> for LaunchdItem {
    fn from(item: BrewManagedLaunchdItem) -> Self {
        LaunchdItem {
            label: item.plist.label,
            scope: item.item_type,
            name: item.service.name,
            program_arguments: item.plist.program_arguments,
            run_at_load: item.plist.run_at_load,
            keep_alive: item.plist.keep_alive,
            environment_variables: item.plist.environment_variables,
            standard_out_path: item.plist.standard_out_path,
            standard_error_path: item.plist.standard_error_path,
            working_directory: item.plist.working_directory,
        }
    }
}

/// Gets the list of services on the system that can be managed via `brew`.
fn list_brew_services() -> Result<Vec<BrewService>> {
    // `brew services list` returns output in this tabular format:
    //
    // ```
    // Name          Status  User      File
    // postgresql@14 none
    // redis         started myuser ~/Library/LaunchAgents/homebrew.mxcl.redis.plist
    // ```
    // We don't use the `--json` flag because it uses the launch plist rather than the
    // one that is actually running the service, which means we can't infer the service type or the command to run it.

    let output = std::process::Command::new("brew")
        .args(["services", "list"])
        .env("PATH", get_nix_path())
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to execute `brew services list`: {e}"))?;

    if !output.status.success() {
        log::warn!(
            "Error running brew services list: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        return Err(anyhow::anyhow!("Error running brew services list"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Parse the tabular format, skipping the header line.
    let mut services = Vec::new();
    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();

        // Services that have no status will have 2 parts where user and file should default to None and "" respectively.
        if parts.len() == 2 {
            services.push(BrewService {
                name: parts[0].to_string(),
                status: parts[1].to_string(),
                user: None,
                file: String::new(),
            });
            continue;
        } else if parts.len() != 4 {
            log::warn!("Unexpected format for brew services list line: {}", line);
            continue;
        }

        let service = BrewService {
            name: parts[0].to_string(),
            status: parts[1].to_string(),
            user: if parts[2] == "-" {
                None
            } else {
                Some(parts[2].to_string())
            },
            file: parts[3].to_string(),
        };
        services.push(service);
    }
    Ok(services)
}

fn classify_brew_launchd_item(plist: &BrewServicePlist) -> LaunchdItemType {
    // This is a heuristic based on the "LimitLoadToSessionType" key in the plist, which is commonly used by brew services to indicate the type of service.
    // It's not perfect but it should work for most cases.
    if plist
        .limit_load_to_session_type
        .contains(&"Aqua".to_string())
    {
        LaunchdItemType::LaunchAgent
    } else if plist
        .limit_load_to_session_type
        .contains(&"Background".to_string())
    {
        LaunchdItemType::LaunchDaemon
    } else {
        // Default to user agent if we can't determine the type.
        LaunchdItemType::LaunchdUserAgent
    }
}
/// Loads the metadata for all the brew-manageable launchd items that are currently started on the system.
/// We restrict ourselves to "started" services because those are the ones that have a plist file from
/// which we can infer the service type and the version-upgrade-insensitive command to run the service.
fn read_brew_launchd_items() -> Result<Vec<BrewManagedLaunchdItem>> {
    let services = list_brew_services()?;
    let mut plists = Vec::new();

    // Filter to just the "started" status services.
    let started_services: Vec<_> = services
        .into_iter()
        .filter(|s| s.status == "started")
        .collect();
    for service in started_services {
        // The file is probably a ~ path so we need to expand it to an absolute path.
        let plist_path = normalize_path_input(&service.file).map_err(anyhow::Error::msg)?;

        // Use the plist crate to do the reading.
        match plist::from_file::<_, BrewServicePlist>(&plist_path) {
            Ok(plist) => {
                let item_type = classify_brew_launchd_item(&plist);
                plists.push(BrewManagedLaunchdItem {
                    service,
                    plist,
                    item_type,
                });
            }
            Err(err) => {
                // Some services report a default plist path even if the file doesn't exist, so log the error but keep going.
                log::debug!(
                    "Failed to read plist for {} from {}: {}",
                    service.name,
                    plist_path.display(),
                    err
                );
            }
        }
    }

    Ok(plists)
}

/// Scans the system for launchd items that are configured but not managed by nix.
/// Currently this just includes RUNNING brew-managed services, but in the future it may be extended to include other types of launchd items.
///
/// The approach is:
/// 1. Get the brew-managed launchd items.
/// 2. Get the nix-managed launchd items.
/// 3. Intersect them by comparing a) the brew plist.label and b) the nix launchd item serviceConfig.Label
///     (which is the only stable identifier we have across versions of the same service) to get the difference.
/// Note that it's technically possible that this service was added to nix with a different label than the brew one,
/// but hopefully that's a weird edge case.
pub fn scan_launchd_items_for_hostname(
    hostname: &str,
    config_dir: &str,
) -> Result<Vec<LaunchdItem>> {
    // 1. Get the brew-managed launchd items.
    let brew_items = read_brew_launchd_items()?;

    // 2. Get the nix-managed launchd items.
    let nix_items = get_nix_launchd_items(&hostname, config_dir)?;

    // 3. Remove the intersection of the two lists by comparing the brew plist.label and the nix launchd item serviceConfig.Label.
    let nix_labels: std::collections::HashSet<String> =
        nix_items.into_iter().map(|item| item.label).collect();
    let launchd_items: Vec<LaunchdItem> = brew_items
        .into_iter()
        .filter(|item| !nix_labels.contains(&item.plist.label))
        .map(LaunchdItem::from)
        .collect();

    Ok(launchd_items)
}

#[cfg(test)]
mod tests {
    use super::*;
    // Create a test that runs the scanner on the current system and prints the results.
    // Leave it off by default.
    #[test]
    #[ignore = "Runs against the local system; enable explicitly when debugging the launchd scanner."]
    #[cfg(target_os = "macos")]
    fn test_scan_launchd_items() {
        use crate::commands::config::get_this_hostname_cmd;

        let this_host_name = get_this_hostname_cmd().expect("Failed to get hostname for test");
        const CONFIG_DIR: &str = "~/.darwin";
        let items = scan_launchd_items_for_hostname(&this_host_name, CONFIG_DIR);
        match items {
            Ok(items) => {
                for item in items {
                    println!("{:#?}", item);
                }
            }
            Err(err) => {
                eprintln!("Error scanning launchd items: {}", err);
            }
        }
    }
}
