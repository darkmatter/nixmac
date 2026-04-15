//! Evolution module for AI-assisted configuration changes.
//!
//! An evolution represents a proposed configuration change (e.g., installing an app,
//! customizing settings). Each evolution is backed by git commits for traceability.
//!
//! Uses OpenAI function calling to generate structured file edits.

use super::gitignore::{is_ignored_by_matcher, load_gitignore_matcher};
use super::utils::normalize_relative_path;
use ignore::gitignore::Gitignore;
use std::path::{Path, PathBuf};

use anyhow::Context;
use log::debug;

const PATH_SCOPE_ERROR_CODE: &str = "E_PATH_OUTSIDE_CONFIG_DIR";

/// Join a relative path into `base`, rejecting absolute paths and any path
/// that would escape `base` using `..` components.
pub(crate) fn join_in_dir(base: &Path, rel: &str) -> anyhow::Result<PathBuf> {
    let normalized = normalize_relative_path(Path::new(rel))?;
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
    // If the target already exists, suffix is empty. Returning
    // `ancestor_canonical.join("")` can produce a path that behaves like a
    // directory traversal target (trailing separator), which causes ENOTDIR
    // on file writes.
    let resolved_path = if suffix.as_os_str().is_empty() {
        ancestor_canonical
    } else {
        ancestor_canonical.join(suffix)
    };
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
    gitignore_matcher: Option<&Gitignore>,
    edit: F,
) -> anyhow::Result<()>
where
    F: FnOnce(&str) -> anyhow::Result<String>,
{
    reject_gitignored_edit_path(base, rel, operation, gitignore_matcher)?;
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

/// Validate basic syntax of a .nix file using a simple custom validator that checks for balanced braces, brackets
/// parens, and closed strings.
/// We can't use rnix because it is error-tolerant and will produce an AST
/// even for complete junk, which isn't helpful for our use case of validating AI-generated edits.
/// Instead, we check basic structural validity: balanced braces/brackets/parens, closed strings.
fn validate_nix_syntax(content: &str, file_path: &str) -> anyhow::Result<()> {
    // Simple validation: track bracket/brace/paren balance across the content,
    // respecting string contexts. This catches obvious errors like unmatched braces.

    let mut brace_depth = 0;
    let mut bracket_depth = 0;
    let mut paren_depth = 0;
    let mut in_string = false;
    let mut in_multiline_string = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    let mut escape_next = false;

    let chars: Vec<char> = content.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let ch = chars[i];

        if in_line_comment {
            if ch == '\n' {
                in_line_comment = false;
            }
            i += 1;
            continue;
        }

        if in_block_comment {
            if i + 1 < chars.len() && ch == '*' && chars[i + 1] == '/' {
                in_block_comment = false;
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }

        if escape_next {
            escape_next = false;
            i += 1;
            continue;
        }

        // Check for multiline strings: '' ... ''
        if !in_string && i + 1 < chars.len() && ch == '\'' && chars[i + 1] == '\'' {
            if in_multiline_string {
                // In an indented string, '' introduces either an escape sequence
                // (e.g. ''', ''$, ''\) or the closing delimiter.
                // Only treat it as closing when it is not an escape prefix.
                if i + 2 < chars.len()
                    && (chars[i + 2] == '\'' || chars[i + 2] == '$' || chars[i + 2] == '\\')
                {
                    i += 3;
                    continue;
                }
            }

            in_multiline_string = !in_multiline_string;
            i += 2;
            continue;
        }

        if in_multiline_string {
            i += 1;
            continue;
        }

        if !in_string {
            if ch == '#' {
                in_line_comment = true;
                i += 1;
                continue;
            }
            if i + 1 < chars.len() && ch == '/' && chars[i + 1] == '*' {
                in_block_comment = true;
                i += 2;
                continue;
            }
        }

        match ch {
            '\\' if in_string => escape_next = true,
            '"' => in_string = !in_string,
            '{' if !in_string => brace_depth += 1,
            '}' if !in_string => {
                brace_depth -= 1;
                if brace_depth < 0 {
                    return Err(anyhow::anyhow!(
                        "Syntax error in {}: unmatched closing brace '}}'",
                        file_path
                    ));
                }
            }
            '[' if !in_string => bracket_depth += 1,
            ']' if !in_string => {
                bracket_depth -= 1;
                if bracket_depth < 0 {
                    return Err(anyhow::anyhow!(
                        "Syntax error in {}: unmatched closing bracket ']'",
                        file_path
                    ));
                }
            }
            '(' if !in_string => paren_depth += 1,
            ')' if !in_string => {
                paren_depth -= 1;
                if paren_depth < 0 {
                    return Err(anyhow::anyhow!(
                        "Syntax error in {}: unmatched closing parenthesis ')'",
                        file_path
                    ));
                }
            }
            _ => {}
        }

        i += 1;
    }

    if in_string {
        return Err(anyhow::anyhow!(
            "Syntax error in {}: unclosed string literal",
            file_path
        ));
    }

    if in_multiline_string {
        return Err(anyhow::anyhow!(
            "Syntax error in {}: unclosed multiline string ''...''",
            file_path
        ));
    }

    if in_block_comment {
        return Err(anyhow::anyhow!(
            "Syntax error in {}: unclosed block comment /*...*/",
            file_path
        ));
    }

    if brace_depth != 0 {
        return Err(anyhow::anyhow!(
            "Syntax error in {}: {} unmatched opening brace(s)",
            file_path,
            brace_depth
        ));
    }

    if bracket_depth != 0 {
        return Err(anyhow::anyhow!(
            "Syntax error in {}: {} unmatched opening bracket(s)",
            file_path,
            bracket_depth
        ));
    }

    if paren_depth != 0 {
        return Err(anyhow::anyhow!(
            "Syntax error in {}: {} unmatched opening parenthesis/parentheses",
            file_path,
            paren_depth
        ));
    }

    Ok(())
}

/// Validate basic syntax of a .yaml or .yml file using serde_yaml.
fn validate_yaml_syntax(content: &str, file_path: &str) -> anyhow::Result<()> {
    // Try to parse the YAML content. yaml_serde will catch syntax errors
    // like unmatched quotes, braces, brackets, etc.
    yaml_serde::from_str::<yaml_serde::Value>(content)
        .map_err(|e| anyhow::anyhow!("Syntax error in {}: {}", file_path, e))?;

    Ok(())
}

/// Validate file content based on extension before writing.
fn validate_file_content(file_path: &str, content: &str) -> anyhow::Result<()> {
    if file_path.ends_with(".nix") {
        if let Err(e) = validate_nix_syntax(content, file_path) {
            debug!("Nix syntax validation failed for {}: {}", file_path, e);
            return Err(e);
        } else {
            debug!("Nix syntax validation succeeded for {}", file_path);
        }
    } else if file_path.ends_with(".yaml") || file_path.ends_with(".yml") {
        if let Err(e) = validate_yaml_syntax(content, file_path) {
            debug!("YAML syntax validation failed for {}: {}", file_path, e);
            return Err(e);
        } else {
            debug!("YAML syntax validation succeeded for {}", file_path);
        }
    }

    Ok(())
}

pub fn apply_file_edits(
    base: &Path,
    edit: &super::types::FileEdit,
    gitignore_matcher: Option<&Gitignore>,
) -> anyhow::Result<()> {
    reject_gitignored_edit_path(base, &edit.path, "apply file edit", gitignore_matcher)?;

    if edit.search.is_empty() {
        // Empty search means full-file replace. If the file already exists,
        // treat this as an existing-file rewrite (not a create path).
        let full_path = resolve_path_in_dir_allow_create(base, &edit.path)?;
        if full_path.exists() {
            if full_path.is_dir() {
                return Err(anyhow::anyhow!(
                    "Path is a directory, not a file: {}",
                    full_path.display()
                ));
            }
            validate_file_content(&edit.path, &edit.replace)?;
            std::fs::write(&full_path, &edit.replace)?;
            return Ok(());
        }

        if let Some(parent) = full_path.parent() {
            if parent.exists() && !parent.is_dir() {
                return Err(anyhow::anyhow!(
                    "Parent path is not a directory: {}",
                    parent.display()
                ));
            }
            std::fs::create_dir_all(parent)?;
        }
        validate_file_content(&edit.path, &edit.replace)?;
        std::fs::write(&full_path, &edit.replace)?;
    } else {
        rewrite_existing_file_in_dir(
            base,
            &edit.path,
            "edit existing file",
            gitignore_matcher,
            |content| {
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

                let new_content = content.replace(&edit.search, &edit.replace);
                validate_file_content(&edit.path, &new_content)?;
                Ok(new_content)
            },
        )?;
    }

    Ok(())
}

fn reject_gitignored_edit_path(
    base: &Path,
    rel: &str,
    operation: &str,
    gitignore_matcher: Option<&Gitignore>,
) -> anyhow::Result<()> {
    let normalized_rel = normalize_relative_path(Path::new(rel))?;
    let is_ignored = if let Some(matcher) = gitignore_matcher {
        is_ignored_by_matcher(Some(matcher), &normalized_rel, false)
    } else {
        let gitignore = load_gitignore_matcher(base)?;
        is_ignored_by_matcher(gitignore.as_ref(), &normalized_rel, false)
    };

    if is_ignored {
        return Err(anyhow::anyhow!(
            "{}: '{}' is ignored by .gitignore in config_dir; refusing to edit",
            operation,
            rel
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{apply_file_edits, rewrite_existing_file_in_dir};
    use crate::evolve::types::FileEdit;
    use std::fs;

    #[test]
    fn empty_search_overwrites_existing_file() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let base = temp.path();
        let file_path = base.join("flake.nix");
        fs::write(&file_path, "old").expect("seed file");

        let edit = FileEdit {
            path: "flake.nix".to_string(),
            search: "".to_string(),
            replace: "new".to_string(),
        };

        apply_file_edits(base, &edit, None).expect("apply edit");

        let updated = fs::read_to_string(&file_path).expect("read updated file");
        assert_eq!(updated, "new");
    }

    #[test]
    fn empty_search_creates_new_file_with_parents() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let base = temp.path();
        let file_path = base.join("modules/darwin/new.nix");

        let edit = FileEdit {
            path: "modules/darwin/new.nix".to_string(),
            search: "".to_string(),
            replace: "{}\n".to_string(),
        };

        apply_file_edits(base, &edit, None).expect("apply create edit");

        let created = fs::read_to_string(&file_path).expect("read created file");
        assert_eq!(created, "{}\n");
    }

    #[test]
    fn empty_search_errors_when_target_path_is_directory() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let base = temp.path();
        let dir_path = base.join("flake.nix");
        fs::create_dir_all(&dir_path).expect("create directory with file-like name");

        let edit = FileEdit {
            path: "flake.nix".to_string(),
            search: "".to_string(),
            replace: "new".to_string(),
        };

        let err = apply_file_edits(base, &edit, None).expect_err("expected directory-path error");
        assert!(err.to_string().contains("Path is a directory, not a file"));
    }

    #[test]
    fn empty_search_errors_when_parent_is_not_directory() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let base = temp.path();
        fs::write(base.join("flake.nix"), "old").expect("seed file");

        let edit = FileEdit {
            path: "flake.nix/child.nix".to_string(),
            search: "".to_string(),
            replace: "new".to_string(),
        };

        let err = apply_file_edits(base, &edit, None).expect_err("expected parent-not-dir error");
        assert!(err.to_string().contains("Parent path is not a directory"));
    }

    #[test]
    fn apply_file_edits_rejects_gitignored_target() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let base = temp.path();
        fs::write(base.join(".gitignore"), "secret.txt\n").expect("write .gitignore");

        let edit = FileEdit {
            path: "secret.txt".to_string(),
            search: "".to_string(),
            replace: "new".to_string(),
        };

        let err = apply_file_edits(base, &edit, None).expect_err("expected gitignored-path error");
        assert!(err.to_string().contains("ignored by .gitignore"));
    }

    #[test]
    fn rewrite_existing_file_in_dir_rejects_gitignored_target() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let base = temp.path();
        fs::write(base.join(".gitignore"), "secret.txt\n").expect("write .gitignore");
        fs::write(base.join("secret.txt"), "old").expect("seed file");

        let err =
            rewrite_existing_file_in_dir(base, "secret.txt", "test rewrite", None, |content| {
                Ok(content.replace("old", "new"))
            })
            .expect_err("expected gitignored-path error");
        assert!(err.to_string().contains("ignored by .gitignore"));
    }

    #[test]
    fn validate_nix_syntax_accepts_valid_nix() {
        let valid_nix = r#"
{
  config,
  pkgs,
  ...
}:
{
  environment.systemPackages = [ pkgs.git pkgs.vim ];
  system.stateVersion = "24.05";
}
"#;

        super::validate_nix_syntax(valid_nix, "test.nix").expect("should parse valid nix syntax");
    }

    #[test]
    fn validate_nix_syntax_rejects_unmatched_braces() {
        let invalid_nix = r#"
{
  environment.systemPackages = [ pkgs.git ];
  # Missing closing brace
"#;

        let err = super::validate_nix_syntax(invalid_nix, "test.nix")
            .expect_err("should reject unmatched braces");
        assert!(err.to_string().contains("Syntax error"));
    }

    #[test]
    fn validate_nix_syntax_rejects_unmatched_brackets() {
        let invalid_nix = r#"
{
  environment.systemPackages = [ pkgs.git pkgs.vim;
}
"#;

        let err = super::validate_nix_syntax(invalid_nix, "test.nix")
            .expect_err("should reject unmatched brackets");
        assert!(err.to_string().contains("Syntax error"));
    }

    #[test]
    fn validate_nix_syntax_rejects_unclosed_string() {
        let invalid_nix = r#"
{
  description = "My config;
}
"#;

        let err = super::validate_nix_syntax(invalid_nix, "test.nix")
            .expect_err("should reject unclosed string");
        assert!(err.to_string().contains("Syntax error"));
    }

    #[test]
    fn validate_nix_syntax_accepts_multiline_string_escapes() {
        let valid_nix = r#"
{
    script = ''
        echo "It'''s working"
        echo ''$HOME
        echo ''\n
    '';
}
"#;

        super::validate_nix_syntax(valid_nix, "test.nix")
            .expect("should accept multiline string escapes without closing early");
    }

    #[test]
    fn validate_nix_syntax_ignores_hash_comments() {
        let nix_with_comment = r#"
{
  # this unmatched stuff should be ignored: } ] )
  environment.systemPackages = [ pkgs.git ];
}
"#;

        super::validate_nix_syntax(nix_with_comment, "test.nix")
            .expect("should ignore delimiters inside hash comments");
    }

    #[test]
    fn validate_nix_syntax_ignores_block_comments() {
        let nix_with_block_comment = r#"
{
  /* unmatched delimiters in comment should be ignored: } ] ) */
  environment.systemPackages = [ pkgs.git ];
}
"#;

        super::validate_nix_syntax(nix_with_block_comment, "test.nix")
            .expect("should ignore delimiters inside block comments");
    }

    #[test]
    fn validate_nix_syntax_rejects_unclosed_block_comment() {
        let invalid_nix = r#"
{
  /* block comment never closes
  environment.systemPackages = [ pkgs.git ];
}
"#;

        let err = super::validate_nix_syntax(invalid_nix, "test.nix")
            .expect_err("should reject unclosed block comment");
        assert!(err.to_string().contains("unclosed block comment"));
    }

    #[test]
    fn validate_yaml_syntax_accepts_valid_yaml() {
        let valid_yaml = r#"
name: test
config:
  enable: true
  items:
    - first
    - second
"#;

        super::validate_yaml_syntax(valid_yaml, "test.yaml")
            .expect("should parse valid yaml syntax");
    }

    #[test]
    fn validate_yaml_syntax_rejects_unmatched_braces() {
        let invalid_yaml = r#"
config: { unclosed: value
"#;

        let err = super::validate_yaml_syntax(invalid_yaml, "test.yaml")
            .expect_err("should reject unmatched braces");
        assert!(err.to_string().contains("Syntax error"));
    }

    #[test]
    fn validate_yaml_syntax_rejects_unclosed_string() {
        let invalid_yaml = r#"
key: "unclosed string value
"#;

        let err = super::validate_yaml_syntax(invalid_yaml, "test.yaml")
            .expect_err("should reject unclosed string");
        assert!(err.to_string().contains("Syntax error"));
    }

    #[test]
    fn validate_file_content_delegates_by_extension() {
        // Test .nix file
        let valid_nix = "{ }";
        super::validate_file_content("modules/test.nix", valid_nix).expect("should validate .nix");

        // Test .yaml file
        let valid_yaml = "key: value";
        super::validate_file_content("config.yaml", valid_yaml).expect("should validate .yaml");

        // Test .yml file
        super::validate_file_content("config.yml", valid_yaml).expect("should validate .yml");

        // Test non-validated file (should always pass)
        super::validate_file_content("readme.md", "anything here")
            .expect("should accept non-validated file types");
    }

    #[test]
    fn file_edit_rejects_invalid_nix() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let base = temp.path();
        let file_path = base.join("test.nix");
        fs::write(&file_path, "{ }").expect("seed file");

        let edit = FileEdit {
            path: "test.nix".to_string(),
            search: "".to_string(),
            replace: "{ broken".to_string(), // Unmatched brace
        };

        let err = apply_file_edits(base, &edit, None).expect_err("should reject invalid nix");
        assert!(err.to_string().contains("Syntax error"));
        // Verify file was NOT written
        let content = fs::read_to_string(&file_path).expect("read file");
        assert_eq!(content, "{ }"); // Original content unchanged
    }

    #[test]
    fn file_edit_rejects_invalid_yaml() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let base = temp.path();
        let file_path = base.join("config.yaml");
        fs::write(&file_path, "key: value").expect("seed file");

        let edit = FileEdit {
            path: "config.yaml".to_string(),
            search: "".to_string(),
            replace: "key: [unclosed".to_string(), // Unmatched bracket
        };

        let err = apply_file_edits(base, &edit, None).expect_err("should reject invalid yaml");
        assert!(err.to_string().contains("Syntax error"));
        // Verify file was NOT written
        let content = fs::read_to_string(&file_path).expect("read file");
        assert_eq!(content, "key: value"); // Original content unchanged
    }
}
