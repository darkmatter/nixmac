//! Applies detected macOS system defaults to the nix-darwin configuration.

use anyhow::{Context, Result};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

use crate::evolve::nix_file_editor::{apply_semantic_edit, escape_nix_string};
use crate::evolve::types::{FileEditAction, SemanticFileEdit};
use crate::system::nix::get_system_primary_user;
use crate::system::scanner;
use crate::{managed_edits::managed_edit, shared_types};
use tauri::AppHandle;

/// Name of the file that we use for defaults tracking. Note that this allows the user
/// to already have defaults defined in other flakes. But it's not trivial to try
/// and find any such possibly-appropriate existing location to add to, so we
/// hook up our own as needed the first time you use the tracking feature.
const SYSTEM_DEFAULTS_MODULE_FILENAME: &str = "system-defaults.nix";

/// Gets the relative path to the system defaults module, which is always `modules/darwin/system-defaults.nix`
/// under the config dir (which the caller controls, it's not calculated here).
fn system_defaults_module_path() -> String {
    format!("modules/darwin/{SYSTEM_DEFAULTS_MODULE_FILENAME}")
}

/// Generates a bare-bones system defaults module while optionally setting the required `system.primaryUser` attribute,
/// This is used as the starting point for managing system defaults, and is later injected into the user's
/// config if not already present.
fn system_defaults_module_template(add_primary_user: bool) -> String {
    let mut module = String::from("{\n  # macOS system defaults managed by nixmac.\n");

    if add_primary_user {
        let username = std::env::var("USER").unwrap_or_else(|_| "unknown".to_string());

        module.push_str(&format!(
            r#"  # Required by nix-darwin for system.defaults.* options.
  system.primaryUser = "{}";
"#,
            escape_nix_string(&username)
        ));
    }

    module.push_str("}\n");
    module
}

/// Helper method used when grouping nix values that contain dots in quoted keys.
/// Returns the index of the last unquoted dot in the string, or None if there are no unquoted dots.
fn rfind_unquoted_dot(value: &str) -> Option<usize> {
    let mut in_quotes = false;
    let mut escaped = false;
    let mut last_dot = None;

    for (idx, ch) in value.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match ch {
            '\\' if in_quotes => escaped = true,
            '"' => in_quotes = !in_quotes,
            '.' if !in_quotes => last_dot = Some(idx),
            _ => {}
        }
    }

    last_dot
}

/// Ensures the managed system-defaults module exists and is imported.
///
/// This only creates the module shell when it is missing. Applying individual
/// `system.defaults.*` values is handled separately through semantic Nix edits.
pub fn ensure_system_defaults_module(
    config_dir: &str,
    add_primary_user: bool,
) -> Result<std::path::PathBuf> {
    let modules_dir = std::path::Path::new(config_dir)
        .join("modules")
        .join("darwin");
    std::fs::create_dir_all(&modules_dir)
        .with_context(|| format!("failed to create directory '{}'", modules_dir.display()))?;

    // Use an existing primaryUser if available.
    let module_path = modules_dir.join(SYSTEM_DEFAULTS_MODULE_FILENAME);
    if !module_path.exists() {
        std::fs::write(
            &module_path,
            system_defaults_module_template(add_primary_user),
        )
        .with_context(|| format!("failed to write '{}'", module_path.display()))?;
    }

    managed_edit::inject_darwin_module_import(
        config_dir,
        SYSTEM_DEFAULTS_MODULE_FILENAME,
        "ensure_system_defaults_module",
    )?;

    Ok(module_path)
}

/// Groups the given system defaults by their nix key prefix (everything before the last dot),
/// returning a map of group -> (attr -> value) for each default.
fn group_system_defaults(
    defaults: &[scanner::SystemDefault],
) -> BTreeMap<String, Map<String, Value>> {
    let mut groups: BTreeMap<String, Map<String, Value>> = BTreeMap::new();

    for default in defaults {
        let Some(last_dot) = rfind_unquoted_dot(&default.nix_key) else {
            log::warn!(
                "[apply_system_defaults] skipping default with invalid nix key '{}'",
                default.nix_key
            );
            continue;
        };
        let group = &default.nix_key[..last_dot];
        let attr = &default.nix_key[last_dot + 1..];
        let value =
            scanner::system_default_current_value_to_json(&default.current_value, group, attr);
        groups
            .entry(group.to_string())
            .or_default()
            .insert(attr.to_string(), value);
    }

    groups
}

/// Applies the given system defaults to the managed system-defaults module using semantic Nix edits.
fn apply_system_defaults_to_module(
    config_dir: &std::path::Path,
    defaults: &[scanner::SystemDefault],
) -> Result<()> {
    for (group, attrs) in group_system_defaults(defaults) {
        apply_semantic_edit(
            config_dir,
            &SemanticFileEdit {
                path: system_defaults_module_path(),
                action: FileEditAction::SetAttrs { path: group, attrs },
            },
            None,
        )?;
    }

    Ok(())
}

