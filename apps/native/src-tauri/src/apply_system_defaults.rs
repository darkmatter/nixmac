//! Applies detected macOS system defaults to the nix-darwin configuration.

use anyhow::{bail, Context, Result};
use tauri::AppHandle;

use crate::{git, nix, shared_types, scanner, store};

/// Writes detected system defaults to a .nix module file, injects the import
/// into flake.nix, creates a git branch, commits, and caches a summary.
pub async fn apply_system_defaults(
    app: &AppHandle,
    defaults: Vec<scanner::SystemDefault>,
) -> Result<serde_json::Value> {
    let dir = store::ensure_config_dir_exists(app).context("Failed to get config directory")?;

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

    // 4. Inject import into the file that contains `modules = [`.
    //    - nix-darwin-determinate template: `flake.nix` with `./modules/darwin/...`
    //    - flake-parts template: `flake-modules/darwin.nix` with `../modules/darwin/...`
    let flake_path = std::path::Path::new(&dir).join("flake.nix");
    let flake_content = std::fs::read_to_string(&flake_path).context("Failed to read flake.nix")?;

    let (target_path, module_ref) = if flake_content.contains("modules = [") {
        // Direct template — modules list is in flake.nix
        log::info!("[apply_system_defaults] Found modules list in flake.nix");
        (
            flake_path,
            "./modules/darwin/system-defaults.nix".to_string(),
        )
    } else {
        // Flake-parts template — modules list is in flake-modules/darwin.nix
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
            bail!("Could not find 'modules = [' in flake.nix or flake-modules/darwin.nix");
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

    // 5. Create git branch and commit
    let branch = git::checkout_new_branch(&dir, "nixmac-scan/system-defaults")
        .context("Failed to create branch")?;
    log::info!("[apply_system_defaults] Created branch: {}", branch);

    // Stage and commit — check if there's actually something to commit
    let status_output = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&dir)
        .env("PATH", nix::get_nix_path())
        .output()
        .context("git status --porcelain failed")?;

    let porcelain = String::from_utf8_lossy(&status_output.stdout);
    let has_changes = !porcelain.trim().is_empty();

    if has_changes {
        git::commit_all(&dir, "feat: add detected macOS system defaults")
            .context("Failed to commit")?;
        log::info!("[apply_system_defaults] Committed system defaults");
    } else {
        log::warn!("[apply_system_defaults] No new changes to commit (porcelain was empty)");
    }

    // 6. Build a SemanticChangeMap from the deterministic summary so the frontend
    //    changeMap store field gets populated after applying defaults.
    let summary = scanner::build_summary(&defaults);
    let change_map = shared_types::SemanticChangeMap {
        groups: vec![],
        singles: summary
            .into_iter()
            .enumerate()
            .map(|(i, (title, description))| shared_types::ChangeWithSummary {
                id: i as i64,
                hash: title.replace(' ', "-").to_lowercase(),
                filename: String::new(),
                diff: String::new(),
                line_count: 0,
                created_at: 0,
                own_summary_id: None,
                title,
                description,
            })
            .collect(),
        missed_hashes: vec![],
    };

    // Get the current git status and cache it in the store so the watcher
    // won't fire a spurious change event on its next poll.
    let git_status = git::status(&dir).context("Failed to get git status")?;
    if let Err(e) = store::set_cached_git_status(app, &git_status) {
        log::error!("[apply_system_defaults] Failed to cache git status: {}", e);
    }

    log::info!(
        "[apply_system_defaults] Complete — {} defaults applied",
        defaults.len()
    );

    // Return changeMap + git status directly so the frontend can set them
    // atomically, avoiding race conditions with the watcher.
    Ok(serde_json::json!({
        "ok": true,
        "count": defaults.len(),
        "changeMap": change_map,
        "gitStatus": git_status,
    }))
}
