use crate::evolve::edit_nix_file::{apply_semantic_edit, nix_quote_values};
use crate::evolve::file_ops::resolve_path_in_dir_allow_create;
use crate::evolve::types::{FileEditAction, SemanticFileEdit};
use crate::shared_types::HomebrewState;
use crate::system::nix_ast_lists::parse_string_lists_by_attrpath;
use crate::system::scanner::inject_module_import;
use crate::{managed_edits::managed_edit, shared_types};
use anyhow::{Context, Result};
use serde_json::{Map, Value};
use tauri::AppHandle;

const NIXMAC_HOMEBREW_DATA_PATH: &str = ".nixmac/homebrew/data.json";
const LEGACY_HOMEBREW_NIX_TEMPLATE: &str = r#"{ config, pkgs, ... }:

{
  homebrew = {
    taps = [ ];
    brews = [ ];
    casks = [ ];
  };
}
"#;

/// Checks if Homebrew is installed by trying to run `brew --version`.
fn is_homebrew_installed() -> bool {
    std::process::Command::new("brew")
        .arg("--version")
        .env("PATH", crate::system::nix::get_nix_path())
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

// Private factory to create a HomebrewState with common defaults.
fn make_homebrew_state(is_installed: bool, source: Option<String>) -> HomebrewState {
    HomebrewState {
        is_installed,
        casks: Vec::new(),
        brews: Vec::new(),
        taps: Vec::new(),
        source,
        last_checked: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64,
    }
}

fn e2e_mock_system_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled("NIXMAC_E2E_MOCK_SYSTEM")
}

