//! Reusable managed review helpers for non-AI edits.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::state::{build_state, evolve_state};
use crate::storage::store;
use crate::{db, git, shared_types, summarize};

pub struct ManagedEditContext {
    pub dir: String,
    pub evolution_id: i64,
    pub evolve_state: shared_types::EvolveState,
}

pub fn prepare_managed_edit(app: &AppHandle) -> Result<ManagedEditContext> {
    let dir = store::ensure_config_dir_exists(app).context("Failed to get config directory")?;
    let pre_edit_status =
        git::status(&dir).context("Failed to get pre-edit working tree status")?;

    let pool = app.state::<db::DbPool>();
    let _base_commit_id =
        db::commits::store_head_commit(&pool, &dir, None).context("Failed to store HEAD commit")?;

    let pre_state = evolve_state::get(app).unwrap_or_default();
    let branch = git::current_branch(&dir).unwrap_or_else(|| "main".to_string());
    let evolution_id = db::evolutions::upsert(&pool, pre_state.evolution_id, &branch)
        .context("Failed to upsert evolution")?;

    let changeset_id = pre_state.current_changeset_id.unwrap_or(0);
    let backup_branch = git::create_evolution_backup(&dir, Some(evolution_id), changeset_id)
        .context("Failed to create backup branch")?;

    let rollback_branch = pre_state
        .rollback_branch
        .clone()
        .or_else(|| backup_branch.clone());
    let (rollback_store_path, rollback_changeset_id) = if pre_state.rollback_store_path.is_some() {
        (
            pre_state.rollback_store_path.clone(),
            pre_state.rollback_changeset_id,
        )
    } else {
        let build = build_state::get(app).ok();
        (
            build
                .as_ref()
                .and_then(|state| state.nixmac_built_store_path.clone()),
            build.as_ref().and_then(|state| state.changeset_id),
        )
    };

    let evolve_state = evolve_state::set(
        app,
        shared_types::EvolveState {
            evolution_id: Some(evolution_id),
            current_changeset_id: None,
            committable: false,
            backup_branch,
            rollback_branch,
            rollback_store_path,
            rollback_changeset_id,
            step: shared_types::EvolveStep::Evolve,
            last_evolution_state: None,
        },
        &pre_edit_status.changes,
    )
    .context("Failed to set evolve state")?;

    Ok(ManagedEditContext {
        dir,
        evolution_id,
        evolve_state,
    })
}

pub async fn finalize_managed_edit(
    app: &AppHandle,
    mut context: ManagedEditContext,
    post_edit_status: shared_types::GitStatus,
    count: usize,
    log_tag: &str,
) -> Result<shared_types::ConfigEditApplyResult> {
    context.evolve_state = evolve_state::set(app, context.evolve_state, &post_edit_status.changes)
        .context("Failed to update evolve state for post-edit status")?;

    match summarize::new_changeset(app, Some(context.evolution_id)).await {
        Ok(Some(changeset_id)) => {
            context.evolve_state.current_changeset_id = Some(changeset_id);
            context.evolve_state =
                evolve_state::set(app, context.evolve_state, &post_edit_status.changes)
                    .context("Failed to update evolve state with changeset")?;
        }
        Ok(None) => {
            log::warn!("[{log_tag}] Summarizer returned None - diff may be empty");
        }
        Err(error) => {
            log::error!("[{log_tag}] Summarizer error: {}", error);
        }
    }

    let pool = app.state::<db::DbPool>();
    let change_sets =
        summarize::find_existing::for_current_state(&pool, &context.dir).unwrap_or_default();

    let change_map = summarize::group_existing::from_change_sets(change_sets);
    let git_status =
        git::query::status_and_cache(&context.dir, app).context("Failed to get git status")?;

    Ok(shared_types::ConfigEditApplyResult {
        ok: true,
        count,
        change_map,
        git_status,
        evolve_state: context.evolve_state,
    })
}

/// Inject a Darwin module import into the config's nix-darwin module list.
///
/// Supports the two layouts created by nixmac templates:
/// - `flake.nix` imports `./modules/darwin/<module_filename>`
/// - `flake-modules/darwin.nix` imports `../modules/darwin/<module_filename>`
///
/// Returns the file that was updated.
pub fn inject_darwin_module_import(
    config_dir: impl AsRef<Path>,
    module_filename: &str,
    log_tag: &str,
) -> Result<PathBuf> {
    let config_dir = config_dir.as_ref();
    let flake_path = config_dir.join("flake.nix");
    let flake_content = std::fs::read_to_string(&flake_path).context("Failed to read flake.nix")?;

    if has_modules_list_literal(&flake_content) {
        log::debug!("[{log_tag}] Found modules list in flake.nix");
        inject_module_import_into_file(
            &flake_path,
            &format!("./modules/darwin/{module_filename}"),
        )?;
        return Ok(flake_path);
    }

    let darwin_mod = config_dir.join("flake-modules").join("darwin.nix");
    if darwin_mod.exists() {
        log::debug!("[{log_tag}] Found modules list in flake-modules/darwin.nix");
        inject_module_import_into_file(
            &darwin_mod,
            &format!("../modules/darwin/{module_filename}"),
        )?;
        return Ok(darwin_mod);
    }

    anyhow::bail!("Could not find modules list in flake.nix or flake-modules/darwin.nix");
}

