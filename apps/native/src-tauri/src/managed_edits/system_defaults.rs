//! Applies detected macOS system defaults to the nix-darwin configuration.

use anyhow::{Context, Result};
use tauri::AppHandle;

use crate::system::scanner;
use crate::{managed_edits::managed_edit, shared_types};

/// Writes detected system defaults to a .nix module file, injects the import
/// into flake.nix, creates an evolution + summarization pipeline so the
/// frontend lands on the evolve step with a populated changeMap.
pub async fn apply_system_defaults(
    app: &AppHandle,
    defaults: Vec<scanner::SystemDefault>,
) -> Result<shared_types::ConfigEditApplyResult> {
    let context = managed_edit::prepare_managed_edit(app)?;
    let dir = context.dir.clone();

    // 1. Generate nix file content
    log::info!(
        "[apply_system_defaults] Generating nix content for {} defaults",
        defaults.len()
    );
    let nix_content = scanner::generate_system_defaults_nix(&defaults);

    // 2. Ensure modules/darwin directory exists
    let modules_dir = std::path::Path::new(&dir).join("modules").join("darwin");
    std::fs::create_dir_all(&modules_dir).context("Failed to create modules dir")?;

    // 3. Write system-defaults.nix
    let nix_path = modules_dir.join("system-defaults.nix");
    std::fs::write(&nix_path, &nix_content).context("Failed to write system-defaults.nix")?;
    log::info!(
        "[apply_system_defaults] Wrote {} defaults to {:?}",
        defaults.len(),
        nix_path
    );

    // 4. Inject import into the file that contains the nix-darwin modules list.
    let target_path = managed_edit::inject_darwin_module_import(
        &dir,
        "system-defaults.nix",
        "apply_system_defaults",
    )?;
    log::info!(
        "[apply_system_defaults] Injected module import into {:?}",
        target_path
    );

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