fn e2e_list_env(name: &str) -> Vec<String> {
    crate::e2e_runtime::value(name)
        .into_iter()
        .flat_map(|value| {
            value
                .split([',', '\n'])
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect()
}

fn e2e_homebrew_state() -> Option<HomebrewState> {
    if !e2e_mock_system_enabled() {
        return None;
    }

    let fixture_is_configured = [
        "NIXMAC_E2E_HOMEBREW_BREWS",
        "NIXMAC_E2E_HOMEBREW_CASKS",
        "NIXMAC_E2E_HOMEBREW_TAPS",
    ]
    .iter()
    .any(|name| crate::e2e_runtime::value(name).is_some());
    if !fixture_is_configured {
        return None;
    }

    let brews = e2e_list_env("NIXMAC_E2E_HOMEBREW_BREWS");
    let casks = e2e_list_env("NIXMAC_E2E_HOMEBREW_CASKS");
    let taps = e2e_list_env("NIXMAC_E2E_HOMEBREW_TAPS");

    let mut state = make_homebrew_state(true, None);
    state.brews = brews;
    state.casks = casks;
    state.taps = taps;
    Some(state)
}

fn json_string_array(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn read_homebrew_data(path: &std::path::Path) -> Result<Value> {
    if !path.exists() {
        let mut data = Map::new();
        data.insert("taps".to_string(), Value::Array(Vec::new()));
        data.insert("brews".to_string(), Value::Array(Vec::new()));
        data.insert("casks".to_string(), Value::Array(Vec::new()));
        return Ok(Value::Object(data));
    }

    let contents = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read Homebrew data file '{}'", path.display()))?;
    serde_json::from_str(&contents)
        .with_context(|| format!("failed to parse Homebrew data file '{}'", path.display()))
}

fn merge_json_array(data: &mut Value, key: &str, values: &[String]) -> Result<()> {
    if values.is_empty() {
        return Ok(());
    }

    let object = data
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("Homebrew data must be a JSON object"))?;
    let entry = object
        .entry(key.to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    let array = entry
        .as_array_mut()
        .ok_or_else(|| anyhow::anyhow!("Homebrew data key '{}' must be an array", key))?;

    for item in values {
        if !array.iter().any(|existing| existing.as_str() == Some(item)) {
            array.push(Value::String(item.clone()));
        }
    }

    Ok(())
}

fn load_homebrew_data_state(path: &std::path::Path) -> Result<HomebrewState> {
    let data = read_homebrew_data(path)?;
    let mut state = make_homebrew_state(
        is_homebrew_installed(),
        Some(NIXMAC_HOMEBREW_DATA_PATH.to_string()),
    );
    state.casks = json_string_array(&data, "casks");
    state.brews = json_string_array(&data, "brews");
    state.taps = json_string_array(&data, "taps");
    Ok(state)
}

/// Gets the current homebrew state from the system and nix config, computes the diff, and returns it.
pub fn get_homebrew_state_diff(config_dir: &std::path::Path) -> Result<HomebrewState> {
    let installed = scan_homebrew();
    let config = load_nix_config_homebrew(config_dir);
    Ok(compute_homebrew_diff(installed, config))
}

/// Writes the Homebrew diff into config files, snapshots the pre-edit tree onto a rollback
/// branch, and enters the managed review flow so the frontend lands on the evolve step.
pub async fn apply_homebrew_diff(
    app: &AppHandle,
    diff: shared_types::HomebrewState,
) -> Result<shared_types::ConfigEditApplyResult> {
    let context = managed_edit::prepare_managed_edit(app)?;
    let dir = context.dir.clone();

    let submitted_source = diff.source.clone();
    let fresh_installed = scan_homebrew();
    let fresh_config = load_nix_config_homebrew(std::path::Path::new(&dir));
    let diff = sanitize_homebrew_diff(diff, fresh_installed, fresh_config);
    if submitted_source != diff.source {
        log::warn!(
            "[apply_homebrew] corrected submitted Homebrew source from {:?} to {:?}",
            submitted_source,
            diff.source
        );
    }
    let item_count = homebrew_item_count(&diff);

    apply_homebrew_import(diff, std::path::Path::new(&dir))
        .context("Failed to apply Homebrew diff")?;

    let working_tree_status =
        crate::git::status(&dir).context("Failed to get working tree status for evolve state")?;
    managed_edit::finalize_managed_edit(
        app,
        context,
        working_tree_status,
        item_count,
        "apply_homebrew",
    )
    .await
}

/// Scan the system for Homebrew packages, casks, and taps.
/// Only includes explicitly installed brews and casks (via `--installed-on-request`), not their dependencies.
/// Excludes default taps (homebrew/core, homebrew/cask).
/// If homebrew is not installed, returns an empty state with is_installed set to false.
pub fn scan_homebrew() -> HomebrewState {
    if let Some(state) = e2e_homebrew_state() {
        return state;
    }

    let mut state = make_homebrew_state(is_homebrew_installed(), None);
    if let Ok(output) = std::process::Command::new("brew")
        .args(["list", "--installed-on-request", "--formula"])
        .env("PATH", crate::system::nix::get_nix_path())
        .output()
    {
        if output.status.success() {
            state.brews = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::to_owned)
                .collect();
        }
    }
    if let Ok(output) = std::process::Command::new("brew")
        .args(["list", "--installed-on-request", "--cask"])
        .env("PATH", crate::system::nix::get_nix_path())
        .output()
    {
        if output.status.success() {
            state.casks = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::to_owned)
                .collect();
        }
    }
    if let Ok(output) = std::process::Command::new("brew")
        .args(["tap"])
        .env("PATH", crate::system::nix::get_nix_path())
        .output()
    {
        if output.status.success() {
            state.taps = String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter(|line| {
                    // Exclude default taps
                    !line.starts_with("homebrew/core") && !line.starts_with("homebrew/cask")
                })
                .map(str::to_owned)
                .collect();
        }
    }

    state
}

/// Reads the homebrew state currently in nix config in the provided config dir, if it exists.
/// Otherwise returns an empty state.
/// The only supported nix config layouts for homebrew are:
/// - .nixmac/homebrew/data.json
/// - modules/darwin/homebrew.nix
/// - flake-modules/darwin.nix inline lists
///
/// Depending on which one exists, we'll set the source field to the full
/// path of the file or "flake-modules/darwin.nix" respectively, which can be used to determine where to write changes.
pub fn load_nix_config_homebrew(config_dir: &std::path::Path) -> HomebrewState {
    let mut state = make_homebrew_state(is_homebrew_installed(), None);

    let nixmac_homebrew_data = config_dir.join(NIXMAC_HOMEBREW_DATA_PATH);
    if nixmac_homebrew_data.exists() {
        match load_homebrew_data_state(&nixmac_homebrew_data) {
            Ok(data_state) => return data_state,
            Err(e) => {
                log::warn!(
                    "failed to read Nixmac Homebrew data from '{}': {}",
                    nixmac_homebrew_data.display(),
                    e
                );
            }
        }
    }

    let homebrew_nix = config_dir.join("modules/darwin/homebrew.nix");
    if homebrew_nix.exists() {
        state.source = Some("modules/darwin/homebrew.nix".to_string());
        if let Ok(contents) = std::fs::read_to_string(&homebrew_nix) {
            let parsed = parse_string_lists_by_attrpath(&contents);
            state.casks = parsed
                .get("homebrew.casks")
                .or_else(|| parsed.get("casks"))
                .cloned()
                .unwrap_or_default();
            state.brews = parsed
                .get("homebrew.brews")
                .or_else(|| parsed.get("brews"))
                .cloned()
                .unwrap_or_default();
            state.taps = parsed
                .get("homebrew.taps")
                .or_else(|| parsed.get("taps"))
                .cloned()
                .unwrap_or_default();
        }
    } else {
        let flake_darwin = config_dir.join("flake-modules/darwin.nix");
        if flake_darwin.exists() {
            state.source = Some("flake-modules/darwin.nix".to_string());
            if let Ok(contents) = std::fs::read_to_string(&flake_darwin) {
                let parsed = parse_string_lists_by_attrpath(&contents);
                state.casks = parsed.get("homebrew.casks").cloned().unwrap_or_default();
                state.brews = parsed.get("homebrew.brews").cloned().unwrap_or_default();
                state.taps = parsed.get("homebrew.taps").cloned().unwrap_or_default();
            }
        }
    }

    state
}

/// Finds what's missing from the config compared to the installed state,
/// which is what we would want to add to the nix config to match the installed state.
/// The source field of the diff is taken from the config, since that's where we would want to write the changes.
pub fn compute_homebrew_diff(installed: HomebrewState, config: HomebrewState) -> HomebrewState {
    let mut state = make_homebrew_state(installed.is_installed, config.source.clone());

    state.casks = installed
        .casks
        .into_iter()
        .filter(|c| !config.casks.contains(c))
        .collect();

    state.brews = installed
        .brews
        .into_iter()
        .filter(|f| !config.brews.contains(f))
        .collect();

    state.taps = installed
        .taps
        .into_iter()
        .filter(|t| !config.taps.contains(t))
        .collect();

    state
}

fn homebrew_item_count(state: &HomebrewState) -> usize {
    state.casks.len() + state.brews.len() + state.taps.len()
}

fn intersect_submitted_with_fresh(submitted: Vec<String>, fresh_missing: &[String]) -> Vec<String> {
    submitted
        .into_iter()
        .filter(|item| fresh_missing.contains(item))
        .collect()
}

fn sanitize_homebrew_diff(
    submitted: HomebrewState,
    fresh_installed: HomebrewState,
    fresh_config: HomebrewState,
) -> HomebrewState {
    let fresh_missing = compute_homebrew_diff(fresh_installed, fresh_config);
    HomebrewState {
        is_installed: fresh_missing.is_installed,
        casks: intersect_submitted_with_fresh(submitted.casks, &fresh_missing.casks),
        brews: intersect_submitted_with_fresh(submitted.brews, &fresh_missing.brews),
        taps: intersect_submitted_with_fresh(submitted.taps, &fresh_missing.taps),
        source: fresh_missing.source,
        last_checked: fresh_missing.last_checked,
    }
}

fn ensure_nixmac_homebrew_module(config_dir: &std::path::Path) -> Result<()> {
    let nixmac_dir = config_dir.join(".nixmac");
    let module_dir = nixmac_dir.join("homebrew");
    std::fs::create_dir_all(&module_dir)
        .with_context(|| format!("failed to create directory '{}'", module_dir.display()))?;

    let root_default = nixmac_dir.join("default.nix");
    if !root_default.exists() {
        std::fs::write(
            &root_default,
            include_str!("../../../templates/nix-darwin-determinate/.nixmac/default.nix"),
        )
        .with_context(|| format!("failed to write '{}'", root_default.display()))?;
    }

    let module_default = module_dir.join("default.nix");
    if !module_default.exists() {
        std::fs::write(
            &module_default,
            include_str!("../../../templates/nix-darwin-determinate/.nixmac/homebrew/default.nix"),
        )
        .with_context(|| format!("failed to write '{}'", module_default.display()))?;
    }

    let module_meta = module_dir.join("meta.json");
    if !module_meta.exists() {
        std::fs::write(
            &module_meta,
            include_str!("../../../templates/nix-darwin-determinate/.nixmac/homebrew/meta.json"),
        )
        .with_context(|| format!("failed to write '{}'", module_meta.display()))?;
    }

    let module_data = module_dir.join("data.json");
    if !module_data.exists() {
        std::fs::write(
            &module_data,
            include_str!("../../../templates/nix-darwin-determinate/.nixmac/homebrew/data.json"),
        )
        .with_context(|| format!("failed to write '{}'", module_data.display()))?;
    }

    Ok(())
}

fn apply_homebrew_data_import(
    diff: &HomebrewState,
    config_dir: &std::path::Path,
    source_rel: &str,
) -> Result<()> {
    if source_rel == NIXMAC_HOMEBREW_DATA_PATH {
        ensure_nixmac_homebrew_module(config_dir)?;
    }

    let source = resolve_path_in_dir_allow_create(config_dir, source_rel)
        .with_context(|| format!("invalid homebrew source path '{}'", source_rel))?;
    if let Some(parent) = source.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory '{}'", parent.display()))?;
    }

    let mut data = read_homebrew_data(&source)?;
    merge_json_array(&mut data, "taps", &diff.taps)?;
    merge_json_array(&mut data, "brews", &diff.brews)?;
    merge_json_array(&mut data, "casks", &diff.casks)?;

    let rendered = serde_json::to_string_pretty(&data)?;
    std::fs::write(&source, format!("{}\n", rendered))
        .with_context(|| format!("failed to write '{}'", source.display()))?;

    Ok(())
}

