//! Applies detected macOS system defaults to the nix-darwin configuration.

use anyhow::{Context, Result};
use tauri::AppHandle;

use crate::{db, evolve_state, git, scanner, shared_types, store, summarize};

/// Writes detected system defaults to a .nix module file, injects the import
/// into flake.nix, creates an evolution + summarization pipeline so the
/// frontend lands on the evolve step with a populated changeMap.
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

    // 5. Wire into the evolve pipeline — leave changes in the working tree so
    //    the summarizer can read the diff, then set EvolveState so the frontend
    //    transitions to the evolve step.
    let db_path = db::get_db_path(app).context("Failed to get DB path")?;

    // Store the current HEAD commit so the changeset has a base.
    let _base_commit_id =
        db::commits::store_head_commit(&db_path, &dir, None).context("Failed to store HEAD commit")?;

    // Reuse an existing evolution if one is already active.
    let existing_evo_id = evolve_state::get(app).ok().and_then(|s| s.evolution_id);
    let branch = git::current_branch(&dir).unwrap_or_else(|| "main".to_string());
    let evolution_id = db::evolutions::upsert(&db_path, existing_evo_id, &branch)
        .context("Failed to upsert evolution")?;
    log::info!("[apply_system_defaults] Using evolution_id={}", evolution_id);

    // Persist the evolve state so the frontend can start rendering the evolve step.
    let initial_state = shared_types::EvolveState {
        evolution_id: Some(evolution_id),
        current_changeset_id: None,
        changeset_at_build: None,
        committable: false,
        backup_branch: None,
        rollback_branch: None,
        rollback_store_path: None,
        rollback_changeset_id: None,
        manual_rollback_store_path: None,
        step: shared_types::EvolveStep::Evolve,
    };
    let working_tree_status =
        git::status(&dir).context("Failed to get working tree status for evolve state")?;
    let mut evolve_state = evolve_state::set(app, initial_state, &working_tree_status.changes)
        .context("Failed to set evolve state")?;

    // Run the summarization pipeline against the working tree diff.
    // `new_changeset` reads `git::status().diff` which includes untracked files,
    // so system-defaults.nix and the modified import file are both captured.
    match summarize::new_changeset(app, Some(evolution_id)).await {
        Ok(Some(changeset_id)) => {
            log::info!(
                "[apply_system_defaults] Changeset created: id={}",
                changeset_id
            );
            evolve_state.current_changeset_id = Some(changeset_id);
            evolve_state =
                evolve_state::set(app, evolve_state, &working_tree_status.changes)
                    .context("Failed to update evolve state with changeset")?;
        }
        Ok(None) => {
            log::warn!("[apply_system_defaults] Summarizer returned None — diff may be empty");
        }
        Err(e) => {
            log::error!("[apply_system_defaults] Summarizer error: {}", e);
            // Non-fatal — evolve state is already set; summaries will be pending.
        }
    }

    // Build the change map from whatever the DB has right now (may include
    // queued/pending summaries that the background processor will fill in).
    let change_sets = summarize::find_existing::for_current_state(&db_path, &dir)
        .unwrap_or_default();
    let change_map = summarize::group_existing::from_change_sets(change_sets);

    // Get current git status and cache it so the watcher doesn't fire spuriously.
    let git_status = git::status_and_cache(&dir, app).context("Failed to get git status")?;

    log::info!(
        "[apply_system_defaults] Complete — {} defaults applied, evolution_id={}",
        defaults.len(),
        evolution_id
    );

    Ok(serde_json::json!({
        "ok": true,
        "count": defaults.len(),
        "changeMap": change_map,
        "gitStatus": git_status,
        "evolveState": evolve_state,
    }))
}