fn inject_module_import_into_file(target_path: &Path, module_ref: &str) -> Result<()> {
    let target_content =
        std::fs::read_to_string(target_path).context("Failed to read target module file")?;
    let updated_content = inject_module_import(&target_content, module_ref)
        .map_err(|e| anyhow::anyhow!("Failed to inject module import: {}", e))?;

    std::fs::write(target_path, &updated_content).context("Failed to write updated module file")?;

    Ok(())
}

/// Inject a module import into an existing `flake.nix` file.
///
/// Locates the `modules` list assignment (tolerating any whitespace around `=`,
/// including newlines, e.g. `modules=[`, `modules = [`, `modules\n=\n[`) and
/// adds the new module path before the closing `]`.  Returns an error when no
/// `modules` assignment is found or its value is not a list literal (e.g.
/// `modules = myVar`).
pub fn inject_module_import(content: &str, module_path: &str) -> Result<String, String> {
    // Already imported — return unchanged
    if content.contains(module_path) {
        return Ok(content.to_string());
    }

    let (open_bracket, close) = find_modules_list_bounds(content)?;

    // Determine indentation by looking for a top-level entry in the modules list.
    // Scan lines between the opening `[` and closing `]` for a recognisable entry.
    let block = &content[open_bracket + 1..close];
    let indent = block
        .lines()
        .find(|line| {
            let t = line.trim();
            t.starts_with("./")
                || t.starts_with("../")
                || t.starts_with("inputs.")
                || t.starts_with("configuration")
        })
        .map(|line| {
            line.chars()
                .take_while(|c| c.is_whitespace())
                .collect::<String>()
        })
        .unwrap_or_else(|| "          ".to_string());

    // Insert the new module path on a new line just before the closing `]`.
    let new_import = format!("{}{}\n", indent, module_path);

    let mut result = String::with_capacity(content.len() + new_import.len());
    result.push_str(&content[..close]);
    // Ensure there's a newline before our import
    if !result.ends_with('\n') {
        result.push('\n');
    }
    result.push_str(&new_import);
    result.push_str(&content[close..]);

    Ok(result)
}

fn has_modules_list_literal(content: &str) -> bool {
    find_modules_list_bounds(content).is_ok()
}

