//! Evolution module for AI-assisted configuration changes.
//!
//! An evolution represents a proposed configuration change (e.g., installing an app,
//! customizing settings). Each evolution is backed by git commits for traceability.
//!
//! Uses OpenAI function calling to generate structured file edits.

use std::path::{Component, Path, PathBuf};

use anyhow::Context;

const PATH_SCOPE_ERROR_CODE: &str = "E_PATH_OUTSIDE_CONFIG_DIR";

/// Join a relative path into `base`, rejecting absolute paths and any path
/// that would escape `base` using `..` components.
pub(crate) fn join_in_dir(base: &Path, rel: &str) -> anyhow::Result<PathBuf> {
    let rel_path = Path::new(rel);

    if rel_path.is_absolute() {
        return Err(anyhow::anyhow!("Absolute paths are not allowed"));
    }

    // Build a normalized relative path while validating components. This
    // prevents inputs like `a/../b` from leaving `..` components present
    // and avoids creating unnecessary intermediate directories.
    // In other words, base="base" and rel="a/../b" will yield "base/b", not "base/a/../b".
    let mut normalized = PathBuf::new();
    for comp in rel_path.components() {
        match comp {
            Component::Normal(s) => normalized.push(s),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(anyhow::anyhow!("Path escapes the config directory"));
                }
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(anyhow::anyhow!(
                    "Path prefixes or root components are not allowed in relative paths"
                ));
            }
        }
    }

    Ok(base.join(normalized))
}

/// Canonicalize and validate a path exists under `base`.
pub(crate) fn resolve_existing_path_in_dir(base: &Path, rel: &str) -> anyhow::Result<PathBuf> {
    let full_path = join_in_dir(base, rel)?;
    let base_canonical = canonicalize_base_dir(base)?;
    let full_path_canonical = canonicalize_with_error_path(&full_path, rel)?;
    validate_under_base(
        rel,
        "read/edit existing file",
        &base_canonical,
        &full_path_canonical,
    )?;

    Ok(full_path_canonical)
}

/// Validate a path is under `base`, allowing the final path segment to not exist yet.
pub(crate) fn resolve_path_in_dir_allow_create(base: &Path, rel: &str) -> anyhow::Result<PathBuf> {
    let full_path = join_in_dir(base, rel)?;
    let base_canonical = canonicalize_base_dir(base)?;

    let mut existing_ancestor = full_path.as_path();
    while !existing_ancestor.exists() {
        existing_ancestor = existing_ancestor
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Path has no ancestor under config_dir"))?;
    }

    let ancestor_canonical = existing_ancestor
        .canonicalize()
        .map_err(|e| anyhow::anyhow!("Failed to resolve ancestor for {}: {}", rel, e))?;
    validate_under_base(
        rel,
        "create or edit file",
        &base_canonical,
        &ancestor_canonical,
    )?;

    let suffix = full_path
        .strip_prefix(existing_ancestor)
        .map_err(|_| anyhow::anyhow!("Failed to compute relative path for {}", rel))?;
    let resolved_path = ancestor_canonical.join(suffix);
    Ok(resolved_path)
}

/// Validate an already discovered filesystem path is under `base`.
pub(crate) fn ensure_path_under_base(base: &Path, path: &Path) -> anyhow::Result<()> {
    let base_canonical = canonicalize_base_dir(base)?;
    let error_path = path.display().to_string();
    let path_canonical = canonicalize_with_error_path(path, &error_path)?;
    validate_under_base(&error_path, "list files", &base_canonical, &path_canonical)
}

