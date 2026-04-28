//! Applies detected macOS system defaults to the nix-darwin configuration.

use anyhow::{Context, Result};
use tauri::AppHandle;

use crate::{managed_edit, scanner};

/// Writes detected system defaults to a .nix module file, injects the import
/// into flake.nix, creates an evolution + summarization pipeline so the
/// frontend lands on the evolve step with a populated changeMap.
pub async fn apply_system_defaults(
    app: &AppHandle,
    defaults: Vec<scanner::SystemDefault>,
) -> Result<serde_json::Value> {
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

    // 4. Inject import into the file that contains `modules = [`
    //    - nix-darwin-determinate template: `flake.nix` with `./modules/darwin/...`
    //    - flake-parts template: `flake-modules/darwin.nix` with `../modules/darwin/...`
    let flake_path = std::path::Path::new(&dir).join("flake.nix");
    let flake_content = std::fs::read_to_string(&flake_path).context("Failed to read flake.nix")?;

    let (target_path, module_ref) = if flake_content.contains("modules = [") {
        log::info!("[apply_system_defaults] Found modules list in flake.nix");
        (
            flake_path,
            "./modules/darwin/system-defaults.nix".to_string(),
        )
    } else {
        let darwin_mod = std::path::Path::new(&dir)
            .join("flake-modules")
            .join("darwin.nix");
        if darwin_mod.exists() {
            log::info!("[apply_system_defaults] Found modules list in flake-modules/darwin.nix");
            (
                darwin_mod,
                "../modules/darwin/system-defaults.nix".to_string(),
            )
        } else {
            anyhow::bail!("Could not find 'modules = [' in flake.nix or flake-modules/darwin.nix");
        }
    };

    let target_content =
        std::fs::read_to_string(&target_path).context("Failed to read target module file")?;

    let updated_content = scanner::inject_module_import(&target_content, &module_ref)
        .map_err(|e| anyhow::anyhow!("Failed to inject module import: {}", e))?;

    std::fs::write(&target_path, &updated_content)
        .context("Failed to write updated module file")?;
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
