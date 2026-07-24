//! `list_files` tool: glob the config directory (gitignore-aware).

use crate::evolve::file_ops::{ensure_path_under_base, join_in_dir};
use crate::evolve::messages::Tool;
use crate::evolve::nixmac_ignore::NixmacIgnoreChecker;
use anyhow::{Result, anyhow};
use log::{debug, info};

use super::{ToolCtx, ToolResult};

pub(crate) fn definition() -> Tool {
    Tool {
        name: "list_files".to_string(),
        description:
            "List files in the config directory. Use glob patterns to find specific file types."
                .to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Glob pattern (default: **/*)"
                }
            }
        }),
    }
}

/// The glob crate's `**` component matches *directories* (zero or more), not
/// files, so a pattern ending in `**` — including the bare `**` models like
/// to send — matches nothing once directories are filtered out. Treat a
/// trailing `**` as `**/*`, which is what the caller invariably means.
fn normalize_trailing_recursive_glob(pattern: &str) -> String {
    if pattern == "**" || pattern.ends_with("/**") {
        format!("{}/*", pattern)
    } else {
        pattern.to_string()
    }
}

pub(crate) fn execute(ctx: &ToolCtx) -> Result<ToolResult> {
    let repo_root = ctx.repo_root;
    let pattern = ctx.args["pattern"].as_str().unwrap_or("**/*");
    let pattern = &normalize_trailing_recursive_glob(pattern);
    // Validate and normalize the provided glob pattern so it cannot
    // escape `base` (reject absolute/prefix components) and so any
    // `..`/`.` components are resolved before we run the glob.
    let full_pattern = join_in_dir(repo_root, pattern)?;
    info!("Listing files matching: {}", full_pattern.display());

    let visible = ctx
        .gitignore_matcher
        .map(|checker| checker.visible_files())
        .transpose()?;
    let nixmac_ignore = NixmacIgnoreChecker::new(repo_root)?;

    let matched_files = glob::glob(full_pattern.to_str().unwrap())
        .map_err(|e| anyhow!("Invalid glob pattern: {}", e))?
        .filter_map(|p| p.ok())
        .filter(|p| p.is_file())
        .collect::<Vec<_>>();

    let mut files: Vec<String> = Vec::new();
    let mut escaped_matches: Vec<String> = Vec::new();

    for p in matched_files {
        if ensure_path_under_base(repo_root, &p).is_err() {
            escaped_matches.push(p.display().to_string());
            continue;
        }

        // Strip the normalized `base` so results are returned
        // relative to the same directory we validated above.
        let Some(rel) = p.strip_prefix(repo_root).ok() else {
            continue;
        };

        if nixmac_ignore
            .as_ref()
            .is_some_and(|checker| checker.is_ignored(rel, false))
        {
            continue;
        }

        if let Some(visible) = &visible
            && !visible.contains_file(rel)
        {
            continue;
        }

        files.push(rel.to_string_lossy().to_string());
    }

    if !escaped_matches.is_empty() {
        let _sample = escaped_matches
            .iter()
            .take(3)
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");

        // Don't return the sample as part of the error return since it contains local paths outside git repository.
        return Err(anyhow!(
            "list_files matched one or more files outside git repository after symlink resolution. pattern='{}' git repository='{}'. Fix: narrow the pattern to files under git repository and avoid symlink targets outside git repository.",
            pattern,
            repo_root.display(),
        ));
    }

    debug!("Found {} files", files.len());
    Ok(ToolResult::Continue(files.join("\n")))
}

#[cfg(test)]
mod tests {
    use super::normalize_trailing_recursive_glob;

    #[test]
    fn trailing_recursive_glob_is_extended_to_match_files() {
        assert_eq!(normalize_trailing_recursive_glob("**"), "**/*");
        assert_eq!(
            normalize_trailing_recursive_glob("modules/**"),
            "modules/**/*"
        );
    }

    #[test]
    fn other_patterns_pass_through_unchanged() {
        assert_eq!(normalize_trailing_recursive_glob("**/*.nix"), "**/*.nix");
        assert_eq!(normalize_trailing_recursive_glob("*.nix"), "*.nix");
        assert_eq!(
            normalize_trailing_recursive_glob("**/flake.nix"),
            "**/flake.nix"
        );
    }

    // Prove the premise this fix rests on: the glob crate's `**` component
    // matches directories only, so without normalization a bare `**` finds
    // zero files in a populated tree.
    #[test]
    fn glob_trailing_recursive_component_needs_the_normalization() {
        let temp = tempfile::tempdir().expect("create temp dir");
        std::fs::create_dir(temp.path().join("modules")).expect("create modules dir");
        std::fs::write(temp.path().join("flake.nix"), "{}").expect("write flake.nix");
        std::fs::write(temp.path().join("modules/home.nix"), "{}").expect("write home.nix");

        let count = |pat: &str| {
            glob::glob(temp.path().join(pat).to_str().expect("utf8 path"))
                .expect("valid glob")
                .filter_map(|p| p.ok())
                .filter(|p| p.is_file())
                .count()
        };
        assert_eq!(count("**"), 0, "premise: bare ** matches no files");
        assert_eq!(count(&normalize_trailing_recursive_glob("**")), 2);
    }
}