fn find_modules_list_bounds(content: &str) -> Result<(usize, usize), String> {
    use once_cell::sync::Lazy;
    use regex::Regex;

    // Match `modules` with any whitespace (including newlines) around `=`.
    static MODULES_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"\bmodules\s*=\s*").expect("valid regex"));

    let Some(m) = MODULES_RE.find(content) else {
        return Err("Could not find 'modules' assignment".to_string());
    };

    // The value must be a list literal; a bare identifier (e.g. `modules = myVar`)
    // cannot be modified in place.
    let open_bracket = m.end();
    if !content[open_bracket..].starts_with('[') {
        return Err(
            "modules value is not a list literal — cannot inject import automatically".to_string(),
        );
    }

    // Walk forward tracking bracket depth to find the matching `]`.
    // This correctly skips nested lists like `extra-experimental-features = [ ... ];`
    let mut depth: i32 = 0;
    let mut close_bracket: Option<usize> = None;
    for (i, ch) in content[open_bracket..].char_indices() {
        match ch {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    close_bracket = Some(open_bracket + i);
                    break;
                }
            }
            _ => {}
        }
    }

    let close = close_bracket.ok_or("Unmatched modules list — no closing ']' found")?;

    Ok((open_bracket, close))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inject_module_import() {
        let flake = r#"
      darwinConfigurations."test" = nix-darwin.lib.darwinSystem {
        modules = [
          configuration
          ./modules/darwin/fonts.nix
          ./modules/darwin/homebrew.nix
        ];
      };
"#;
        let result = inject_module_import(flake, "./modules/darwin/system-defaults.nix").unwrap();
        assert!(result.contains("./modules/darwin/system-defaults.nix"));
        assert!(result.contains("./modules/darwin/homebrew.nix"));
    }

    #[test]
    fn test_inject_module_flake_parts() {
        // Flake-parts template: modules = [ ... ] contains nested { } and [ ] blocks
        let darwin_nix = r#"
{ inputs, self, ... }:
{
  flake = {
    darwinConfigurations = {
      "Test" = inputs.darwin.lib.darwinSystem {
        modules = [
          inputs.determinate.darwinModules.default
          inputs.home-manager.darwinModules.home-manager
          {
            system.stateVersion = 6;
            determinate-nix.customSettings = {
              extra-experimental-features = [
                "build-time-fetch-tree"
                "parallel-eval"
              ];
            };
          }
        ];
      };
    };
  };
}
"#;
        let result =
            inject_module_import(darwin_nix, "../modules/darwin/system-defaults.nix").unwrap();
        assert!(
            result.contains("../modules/darwin/system-defaults.nix"),
            "Import not found in result:\n{}",
            result
        );
        // Verify the import is inside the modules list (before the closing ])
        let modules_start = result.find("modules = [").unwrap();
        let import_pos = result
            .find("../modules/darwin/system-defaults.nix")
            .unwrap();
        assert!(
            import_pos > modules_start,
            "Import should be after modules = ["
        );
    }

    #[test]
    fn test_inject_module_compact_syntax() {
        // `modules=[` with no spaces around `=`
        let flake = "darwinConfigurations.test = nix-darwin.lib.darwinSystem { modules=[\n  ./fonts.nix\n]; };";
        let result = inject_module_import(flake, "./system-defaults.nix").unwrap();
        assert!(result.contains("./system-defaults.nix"));
        assert!(result.contains("./fonts.nix"));
    }

    #[test]
    fn test_inject_module_newlines_around_equals() {
        // `modules \n= \n[` — newlines between the keyword, `=`, and `[`
        let flake = "darwinConfigurations.test = nix-darwin.lib.darwinSystem {\n  modules\n  =\n  [\n    ./fonts.nix\n  ];\n};";
        let result = inject_module_import(flake, "./system-defaults.nix").unwrap();
        assert!(result.contains("./system-defaults.nix"));
    }

    #[test]
    fn test_inject_module_variable_value_errors() {
        // `modules = someVariable` — cannot inject into a non-list value
        let flake =
            "darwinConfigurations.test = nix-darwin.lib.darwinSystem { modules = myModules; };";
        let err = inject_module_import(flake, "./system-defaults.nix").unwrap_err();
        assert!(
            err.contains("not a list literal"),
            "Expected 'not a list literal' error, got: {err}"
        );
    }

    #[test]
    fn test_inject_module_already_present() {
        let flake = r#"
        modules = [
          ./modules/darwin/system-defaults.nix
        ];
"#;
        let result = inject_module_import(flake, "./modules/darwin/system-defaults.nix").unwrap();
        // Should not duplicate
        assert_eq!(result.matches("system-defaults.nix").count(), 1);
    }

    #[test]
    fn test_inject_darwin_module_import_prefers_flake() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let flake_path = temp.path().join("flake.nix");
        std::fs::write(
            &flake_path,
            "darwinConfigurations.test = nix-darwin.lib.darwinSystem { modules=[\n  ./configuration.nix\n]; };",
        )
        .expect("flake should be written");

        let target =
            inject_darwin_module_import(temp.path(), "services.nix", "test").expect("injects");
        let updated = std::fs::read_to_string(&flake_path).expect("flake should be readable");

        assert_eq!(target, flake_path);
        assert!(updated.contains("./modules/darwin/services.nix"));
    }

    #[test]
    fn test_inject_darwin_module_import_uses_flake_modules() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        std::fs::write(
            temp.path().join("flake.nix"),
            "darwinConfigurations.test = nix-darwin.lib.darwinSystem { modules = myModules; };",
        )
        .expect("flake should be written");
        let flake_modules_dir = temp.path().join("flake-modules");
        std::fs::create_dir_all(&flake_modules_dir).expect("flake-modules should be created");
        let darwin_path = flake_modules_dir.join("darwin.nix");
        std::fs::write(
            &darwin_path,
            "darwinConfigurations.test = nix-darwin.lib.darwinSystem {\n  modules = [\n    inputs.home-manager.darwinModules.home-manager\n  ];\n};",
        )
        .expect("darwin module should be written");

        let target = inject_darwin_module_import(temp.path(), "system-defaults.nix", "test")
            .expect("injects");
        let updated =
            std::fs::read_to_string(&darwin_path).expect("darwin module should be readable");

        assert_eq!(target, darwin_path);
        assert!(updated.contains("../modules/darwin/system-defaults.nix"));
    }
}
