//! macOS launchd item scanner.
//!
//! Scans launchd items for potential import to nix.
//! Currently this just handles launchd items that can be
//! managed via `brew` but in the future it may be extended
//! to include LaunchAgents, LaunchDaemons, and Login Items.
//!

use crate::evolve::nix_file_editor::apply_semantic_edit;
use crate::evolve::types::{FileEditAction, SemanticFileEdit};
use crate::managed_edits::managed_edit;
use crate::shared_types::{self, LaunchdItem, LaunchdItemType};
use crate::system::nix::get_nix_path;
use crate::{system::nix::get_nix_launchd_items, utils::normalize_path_input};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::AppHandle;

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

/// Maps the `LaunchdItemType` enum to the corresponding nix-darwin option path.
fn launchd_scope_option_path(scope: &LaunchdItemType) -> &'static str {
    match scope {
        LaunchdItemType::LaunchAgent => "launchd.agents",
        LaunchdItemType::LaunchDaemon => "launchd.daemons",
        LaunchdItemType::LaunchdUserAgent => "launchd.user.agents",
    }
}

fn launchd_item_to_nix_value(item: &LaunchdItem) -> serde_json::Value {
    let mut service_config = serde_json::Map::new();
    service_config.insert(
        "Label".to_string(),
        serde_json::Value::String(item.label.clone()),
    );
    service_config.insert(
        "ProgramArguments".to_string(),
        serde_json::Value::Array(
            item.program_arguments
                .iter()
                .cloned()
                .map(serde_json::Value::String)
                .collect(),
        ),
    );
    service_config.insert(
        "RunAtLoad".to_string(),
        serde_json::Value::Bool(item.run_at_load),
    );
    service_config.insert(
        "KeepAlive".to_string(),
        serde_json::Value::Bool(item.keep_alive),
    );

    if !item.environment_variables.is_empty() {
        service_config.insert(
            "EnvironmentVariables".to_string(),
            serde_json::Value::Object(
                item.environment_variables
                    .iter()
                    .map(|(key, value)| (key.clone(), serde_json::Value::String(value.clone())))
                    .collect(),
            ),
        );
    }

    if let Some(path) = &item.standard_out_path {
        service_config.insert(
            "StandardOutPath".to_string(),
            serde_json::Value::String(path.clone()),
        );
    }

    if let Some(path) = &item.standard_error_path {
        service_config.insert(
            "StandardErrorPath".to_string(),
            serde_json::Value::String(path.clone()),
        );
    }

    if let Some(directory) = &item.working_directory {
        service_config.insert(
            "WorkingDirectory".to_string(),
            serde_json::Value::String(directory.clone()),
        );
    }

    let mut service = serde_json::Map::new();
    service.insert(
        "serviceConfig".to_string(),
        serde_json::Value::Object(service_config),
    );
    serde_json::Value::Object(service)
}

fn launchd_items_by_scope(
    items: &[LaunchdItem],
) -> BTreeMap<&'static str, serde_json::Map<String, serde_json::Value>> {
    let mut grouped: BTreeMap<&'static str, serde_json::Map<String, serde_json::Value>> =
        BTreeMap::new();

    for item in items {
        grouped
            .entry(launchd_scope_option_path(&item.scope))
            .or_default()
            .insert(item.name.clone(), launchd_item_to_nix_value(item));
    }

    grouped
}

fn ensure_services_module_exists(config_dir: &str) -> Result<()> {
    let modules_dir = std::path::Path::new(config_dir)
        .join("modules")
        .join("darwin");
    std::fs::create_dir_all(&modules_dir).context("Failed to create modules dir")?;

    let services_path = modules_dir.join("services.nix");
    if services_path.exists() {
        return Ok(());
    }

    std::fs::write(&services_path, "{ ... }:\n\n{\n}\n")
        .context("Failed to create services.nix")?;
    Ok(())
}