/// Ensures the managed system-defaults module is hooked up, applies the passed
/// defaults through semantic Nix edits, and enters the managed review flow.
pub async fn apply_system_defaults(
    app: &AppHandle,
    hostname: &str,
    defaults: Vec<scanner::SystemDefault>,
) -> Result<shared_types::ConfigEditApplyResult> {
    let context = managed_edit::prepare_managed_edit(app)?;
    let dir = context.dir.clone();
    let config_path = std::path::Path::new(&dir);

    log::info!(
        "[apply_system_defaults] Applying {} defaults",
        defaults.len()
    );

    let primary_user = get_system_primary_user(hostname, &dir);

    let module_path = ensure_system_defaults_module(&dir, primary_user.is_none())
        .context("Failed to ensure system-defaults.nix exists and is imported")?;
    log::info!(
        "[apply_system_defaults] Ensured module at {:?}",
        module_path
    );

    apply_system_defaults_to_module(config_path, &defaults)
        .context("Failed to apply system defaults to module")?;

    let working_tree_status =
        crate::git::status(&dir).context("Failed to get working tree status for evolve state")?;

    log::info!(
        "[apply_system_defaults] Complete — {} defaults applied",
        defaults.len()
    );

    managed_edit::finalize_managed_edit(
        app,
        context,
        working_tree_status,
        defaults.len(),
        "apply_system_defaults",
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_file(path: &std::path::Path, content: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("failed to create parent directories");
        }
        std::fs::write(path, content).expect("failed to write test file");
    }

    fn system_default(nix_key: &str, current_value: &str) -> scanner::SystemDefault {
        scanner::SystemDefault {
            nix_key: nix_key.to_string(),
            label: nix_key.to_string(),
            category: "Test".to_string(),
            current_value: current_value.to_string(),
            default_value: String::new(),
        }
    }

    #[test]
    fn test_ensure_system_defaults_module_creates_shell_and_import() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        write_file(
            &temp.path().join("flake.nix"),
            "darwinConfigurations.test = nix-darwin.lib.darwinSystem { modules=[\n  ./configuration.nix\n]; };",
        );

        let config_dir = temp.path().to_string_lossy();
        let module_path =
            ensure_system_defaults_module(&config_dir, false).expect("module should be ensured");
        let module = std::fs::read_to_string(&module_path).expect("module should be readable");
        let flake = std::fs::read_to_string(temp.path().join("flake.nix"))
            .expect("flake should be readable");

        assert!(!module.contains("system.primaryUser"));
        assert!(!module.contains("system.defaults.dock"));
        assert!(flake.contains("./modules/darwin/system-defaults.nix"));
    }

    #[test]
    fn test_system_defaults_module_template_adds_primary_user_when_provided() {
        let module = system_defaults_module_template(true);

        assert!(module.contains("system.primaryUser = \""));
    }

    #[test]
    fn test_apply_system_defaults_to_module_uses_semantic_edits() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        write_file(
            &temp.path().join(system_defaults_module_path()),
            r#"{ config, ... }:
{
  system.primaryUser = "me";

  system.defaults.dock = {
    autohide = false;
  };
}
"#,
        );

        apply_system_defaults_to_module(
            temp.path(),
            &[
                system_default("system.defaults.dock.autohide", "true"),
                system_default("system.defaults.dock.tilesize", "48"),
                system_default(
                    "system.defaults.NSGlobalDomain.\"com.apple.sound.beep.feedback\"",
                    "0",
                ),
            ],
        )
        .expect("defaults should apply");

        let module = std::fs::read_to_string(temp.path().join(system_defaults_module_path()))
            .expect("module should be readable");
        assert!(module.contains("system.primaryUser = \"me\";"));
        assert!(module.contains("autohide = true;"));
        assert!(module.contains("tilesize = 48;"));
        assert!(module.contains("\"com.apple.sound.beep.feedback\" = 0;"));
    }

    #[test]
    fn test_group_system_defaults() {
        let defaults = vec![
            system_default("system.defaults.dock.autohide", "true"),
            system_default("system.defaults.dock.tilesize", "48"),
            system_default(
                "system.defaults.NSGlobalDomain.\"com.apple.sound.beep.feedback\"",
                "0",
            ),
        ];

        let grouped = group_system_defaults(&defaults);

        assert_eq!(grouped.len(), 2);
        assert!(grouped.contains_key("system.defaults.dock"));
        assert!(grouped.contains_key("system.defaults.NSGlobalDomain"));

        let dock_attrs = &grouped["system.defaults.dock"];
        assert_eq!(dock_attrs.len(), 2);
        assert_eq!(dock_attrs["autohide"], Value::Bool(true));
        assert_eq!(dock_attrs["tilesize"], Value::Number(48.into()));

        let global_attrs = &grouped["system.defaults.NSGlobalDomain"];
        assert_eq!(global_attrs.len(), 1);
        assert_eq!(
            global_attrs["\"com.apple.sound.beep.feedback\""],
            Value::Number(0.into())
        );
    }
}