/// Resolve an existing file under `base`, then rewrite it using `edit`,
/// which is one of the "editing" tools (`edit_file`, `edit_nix_file`, etc).
/// formulated as a function. This is used for all operations that need to
/// read-modify-write an existing file, so that we can centralize the logic
/// for securely resolving the file path and providing good error messages when things go wrong.
pub(crate) fn rewrite_existing_file_in_dir<F>(
    base: &Path,
    rel: &str,
    operation: &str,
    edit: F,
) -> anyhow::Result<()>
where
    F: FnOnce(&str) -> anyhow::Result<String>,
{
    let full_path = resolve_existing_path_in_dir(base, rel)?;
    let fail = |kind: &str| format!("Failed to {} {} for {}", kind, rel, operation);

    let content = std::fs::read_to_string(&full_path).with_context(|| fail("read"))?;
    let new_content = edit(&content).with_context(|| fail("edit"))?;
    std::fs::write(&full_path, new_content).with_context(|| fail("write"))?;

    Ok(())
}

// We need a lot of extra complexity to handle symlinks and other filesystem weirdness robustly, but the core logic is just to check that the canonicalized path starts with the canonicalized base directory. The rest is about making sure we can get to that check without false positives or false negatives, and providing good error messages when things go wrong.
fn canonicalize_base_dir(base: &Path) -> anyhow::Result<PathBuf> {
    let base_canonical = base
        .canonicalize()
        .map_err(|e| anyhow::anyhow!("Failed to resolve config_dir {}: {}", base.display(), e))?;

    if !base_canonical.is_dir() {
        return Err(anyhow::anyhow!(
            "config_dir is not a directory: {}",
            base_canonical.display()
        ));
    }

    Ok(base_canonical)
}

/// Returns an error when `candidate_canonical` is not inside `base_canonical`.
fn ensure_under_base(base_canonical: &Path, candidate_canonical: &Path) -> anyhow::Result<()> {
    if !candidate_canonical.starts_with(base_canonical) {
        return Err(anyhow::anyhow!(
            "resolved path {} escapes config_dir {}",
            candidate_canonical.display(),
            base_canonical.display()
        ));
    }

    Ok(())
}

/// Canonicalize a path and keep the caller's error-context path in any error message.
fn canonicalize_with_error_path(path: &Path, error_path: &str) -> anyhow::Result<PathBuf> {
    path.canonicalize()
        .map_err(|e| anyhow::anyhow!("Failed to resolve path {}: {}", error_path, e))
}

/// Convert scope-check failures into a stable, corrective error for the agent.
fn validate_under_base(
    input: &str,
    operation: &str,
    base_canonical: &Path,
    candidate_canonical: &Path,
) -> anyhow::Result<()> {
    ensure_under_base(base_canonical, candidate_canonical)
        .map_err(|_| path_scope_error(input, base_canonical, candidate_canonical, operation))
}

/// Builds a consistent out-of-scope error with enough context for self-correction.
fn path_scope_error(input: &str, base: &Path, resolved: &Path, operation: &str) -> anyhow::Error {
    anyhow::anyhow!(
        "{}: {} is not allowed because the resolved path is outside config_dir. input='{}' resolved='{}' config_dir='{}'. Fix: use a relative path under config_dir, or choose a symlink target that resolves inside config_dir.",
        PATH_SCOPE_ERROR_CODE,
        operation,
        input,
        resolved.display(),
        base.display()
    )
}

/// Apply an evolution's edits to the filesystem.
///
pub fn apply_file_edits(base: &Path, edit: &super::types::FileEdit) -> anyhow::Result<()> {
    if edit.search.is_empty() {
        // New file — validate the (not-yet-existing) target is under base.
        let full_path = resolve_path_in_dir_allow_create(base, &edit.path)?;
        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&full_path, &edit.replace)?;
    } else {
        rewrite_existing_file_in_dir(base, &edit.path, "edit existing file", |content| {
            // Verify search string exists and is unique.
            let count = content.matches(&edit.search).count();
            if count == 0 {
                return Err(anyhow::anyhow!(
                    "Search string not found in {}: {:?}",
                    edit.path,
                    edit.search.chars().take(50).collect::<String>()
                ));
            }
            if count > 1 {
                return Err(anyhow::anyhow!(
                    "Search string found {} times in {} (must be unique)",
                    count,
                    edit.path
                ));
            }

            Ok(content.replace(&edit.search, &edit.replace))
        })?;
    }

    Ok(())
}