/// Writes missing items in the diff to the config, using the source field to determine where to write.
/// If the source is empty, we'll set up the official .nixmac/homebrew module and write data.json.
/// We also hook up .nixmac to flake.nix in that case.
#[allow(dead_code)]
pub fn apply_homebrew_import(diff: HomebrewState, config_dir: &std::path::Path) -> Result<()> {
    if diff.casks.is_empty() && diff.brews.is_empty() && diff.taps.is_empty() {
        return Ok(());
    }

    let source_rel = diff
        .source
        .clone()
        .unwrap_or_else(|| NIXMAC_HOMEBREW_DATA_PATH.to_string());

    if source_rel.ends_with(".json") {
        if diff.source.is_none() && !config_dir.join("flake.nix").exists() {
            return Err(anyhow::anyhow!(
                "cannot enable Nixmac Homebrew module because '{}' does not exist",
                config_dir.join("flake.nix").display()
            ));
        }

        apply_homebrew_data_import(&diff, config_dir, &source_rel)?;

        if diff.source.is_none() {
            let flake_path = config_dir.join("flake.nix");
            let flake_content = std::fs::read_to_string(&flake_path)
                .with_context(|| format!("failed to read flake file '{}'", flake_path.display()))?;

            let updated = inject_module_import(&flake_content, "./.nixmac")
                .map_err(anyhow::Error::msg)
                .with_context(|| {
                    format!(
                        "failed to inject Nixmac module import into '{}'",
                        flake_path.display()
                    )
                })?;

            if updated != flake_content {
                std::fs::write(&flake_path, updated).with_context(|| {
                    format!("failed to write flake file '{}'", flake_path.display())
                })?;
            }
        }

        return Ok(());
    }

    let source = resolve_path_in_dir_allow_create(config_dir, &source_rel)
        .with_context(|| format!("invalid homebrew source path '{}'", source_rel))?;
    let creating_default_module = diff.source.is_none();

    // Legacy path: if a .nix source doesn't exist, seed a simple nix-darwin Homebrew module.
    if !source.exists() {
        if let Some(parent) = source.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create directory '{}'", parent.display()))?;
        }

        std::fs::write(&source, LEGACY_HOMEBREW_NIX_TEMPLATE)?;
    }

    // If we created a new module because there was no existing source, ensure flake imports it.
    if creating_default_module {
        let flake_path = config_dir.join("flake.nix");
        if flake_path.exists() {
            let flake_content = std::fs::read_to_string(&flake_path)
                .with_context(|| format!("failed to read flake file '{}'", flake_path.display()))?;

            let updated = inject_module_import(&flake_content, "./modules/darwin/homebrew.nix")
                .map_err(anyhow::Error::msg)
                .with_context(|| {
                    format!(
                        "failed to inject homebrew module import into '{}'",
                        flake_path.display()
                    )
                })?;

            if updated != flake_content {
                std::fs::write(&flake_path, updated).with_context(|| {
                    format!("failed to write flake file '{}'", flake_path.display())
                })?;
            }
        }
    }

    // Use semantic edits so list updates are idempotent and preserve existing structure.
    if !diff.taps.is_empty() {
        apply_semantic_edit(
            config_dir,
            &SemanticFileEdit {
                path: source_rel.clone(),
                action: FileEditAction::Add {
                    path: "homebrew.taps".to_string(),
                    values: nix_quote_values(&diff.taps),
                },
            },
            None,
        )?;
    }

    if !diff.brews.is_empty() {
        apply_semantic_edit(
            config_dir,
            &SemanticFileEdit {
                path: source_rel.clone(),
                action: FileEditAction::Add {
                    path: "homebrew.brews".to_string(),
                    values: nix_quote_values(&diff.brews),
                },
            },
            None,
        )?;
    }

    if !diff.casks.is_empty() {
        apply_semantic_edit(
            config_dir,
            &SemanticFileEdit {
                path: source_rel,
                action: FileEditAction::Add {
                    path: "homebrew.casks".to_string(),
                    values: nix_quote_values(&diff.casks),
                },
            },
            None,
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn homebrew_state(
        casks: &[&str],
        brews: &[&str],
        taps: &[&str],
        source: Option<&str>,
    ) -> HomebrewState {
        HomebrewState {
            is_installed: true,
            casks: casks.iter().map(|item| item.to_string()).collect(),
            brews: brews.iter().map(|item| item.to_string()).collect(),
            taps: taps.iter().map(|item| item.to_string()).collect(),
            source: source.map(|item| item.to_string()),
            last_checked: 0,
        }
    }

    fn write_file(path: &std::path::Path, content: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("failed to create parent directories");
        }
        std::fs::write(path, content).expect("failed to write test file");
    }

    #[test]
    fn load_nix_config_homebrew_reads_nixmac_data_file() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let data_file = temp.path().join(NIXMAC_HOMEBREW_DATA_PATH);
        write_file(
            &data_file,
            r#"{
  "taps": ["homebrew/cask-fonts"],
  "brews": ["git", "jq"],
  "casks": ["iterm2", "raycast"]
}
"#,
        );

        let state = load_nix_config_homebrew(temp.path());

        assert_eq!(state.source.as_deref(), Some(NIXMAC_HOMEBREW_DATA_PATH));
        assert_eq!(state.casks, vec!["iterm2", "raycast"]);
        assert_eq!(state.brews, vec!["git", "jq"]);
        assert_eq!(state.taps, vec!["homebrew/cask-fonts"]);
    }

    #[test]
    fn load_nix_config_homebrew_prefers_nixmac_data_file() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        write_file(
            &temp.path().join(NIXMAC_HOMEBREW_DATA_PATH),
            r#"{
  "taps": [],
  "brews": ["git"],
  "casks": []
}
"#,
        );
        write_file(
            &temp.path().join("modules/darwin/homebrew.nix"),
            r#"{ ... }: { homebrew.brews = [ "jq" ]; }
"#,
        );

        let state = load_nix_config_homebrew(temp.path());

        assert_eq!(state.source.as_deref(), Some(NIXMAC_HOMEBREW_DATA_PATH));
        assert_eq!(state.brews, vec!["git"]);
    }

    #[test]
    fn load_nix_config_homebrew_reads_modules_file() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let homebrew_file = temp.path().join("modules/darwin/homebrew.nix");
        write_file(
            &homebrew_file,
            r#"{ config, pkgs, ... }:
{
  homebrew = {
    casks = [ "iterm2" "raycast" ];
    brews = [ "git" "jq" ];
    taps = [ "homebrew/cask-fonts" ];
  };
}
"#,
        );

        let state = load_nix_config_homebrew(temp.path());

        assert_eq!(
            state.source.as_deref(),
            Some("modules/darwin/homebrew.nix"),
            "expected module source to be detected"
        );
        assert_eq!(state.casks, vec!["iterm2", "raycast"]);
        assert_eq!(state.brews, vec!["git", "jq"]);
        assert_eq!(state.taps, vec!["homebrew/cask-fonts"]);
    }

    #[test]
    fn load_nix_config_homebrew_reads_flake_modules_file() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let darwin_file = temp.path().join("flake-modules/darwin.nix");
        write_file(
            &darwin_file,
            r#"{ config, pkgs, ... }:
{
  homebrew.casks = [ "iterm2" ];
  homebrew.brews = [ "git" ];
  homebrew.taps = [ "homebrew/cask-fonts" ];
}
"#,
        );

        let state = load_nix_config_homebrew(temp.path());

        assert_eq!(
            state.source.as_deref(),
            Some("flake-modules/darwin.nix"),
            "expected flake-modules source to be detected"
        );
        assert_eq!(state.casks, vec!["iterm2"]);
        assert_eq!(state.brews, vec!["git"]);
        assert_eq!(state.taps, vec!["homebrew/cask-fonts"]);
    }

    #[test]
    fn load_nix_config_homebrew_reads_multiline_lists() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let homebrew_file = temp.path().join("modules/darwin/homebrew.nix");
        write_file(
            &homebrew_file,
            r#"{ config, pkgs, ... }:
{
    homebrew = {
        casks = [
            "iterm2"
            "raycast"
        ];
        brews = [
            "git"
            "jq"
        ];
        taps = [
            "homebrew/cask-fonts"
        ];
    };
}
"#,
        );

        let state = load_nix_config_homebrew(temp.path());

        assert_eq!(state.casks, vec!["iterm2", "raycast"]);
        assert_eq!(state.brews, vec!["git", "jq"]);
        assert_eq!(state.taps, vec!["homebrew/cask-fonts"]);
    }

    #[test]
    fn compute_homebrew_diff_returns_only_missing_items() {
        let installed = HomebrewState {
            casks: vec!["iterm2".to_string(), "raycast".to_string()],
            brews: vec!["git".to_string(), "jq".to_string()],
            taps: vec!["homebrew/cask-fonts".to_string()],
            source: None,
            is_installed: true,
            last_checked: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64,
        };
        let config = HomebrewState {
            casks: vec!["iterm2".to_string()],
            brews: vec!["git".to_string()],
            taps: vec![],
            source: Some("modules/darwin/homebrew.nix".to_string()),
            is_installed: true,
            last_checked: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64,
        };

        let diff = compute_homebrew_diff(installed, config);

        assert_eq!(diff.casks, vec!["raycast"]);
        assert_eq!(diff.brews, vec!["jq"]);
        assert_eq!(diff.taps, vec!["homebrew/cask-fonts"]);
        assert_eq!(diff.source.as_deref(), Some("modules/darwin/homebrew.nix"));
    }

    #[test]
    fn sanitize_homebrew_diff_drops_stale_items_already_in_config() {
        let submitted = homebrew_state(
            &["iterm2", "raycast"],
            &["git", "jq"],
            &["homebrew/cask-fonts"],
            Some("modules/darwin/homebrew.nix"),
        );
        let fresh_installed = homebrew_state(
            &["iterm2", "raycast"],
            &["git", "jq"],
            &["homebrew/cask-fonts"],
            None,
        );
        let fresh_config = homebrew_state(
            &["iterm2"],
            &["git"],
            &[],
            Some("modules/darwin/homebrew.nix"),
        );

        let sanitized = sanitize_homebrew_diff(submitted, fresh_installed, fresh_config);

        assert_eq!(sanitized.casks, vec!["raycast"]);
        assert_eq!(sanitized.brews, vec!["jq"]);
        assert_eq!(sanitized.taps, vec!["homebrew/cask-fonts"]);
        assert_eq!(
            sanitized.source.as_deref(),
            Some("modules/darwin/homebrew.nix")
        );
        assert_eq!(homebrew_item_count(&sanitized), 3);
    }

    #[test]
    fn sanitize_homebrew_diff_uses_fresh_source_over_submitted_source() {
        let submitted = homebrew_state(&[], &["jq"], &[], Some("modules/darwin/homebrew.nix"));
        let fresh_installed = homebrew_state(&[], &["jq"], &[], None);
        let fresh_config = homebrew_state(&[], &[], &[], Some("flake-modules/darwin.nix"));

        let sanitized = sanitize_homebrew_diff(submitted, fresh_installed, fresh_config);

        assert_eq!(sanitized.brews, vec!["jq"]);
        assert_eq!(
            sanitized.source.as_deref(),
            Some("flake-modules/darwin.nix")
        );
    }

    #[test]
    fn sanitize_homebrew_diff_noops_when_submitted_items_are_no_longer_missing() {
        let submitted = homebrew_state(
            &["iterm2"],
            &["jq"],
            &["homebrew/cask-fonts"],
            Some("modules/darwin/homebrew.nix"),
        );
        let fresh_installed = homebrew_state(&["iterm2"], &["jq"], &["homebrew/cask-fonts"], None);
        let fresh_config = homebrew_state(
            &["iterm2"],
            &["jq"],
            &["homebrew/cask-fonts"],
            Some("modules/darwin/homebrew.nix"),
        );

        let sanitized = sanitize_homebrew_diff(submitted, fresh_installed, fresh_config);

        assert!(sanitized.casks.is_empty());
        assert!(sanitized.brews.is_empty());
        assert!(sanitized.taps.is_empty());
        assert_eq!(
            sanitized.source.as_deref(),
            Some("modules/darwin/homebrew.nix")
        );
        assert_eq!(homebrew_item_count(&sanitized), 0);
    }

    #[test]
    fn sanitize_homebrew_diff_noops_when_homebrew_is_no_longer_installed() {
        let submitted = HomebrewState {
            is_installed: true,
            casks: vec!["iterm2".to_string()],
            brews: vec!["jq".to_string()],
            taps: vec!["homebrew/cask-fonts".to_string()],
            source: Some("modules/darwin/homebrew.nix".to_string()),
            last_checked: 0,
        };
        let fresh_installed = HomebrewState {
            is_installed: false,
            casks: vec![],
            brews: vec![],
            taps: vec![],
            source: None,
            last_checked: 0,
        };
        let fresh_config = homebrew_state(&[], &[], &[], Some("modules/darwin/homebrew.nix"));

        let sanitized = sanitize_homebrew_diff(submitted, fresh_installed, fresh_config);

        assert!(!sanitized.is_installed);
        assert!(sanitized.casks.is_empty());
        assert!(sanitized.brews.is_empty());
        assert!(sanitized.taps.is_empty());
        assert_eq!(
            sanitized.source.as_deref(),
            Some("modules/darwin/homebrew.nix")
        );
        assert_eq!(homebrew_item_count(&sanitized), 0);
    }

    #[test]
    fn sanitized_default_source_still_creates_nixmac_module_and_injects_flake_import() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let flake = temp.path().join("flake.nix");
        write_file(
            &flake,
            r#"{
  outputs = { self }: {
    darwinConfigurations.host = {
      modules = [
        ./modules/darwin/system.nix
      ];
    };
  };
}
"#,
        );
        let submitted = homebrew_state(
            &["iterm2"],
            &["git"],
            &["homebrew/cask-fonts"],
            Some("flake-modules/darwin.nix"),
        );
        let fresh_installed = homebrew_state(&["iterm2"], &["git"], &["homebrew/cask-fonts"], None);
        let fresh_config = homebrew_state(&[], &[], &[], None);
        let sanitized = sanitize_homebrew_diff(submitted, fresh_installed, fresh_config);

        assert_eq!(sanitized.source, None);
        apply_homebrew_import(sanitized, temp.path())
            .expect("sanitized apply should create default module");

        let data_file = temp.path().join(NIXMAC_HOMEBREW_DATA_PATH);
        let data: Value = serde_json::from_str(
            &std::fs::read_to_string(data_file).expect("homebrew data should exist"),
        )
        .expect("homebrew data should parse");
        assert_eq!(
            json_string_array(&data, "taps"),
            vec!["homebrew/cask-fonts"]
        );
        assert_eq!(json_string_array(&data, "brews"), vec!["git"]);
        assert_eq!(json_string_array(&data, "casks"), vec!["iterm2"]);
        assert!(temp.path().join(".nixmac/homebrew/default.nix").exists());
        assert!(temp.path().join(".nixmac/homebrew/meta.json").exists());

        let flake_content = std::fs::read_to_string(flake).expect("flake should remain readable");
        assert!(flake_content.contains("./.nixmac"));
    }

    #[test]
    fn apply_homebrew_import_creates_nixmac_module_and_injects_flake_import() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let flake = temp.path().join("flake.nix");
        write_file(
            &flake,
            r#"{
  outputs = { self }: {
    darwinConfigurations.host = {
      modules = [
        ./modules/darwin/system.nix
      ];
    };
  };
}
"#,
        );

        let diff = HomebrewState {
            casks: vec!["iterm2".to_string()],
            brews: vec!["git".to_string()],
            taps: vec!["homebrew/cask-fonts".to_string()],
            source: None,
            is_installed: true,
            last_checked: 0,
        };

        apply_homebrew_import(diff, temp.path()).expect("apply_homebrew_import should succeed");

        let data_file = temp.path().join(NIXMAC_HOMEBREW_DATA_PATH);
        let data: Value = serde_json::from_str(
            &std::fs::read_to_string(data_file).expect("homebrew data should exist"),
        )
        .expect("homebrew data should parse");
        assert_eq!(
            json_string_array(&data, "taps"),
            vec!["homebrew/cask-fonts"]
        );
        assert_eq!(json_string_array(&data, "brews"), vec!["git"]);
        assert_eq!(json_string_array(&data, "casks"), vec!["iterm2"]);

        let flake_content = std::fs::read_to_string(flake).expect("flake should remain readable");
        assert!(
            flake_content.contains("./.nixmac"),
            "expected flake import to be injected"
        );
    }

    #[test]
    fn apply_homebrew_import_without_source_requires_flake() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let diff = HomebrewState {
            casks: vec!["iterm2".to_string()],
            brews: vec![],
            taps: vec![],
            source: None,
            is_installed: true,
            last_checked: 0,
        };

        let err = apply_homebrew_import(diff, temp.path())
            .expect_err("default .nixmac source should require flake.nix");

        assert!(err.to_string().contains("flake.nix"));
        assert!(
            !temp.path().join(".nixmac").exists(),
            ".nixmac should not be written when flake.nix is missing"
        );
    }

    #[test]
    fn apply_homebrew_import_does_not_modify_flake_when_source_is_explicit() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let flake = temp.path().join("flake.nix");
        let flake_initial = r#"{
  outputs = { self }: {
    darwinConfigurations.host = {
      modules = [
        ./modules/darwin/system.nix
      ];
    };
  };
}
"#;
        write_file(&flake, flake_initial);

        let homebrew_file = temp.path().join("modules/darwin/homebrew.nix");
        write_file(
            &homebrew_file,
            r#"{ config, pkgs, ... }:
{
  homebrew = {
    taps = [ ];
    brews = [ ];
    casks = [ ];
  };
}
"#,
        );

        let diff = HomebrewState {
            casks: vec!["iterm2".to_string()],
            brews: vec![],
            taps: vec![],
            source: Some("modules/darwin/homebrew.nix".to_string()),
            is_installed: true,
            last_checked: 0,
        };

        apply_homebrew_import(diff, temp.path()).expect("apply_homebrew_import should succeed");

        let flake_content = std::fs::read_to_string(flake).expect("flake should remain readable");
        assert_eq!(
            flake_content, flake_initial,
            "expected explicit source mode not to touch flake imports"
        );
    }

    #[test]
    #[ignore = "manual: requires Homebrew installed locally; run with -- --ignored --nocapture"]
    fn scan_homebrew_manual_output() {
        let state = scan_homebrew();
        println!(
            "scan_homebrew => brews: {:?}\ncasks: {:?}\ntaps: {:?}",
            state.brews, state.casks, state.taps
        );
    }
}
