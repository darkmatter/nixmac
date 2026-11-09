//! `list_files` tool: glob the config directory (gitignore-aware).

use anyhow::{Result, anyhow};
use log::{debug, info};
use pi_walker::{CompiledWalkGlob, FollowLinks, WalkFilter, WalkRequest};
use std::path::Path;

use crate::evolve::file_ops::{ensure_path_under_base, join_in_dir};
use crate::evolve::messages::Tool;

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

/// Trailing `**` alone matches directories, not files, in walk-relative globs
/// (same as the old `glob` crate). Treat a trailing `**` as `**/*`.
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
    let pattern = normalize_trailing_recursive_glob(pattern);
    // Validate the pattern cannot escape `base` (reject absolute / `..`).
    // The walker matches against repo-relative paths, so keep `pattern` as the
    // filter input — `join_in_dir` is validation only.
    let _validated = join_in_dir(repo_root, &pattern)?;
    info!(
        "Listing files matching: {} under {}",
        pattern,
        repo_root.display()
    );

    let visible = ctx
        .gitignore_matcher
        .map(|checker| checker.visible_files())
        .transpose()?;

    let glob =
        CompiledWalkGlob::new([&pattern]).map_err(|e| anyhow!("Invalid glob pattern: {}", e))?;
    let filter = WalkFilter::files_only().glob(glob);

    let matched = WalkRequest::new(repo_root)
        .skip_git(true)
        .skip_node_modules(true)
        .gitignore(false) // nixmac VisibleFiles owns ignore policy
        .follow_links(FollowLinks::Never)
        .cache(true)
        .filter(filter)
        .collect_files()
        .map_err(|e| anyhow!("list_files walk failed: {e}"))?;

    let mut files: Vec<String> = Vec::new();
    let mut escaped_matches: Vec<String> = Vec::new();

    for entry in matched {
        let abs = entry.absolute_path(repo_root);
        if ensure_path_under_base(repo_root, &abs).is_err() {
            escaped_matches.push(abs.display().to_string());
            continue;
        }

        let rel = Path::new(&entry.path);
        if ctx.nixmac_ignore_matcher.is_ignored(rel, false) {
            continue;
        }

        if let Some(visible) = &visible
            && !visible.contains_file(rel)
        {
            continue;
        }

        files.push(entry.path);
    }

    if !escaped_matches.is_empty() {
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
    use super::{ToolResult, execute};
    use crate::evolve::gitignore::GitignoreChecker;
    use crate::evolve::nixmac_ignore::NixmacIgnoreChecker;
    use crate::evolve::tools::ToolCtx;
    use serde_json::json;
    use std::fs;
    use tempfile::tempdir;

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

    #[test]
    fn walker_lists_files_and_skips_gitignored() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::create_dir(tmp.path().join("modules")).expect("create modules");
        fs::write(tmp.path().join("flake.nix"), "{}").expect("write flake");
        fs::write(tmp.path().join("modules/home.nix"), "{}").expect("write home");
        fs::write(tmp.path().join(".gitignore"), "secret.txt\n").expect("gitignore");
        fs::write(tmp.path().join("secret.txt"), "x").expect("secret");
        let gitignore = GitignoreChecker::new(tmp.path()).expect("matcher");
        let nixmac_ignore = NixmacIgnoreChecker::new(tmp.path()).expect("nixmac matcher");

        let ctx = ToolCtx {
            repo_root: tmp.path(),
            config_dir: tmp.path().to_str().expect("utf-8"),
            host_attr: "dummy-host",
            args: &json!({ "pattern": "**" }),
            gitignore_matcher: gitignore.as_ref(),
            nixmac_ignore_matcher: &nixmac_ignore,
            auto_format: false,
            on_build_output: None,
        };
        let ToolResult::Continue(out) = execute(&ctx).expect("list_files") else {
            panic!("expected Continue");
        };
        assert!(out.contains("flake.nix"), "output: {out}");
        assert!(out.contains("modules/home.nix"), "output: {out}");
        assert!(!out.contains("secret.txt"), "output: {out}");
    }

    #[test]
    fn walker_applies_nixmacignore_rules() {
        let tmp = tempdir().expect("tempdir");
        fs::create_dir(tmp.path().join("private")).expect("create private directory");
        fs::write(
            tmp.path().join(".nixmacignore"),
            "private/\n*.secret\n!important.secret\n",
        )
        .expect("write .nixmacignore");
        fs::write(tmp.path().join("visible.txt"), "visible").expect("write visible file");
        fs::write(tmp.path().join("private/hidden.txt"), "hidden").expect("write ignored file");
        fs::write(tmp.path().join("hidden.secret"), "hidden").expect("write ignored secret");
        fs::write(tmp.path().join("important.secret"), "visible").expect("write negated secret");
        let nixmac_ignore = NixmacIgnoreChecker::new(tmp.path()).expect("nixmac matcher");

        let ctx = ToolCtx {
            repo_root: tmp.path(),
            config_dir: tmp.path().to_str().expect("utf-8"),
            host_attr: "dummy-host",
            args: &json!({ "pattern": "**" }),
            gitignore_matcher: None,
            nixmac_ignore_matcher: &nixmac_ignore,
            auto_format: false,
            on_build_output: None,
        };
        let ToolResult::Continue(out) = execute(&ctx).expect("list_files") else {
            panic!("expected Continue");
        };

        assert!(out.contains("visible.txt"), "output: {out}");
        assert!(out.contains("important.secret"), "output: {out}");
        assert!(!out.contains("private/hidden.txt"), "output: {out}");
        assert!(!out.contains("hidden.secret"), "output: {out}");
        assert!(!out.contains(".nixmacignore"), "output: {out}");
    }
}