pub async fn apply_launchd_items_to_flake(
    app: &AppHandle,
    items: Vec<LaunchdItem>,
) -> Result<shared_types::ConfigEditApplyResult> {
    let context: managed_edit::ManagedEditContext = managed_edit::prepare_managed_edit(app)?;
    let dir: String = context.dir.clone();

    log::debug!(
        "[apply_launchd_items_to_flake] Applying {} items with semantic edits",
        items.len()
    );

    ensure_services_module_exists(&dir)?;

    // Inject import into the file that contains the nix-darwin modules list before editing
    // the module so a new services.nix is immediately part of the managed diff.
    let target_path = managed_edit::inject_darwin_module_import(
        &dir,
        "services.nix",
        "apply_launchd_items_to_flake",
    )?;
    log::debug!(
        "[apply_launchd_items_to_flake] Injected module import into {:?}",
        target_path
    );

    for (path, attrs) in launchd_items_by_scope(&items) {
        if attrs.is_empty() {
            continue;
        }

        apply_semantic_edit(
            std::path::Path::new(&dir),
            &SemanticFileEdit {
                path: "modules/darwin/services.nix".to_string(),
                action: FileEditAction::SetAttrs {
                    path: path.to_string(),
                    attrs,
                },
            },
            None,
        )
        .with_context(|| format!("Failed to apply launchd items at {}", path))?;
    }

    let working_tree_status =
        crate::git::status(&dir).context("Failed to get working tree status for evolve state")?;

    log::debug!(
        "[apply_launchd_items_to_flake] Complete — {} items applied",
        items.len()
    );

    managed_edit::finalize_managed_edit(
        app,
        context,
        working_tree_status,
        items.len(),
        "apply_launchd_items_to_flake",
    )
    .await
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
        use crate::bootstrap::default_config::detect_hostname;

        let this_host_name = detect_hostname().expect("failed to get hostname");
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

    #[test]
    fn test_launchd_item_to_nix_value_uses_service_config() {
        let item = LaunchdItem {
            label: "homebrew.mxcl.redis".to_string(),
            scope: LaunchdItemType::LaunchdUserAgent,
            name: "redis".to_string(),
            program_arguments: vec!["/opt/homebrew/opt/redis/bin/redis-server".to_string()],
            run_at_load: true,
            keep_alive: true,
            environment_variables: [("REDIS_ENV".to_string(), "test".to_string())]
                .iter()
                .cloned()
                .collect(),
            standard_out_path: Some("/tmp/redis.out".to_string()),
            standard_error_path: None,
            working_directory: None,
        };

        let value = launchd_item_to_nix_value(&item);
        let service_config = value
            .as_object()
            .and_then(|service| service.get("serviceConfig"))
            .and_then(serde_json::Value::as_object)
            .expect("serviceConfig attrset");

        assert_eq!(
            service_config.get("Label"),
            Some(&serde_json::Value::String(
                "homebrew.mxcl.redis".to_string()
            ))
        );
        assert_eq!(
            service_config.get("ProgramArguments"),
            Some(&serde_json::json!([
                "/opt/homebrew/opt/redis/bin/redis-server"
            ]))
        );
        assert_eq!(
            service_config.get("RunAtLoad"),
            Some(&serde_json::Value::Bool(true))
        );
        assert_eq!(
            service_config.get("KeepAlive"),
            Some(&serde_json::Value::Bool(true))
        );
        assert_eq!(
            service_config.get("EnvironmentVariables"),
            Some(&serde_json::json!({ "REDIS_ENV": "test" }))
        );
        assert_eq!(
            service_config.get("StandardOutPath"),
            Some(&serde_json::Value::String("/tmp/redis.out".to_string()))
        );
        assert!(!service_config.contains_key("StandardErrorPath"));
        assert!(!service_config.contains_key("WorkingDirectory"));
    }

    #[test]
    fn test_launchd_items_by_scope_groups_for_nix_darwin_options() {
        let items = vec![
            LaunchdItem {
                label: "com.example.user".to_string(),
                scope: LaunchdItemType::LaunchdUserAgent,
                name: "example-user".to_string(),
                program_arguments: vec!["/bin/echo".to_string(), "user".to_string()],
                run_at_load: true,
                keep_alive: false,
                environment_variables: BTreeMap::new(),
                standard_out_path: None,
                standard_error_path: None,
                working_directory: None,
            },
            LaunchdItem {
                label: "com.example.daemon".to_string(),
                scope: LaunchdItemType::LaunchDaemon,
                name: "example-daemon".to_string(),
                program_arguments: vec!["/bin/echo".to_string(), "daemon".to_string()],
                run_at_load: false,
                keep_alive: true,
                environment_variables: BTreeMap::new(),
                standard_out_path: None,
                standard_error_path: None,
                working_directory: None,
            },
        ];

        let grouped = launchd_items_by_scope(&items);

        assert!(grouped["launchd.user.agents"].contains_key("example-user"));
        assert!(grouped["launchd.daemons"].contains_key("example-daemon"));
        assert!(!grouped.contains_key("launchd.agents"));
    }

    #[test]
    fn test_launchd_semantic_edit_preserves_existing_services_module() {
        let temp = tempfile::tempdir().expect("tempdir");
        let module_dir = temp.path().join("modules/darwin");
        std::fs::create_dir_all(&module_dir).expect("module dir");
        std::fs::write(
            module_dir.join("services.nix"),
            r#"{ ... }:

{
  services = {
    tailscale.enable = true;
  };
}
"#,
        )
        .expect("write fixture");

        let item = LaunchdItem {
            label: "homebrew.mxcl.redis".to_string(),
            scope: LaunchdItemType::LaunchdUserAgent,
            name: "redis".to_string(),
            program_arguments: vec!["/opt/homebrew/opt/redis/bin/redis-server".to_string()],
            run_at_load: true,
            keep_alive: false,
            environment_variables: BTreeMap::new(),
            standard_out_path: None,
            standard_error_path: None,
            working_directory: None,
        };

        for (path, attrs) in launchd_items_by_scope(&[item]) {
            apply_semantic_edit(
                temp.path(),
                &SemanticFileEdit {
                    path: "modules/darwin/services.nix".to_string(),
                    action: FileEditAction::SetAttrs {
                        path: path.to_string(),
                        attrs,
                    },
                },
                None,
            )
            .expect("semantic edit");
        }

        let updated = std::fs::read_to_string(module_dir.join("services.nix"))
            .expect("read updated services module");

        assert!(updated.contains("tailscale.enable = true;"));
        assert!(updated.contains("launchd.user.agents = {"));
        assert!(updated.contains("redis = { serviceConfig = {"));
        assert!(updated.contains("Label = \"homebrew.mxcl.redis\";"));
        assert!(
            updated
                .contains("ProgramArguments = [ \"/opt/homebrew/opt/redis/bin/redis-server\" ];")
        );
        assert!(updated.contains("RunAtLoad = true;"));
        assert!(updated.contains("KeepAlive = false;"));
    }

    #[test]
    fn test_launchd_semantic_edit_adds_to_existing_item() {
        let temp = tempfile::tempdir().expect("tempdir");
        let module_dir = temp.path().join("modules/darwin");
        std::fs::create_dir_all(&module_dir).expect("module dir");
        std::fs::write(
            module_dir.join("services.nix"),
            r#"{ ... }:

{
  launchd.user.agents = {
    existing-agent = {
      serviceConfig = {
        Label = "com.example.existing";
        ProgramArguments = [ "/bin/echo" "existing" ];
        RunAtLoad = true;
      };
    };
  };
}
"#,
        )
        .expect("write fixture");

        let item = LaunchdItem {
            label: "homebrew.mxcl.redis".to_string(),
            scope: LaunchdItemType::LaunchdUserAgent,
            name: "redis".to_string(),
            program_arguments: vec!["/opt/homebrew/opt/redis/bin/redis-server".to_string()],
            run_at_load: true,
            keep_alive: false,
            environment_variables: BTreeMap::new(),
            standard_out_path: None,
            standard_error_path: None,
            working_directory: None,
        };

        for (path, attrs) in launchd_items_by_scope(&[item]) {
            apply_semantic_edit(
                temp.path(),
                &SemanticFileEdit {
                    path: "modules/darwin/services.nix".to_string(),
                    action: FileEditAction::SetAttrs {
                        path: path.to_string(),
                        attrs,
                    },
                },
                None,
            )
            .expect("semantic edit");
        }

        let updated = std::fs::read_to_string(module_dir.join("services.nix"))
            .expect("read updated services module");

        assert_eq!(updated.matches("launchd.user.agents = {").count(), 1);
        assert!(updated.contains("existing-agent = {"));
        assert!(updated.contains("Label = \"com.example.existing\";"));
        assert!(updated.contains("redis = { serviceConfig = {"));
        assert!(updated.contains("Label = \"homebrew.mxcl.redis\";"));
        assert!(
            updated
                .contains("ProgramArguments = [ \"/opt/homebrew/opt/redis/bin/redis-server\" ];")
        );
        assert!(updated.contains("RunAtLoad = true;"));
        assert!(updated.contains("KeepAlive = false;"));
    }
}
