//! Tools used by AI
//!
//! Each tool lives in its own submodule under `tools/`, exposing a
//! `definition()` (the schema advertised to the model) and an `execute()`
//! (the handler). This file wires them together: [`create_tools`] collects the
//! definitions and [`execute_tool`] dispatches a call by name. Shared types
//! ([`ToolResult`], [`ToolCtx`]) and helpers live here so every tool module can
//! reach them via `super::`.

mod arg_coercion;
mod ask_user;
mod build_check;
mod done;
mod edit_file;
mod edit_nix_file;
mod ensure_secret;
mod list_files;
mod read_file;
mod search_code;
mod search_docs;
mod search_packages;
mod think;

use crate::evolve::ensure_secret::EnsureSecretResult;
use crate::evolve::messages::Tool;
use crate::evolve::nix_file_editor::nix_quote_values;
use crate::evolve::search_packages::SearchPackageResult;
use crate::evolve::types::SemanticFileEdit;
use crate::evolve::utils::normalize_relative_path;
use crate::shared_types::FileEdit;

use super::gitignore::GitignoreChecker;
use super::nixmac_ignore::NixmacIgnoreChecker;
use anyhow::{Result, anyhow};
use std::path::{Component, Path};

pub(crate) use arg_coercion::coerce_stringified_args;

// =============================================================================
// Tool Definitions
// =============================================================================

/// Creates provider-agnostic tools, dropping any whose name is in `banned_tools`.
pub fn create_tools(banned_tools: &[&str]) -> Vec<Tool> {
    let allowed_tools = vec![
        think::definition(),
        read_file::definition(),
        edit_file::definition(),
        edit_nix_file::definition(),
        list_files::definition(),
        build_check::definition(),
        search_code::definition(),
        search_packages::definition(),
        search_docs::definition(),
        ensure_secret::definition(),
        ask_user::definition(),
        done::definition(),
    ];

    allowed_tools
        .into_iter()
        .filter(|tool| !banned_tools.contains(&tool.name.as_str()))
        .collect()
}

// =============================================================================
// Tool Execution
// =============================================================================

/// Shared context passed to every tool's `execute` handler.
pub(crate) struct ToolCtx<'a> {
    pub(crate) repo_root: &'a Path,
    pub(crate) config_dir: &'a str,
    pub(crate) host_attr: &'a str,
    pub(crate) args: &'a serde_json::Value,
    pub(crate) gitignore_matcher: Option<&'a GitignoreChecker>,
    pub(crate) nixmac_ignore_matcher: Option<&'a NixmacIgnoreChecker>,
    pub(crate) auto_format: bool,
    /// Sink for streamed `build_check` output batches; when absent the check
    /// runs blocking with no progress feedback.
    pub(crate) on_build_output: Option<&'a dyn Fn(&str)>,
}

/// Result of executing a tool call
#[derive(Debug, Clone)]
pub enum ToolResult {
    /// Continue the conversation with this content
    Continue(String),
    /// Agent signals completion with summary
    Done(String),
    /// A file edit was made
    Edit(FileEdit),
    /// Build check result (success, output, stdout, stderr)
    BuildResult {
        success: bool,
        output: String,
        stdout: String,
        stderr: String,
    },
    /// Agent thinking/reasoning (category, content)
    Think {
        category: String,
        thought: String,
    },
    EditSemantic(SemanticFileEdit),
    /// A SOPS secret was created/updated (and possibly injected into a Nix file).
    EnsureSecret(EnsureSecretResult),
    // Results from package search operations
    SearchPackages(Vec<SearchPackageResult>),
    /// Agent wants to ask the user a question
    Question {
        question: String,
        choices: Option<Vec<String>>,
    },
}

/// Execute a tool call and return the result
pub fn execute_tool(
    repo_root: &Path,
    config_dir: &str,
    host_attr: &str,
    name: &str,
    args: &serde_json::Value,
    auto_format: bool,
    gitignore_matcher: Option<&GitignoreChecker>,
    nixmac_ignore_matcher: Option<&NixmacIgnoreChecker>,
    on_build_output: Option<&dyn Fn(&str)>,
) -> Result<ToolResult> {
    // Repair double-encoded arguments at the dispatch boundary so every
    // caller — the live model loop, tests, and replayed tool calls alike —
    // executes with identically normalized arguments.
    let args = coerce_stringified_args(name, args.clone());
    let ctx = ToolCtx {
        repo_root,
        config_dir,
        host_attr,
        args: &args,
        auto_format,
        gitignore_matcher,
        nixmac_ignore_matcher,
        on_build_output,
    };

    match name {
        "think" => think::execute(&ctx),
        "read_file" => read_file::execute(&ctx),
        "list_files" => list_files::execute(&ctx),
        "edit_file" => edit_file::execute(&ctx),
        "edit_nix_file" => edit_nix_file::execute(&ctx),
        "build_check" => build_check::execute(&ctx),
        "search_code" => search_code::execute(&ctx),
        "search_packages" => search_packages::execute(&ctx),
        "search_docs" => search_docs::execute(&ctx),
        "ensure_secret" => ensure_secret::execute(&ctx),
        "ask_user" => ask_user::execute(&ctx),
        "done" => done::execute(&ctx),
        _ => Err(anyhow!("Unknown tool: {}", name)),
    }
}

/// Helper to determine if a tool is an editing tool, i.e. it
/// makes changes to the nix config that count as "edits" in the
/// evolution process and should be tracked as such.
pub fn is_editing_tool(name: &str) -> bool {
    matches!(name, "edit_file" | "edit_nix_file" | "ensure_secret")
}

// =============================================================================
// Shared helpers (used across tool modules)
// =============================================================================

fn is_homebrew_list_path(path: &str) -> bool {
    matches!(
        path.trim(),
        "homebrew.brews" | "homebrew.casks" | "homebrew.taps"
    )
}

pub(crate) fn quote_homebrew_list_values(path: &str, values: Vec<String>) -> Vec<String> {
    if is_homebrew_list_path(path) {
        nix_quote_values(&values)
    } else {
        values
    }
}

// Truncate string for logging (single line preview).
// `max_len` is a character budget: slicing by byte index would panic when the
// cut lands inside a multi-byte UTF-8 char (e.g. an accented letter or emoji in
// an agent thought), so truncate on a char boundary instead.
pub(crate) fn truncate_for_log(s: &str, max_len: usize) -> String {
    let s = s.replace('\n', " ").replace('\r', "");
    if s.chars().count() <= max_len {
        s
    } else {
        let truncated: String = s.chars().take(max_len).collect();
        format!("{}...", truncated)
    }
}

/// Makes sure that the given path is allowed to be edited under .nixmac.
/// Rules:
/// 1. In the special .nixmac directory, only .nixmac/<module>/data.json files may be edited by the agent.
/// 2. Files that are nixmac-ignored or .nixmacignore itself cannot be edited by the agent.
pub(crate) fn ensure_nixmac_edit_allowed(
    tool: &str,
    path: &str,
    nixmac_ignore: Option<&NixmacIgnoreChecker>,
) -> Result<()> {
    let normalized = normalize_relative_path(Path::new(path))?;
    let components = normalized.components().collect::<Vec<_>>();

    // Check Nixmac's ignore policy before the `.nixmac` exception. This keeps
    // mandatory ignores such as `result` and `.git` non-negatable even when a
    // path below them happens to contain a `.nixmac` component.
    if normalized == Path::new(".nixmacignore")
        || nixmac_ignore.is_some_and(|checker| checker.is_ignored(&normalized, false))
    {
        return Err(anyhow!(
            "{}: '{}' is protected by Nixmac ignore rules and cannot be edited by the agent",
            tool,
            normalized.display()
        ));
    }

    let Some(nixmac_index) = components
        .iter()
        .position(|component| matches!(component, Component::Normal(name) if *name == ".nixmac"))
    else {
        return Ok(());
    };

    // A repository's special `.nixmac` directory may live below the root, so
    // apply the reserved-file rules to the path suffix beginning there.
    let is_module_data_json = matches!(
        &components[nixmac_index..],
        [
            Component::Normal(root),
            Component::Normal(_module),
            Component::Normal(file),
        ] if *root == ".nixmac" && *file == "data.json"
    );

    if tool == "edit_file" && is_module_data_json {
        return Ok(());
    }

    Err(anyhow!(
        "{}: .nixmac is reserved for Nixmac official modules; agents may edit only \
         .nixmac/<module>/data.json (via edit_file)",
        tool
    ))
}

#[cfg(test)]
mod tests {
    use super::{ToolResult, execute_tool, is_editing_tool, truncate_for_log};
    use crate::evolve::gitignore::GitignoreChecker;
    use crate::evolve::nixmac_ignore::NixmacIgnoreChecker;
    use serde_json::json;
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;

    #[test]
    fn truncate_for_log_passes_short_strings_through() {
        assert_eq!(truncate_for_log("hello", 100), "hello");
    }

    #[test]
    fn truncate_for_log_collapses_newlines() {
        assert_eq!(truncate_for_log("a\nb\r\nc", 100), "a b c");
    }

    #[test]
    fn truncate_for_log_truncates_to_char_budget() {
        assert_eq!(truncate_for_log("abcdefghij", 4), "abcd...");
    }

    #[test]
    fn truncate_for_log_does_not_panic_on_multibyte_boundary() {
        // 3-byte chars: a byte-index slice at max_len would land mid-char and
        // panic (the original bug). Truncation must happen on a char boundary.
        let s = "→".repeat(50);
        assert_eq!(truncate_for_log(&s, 10), format!("{}...", "→".repeat(10)));
    }

    #[test]
    fn returns_true_for_editing_tools() {
        assert!(is_editing_tool("edit_file"));
        assert!(is_editing_tool("edit_nix_file"));
        assert!(is_editing_tool("ensure_secret"));
    }

    #[test]
    fn returns_false_for_non_editing_tools() {
        assert!(!is_editing_tool("read_file"));
        assert!(!is_editing_tool("list_files"));
        assert!(!is_editing_tool("build_check"));
        assert!(!is_editing_tool("done"));
        assert!(!is_editing_tool(""));
    }

    #[test]
    fn read_file_rejects_base_gitignored_files() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::write(tmp.path().join(".gitignore"), "secret.txt\n").expect("write .gitignore");
        fs::write(tmp.path().join("secret.txt"), "top secret").expect("write secret file");
        let gitignore_matcher = GitignoreChecker::new(tmp.path()).expect("load matcher");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "read_file",
            &json!({ "path": "secret.txt" }),
            false,
            gitignore_matcher.as_ref(),
            None,
            None,
        );

        let err = result.expect_err("ignored file should be rejected");
        assert!(
            err.to_string().contains("ignored by .gitignore"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn read_file_rejects_subdir_gitignored_files() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::create_dir_all(tmp.path().join("nested")).expect("make nested dir");
        fs::write(tmp.path().join("nested/.gitignore"), "secret.txt\n")
            .expect("write nested .gitignore");
        fs::write(tmp.path().join("nested/secret.txt"), "top secret")
            .expect("write nested secret file");
        let gitignore_matcher = GitignoreChecker::new(tmp.path()).expect("load matcher");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "read_file",
            &json!({ "path": "nested/secret.txt" }),
            false,
            gitignore_matcher.as_ref(),
            None,
            None,
        );

        let err = result.expect_err("nested gitignored file should be rejected");
        assert!(
            err.to_string().contains("ignored by .gitignore"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn list_files_skips_nixmac_ignored_files() {
        let tmp = tempdir().expect("tempdir");
        let repo = git2::Repository::init(tmp.path()).expect("init git repo");
        fs::write(tmp.path().join(".nixmacignore"), "secret.txt\n").expect("write .nixmacignore");
        fs::write(tmp.path().join("visible.txt"), "visible").expect("write visible file");
        fs::write(tmp.path().join("secret.txt"), "secret").expect("write secret file");
        let mut index = repo.index().expect("open git index");
        index
            .add_path(Path::new("secret.txt"))
            .expect("track secret file");
        index.write().expect("write git index");
        let nixmac_ignore_matcher = NixmacIgnoreChecker::new(tmp.path()).expect("load matcher");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "list_files",
            &json!({ "pattern": "**/*.txt" }),
            false,
            None,
            nixmac_ignore_matcher.as_ref(),
            None,
        )
        .expect("list_files should succeed");

        let ToolResult::Continue(output) = result else {
            panic!("expected ToolResult::Continue");
        };

        assert!(output.contains("visible.txt"), "output: {output}");
        assert!(!output.contains("secret.txt"), "output: {output}");
    }

    #[test]
    fn list_files_skips_base_gitignored_files() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::write(tmp.path().join(".gitignore"), "secret.txt\nignored-dir/\n")
            .expect("write .gitignore");
        fs::write(tmp.path().join("visible.txt"), "visible").expect("write visible file");
        fs::write(tmp.path().join("secret.txt"), "secret").expect("write secret file");
        fs::create_dir_all(tmp.path().join("ignored-dir")).expect("make ignored dir");
        fs::write(tmp.path().join("ignored-dir/file.txt"), "ignored").expect("write ignored file");
        let gitignore_matcher = GitignoreChecker::new(tmp.path()).expect("load matcher");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "list_files",
            &json!({ "pattern": "**/*.txt" }),
            false,
            gitignore_matcher.as_ref(),
            None,
            None,
        )
        .expect("list_files should succeed");

        let ToolResult::Continue(output) = result else {
            panic!("expected ToolResult::Continue");
        };

        assert!(output.contains("visible.txt"), "output: {output}");
        assert!(!output.contains("secret.txt"), "output: {output}");
        assert!(!output.contains("ignored-dir/file.txt"), "output: {output}");
    }

    #[test]
    fn list_files_skips_tracked_files_ignored_by_nixmacignore() {
        let tmp = tempdir().expect("tempdir");
        let repo = git2::Repository::init(tmp.path()).expect("init git repo");
        fs::write(tmp.path().join(".nixmacignore"), "secret.txt\n").expect("write .nixmacignore");
        fs::write(tmp.path().join("visible.txt"), "visible").expect("write visible file");
        fs::write(tmp.path().join("secret.txt"), "secret").expect("write secret file");
        let mut index = repo.index().expect("open git index");
        index
            .add_path(Path::new("secret.txt"))
            .expect("track secret file");
        index.write().expect("write git index");
        let gitignore_matcher = GitignoreChecker::new(tmp.path()).expect("load matcher");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "list_files",
            &json!({ "pattern": "**/*.txt" }),
            false,
            gitignore_matcher.as_ref(),
            None,
            None,
        )
        .expect("list_files should succeed");

        let ToolResult::Continue(output) = result else {
            panic!("expected ToolResult::Continue");
        };

        assert!(output.contains("visible.txt"), "output: {output}");
        assert!(!output.contains("secret.txt"), "output: {output}");
    }

    #[test]
    fn edit_file_rejects_base_gitignored_paths() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::write(tmp.path().join(".gitignore"), "secret.txt\n").expect("write .gitignore");
        let gitignore_matcher = GitignoreChecker::new(tmp.path()).expect("load matcher");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_file",
            &json!({
                "path": "secret.txt",
                "search": "",
                "replace": "hello"
            }),
            false,
            gitignore_matcher.as_ref(),
            None,
            None,
        );

        let err = result.expect_err("edit_file should reject gitignored paths");
        let err_chain = format!("{err:#}");
        assert!(
            err_chain.contains("ignored by .gitignore"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn edit_nix_file_rejects_base_gitignored_paths() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::write(tmp.path().join(".gitignore"), "ignored.nix\n").expect("write .gitignore");
        fs::write(tmp.path().join("ignored.nix"), "{ ... }: { }\n").expect("write nix file");
        let gitignore_matcher = GitignoreChecker::new(tmp.path()).expect("load matcher");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "path": "ignored.nix",
                "action": {
                    "set": {
                        "path": "services.tailscale.enable",
                        "value": true
                    }
                }
            }),
            false,
            gitignore_matcher.as_ref(),
            None,
            None,
        );

        let err = result.expect_err("edit_nix_file should reject gitignored paths");
        assert!(
            err.to_string().contains("ignored by .gitignore"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn edit_nix_file_reports_attr_path_used_as_top_level_path() {
        let tmp = tempdir().expect("tempdir");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "action": "set_attrs",
                "path": "launchd.user.agents",
                "attrs": {
                    "raycast": {
                        "serviceConfig": {
                            "Label": "com.raycast.macos",
                            "RunAtLoad": true
                        }
                    }
                }
            }),
            false,
            None,
            None,
            None,
        );

        let err = result.expect_err("attr path in top-level path should be corrective");
        let msg = err.to_string();
        assert!(
            msg.contains("top-level 'path' must be the relative .nix file"),
            "unexpected error: {err:#}"
        );
        assert!(
            msg.contains(r#""path": "modules/darwin/services.nix""#),
            "unexpected error: {err:#}"
        );
        assert!(
            msg.contains(r#""set_attrs": { "path": "launchd.user.agents", "attrs": {...} }"#),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn edit_nix_file_reports_list_attr_path_set_array_as_add_values() {
        let tmp = tempdir().expect("tempdir");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "action": "set",
                "path": "homebrew.casks",
                "value": ["docker", "iterm2", "audacity", "rectangle"]
            }),
            false,
            None,
            None,
            None,
        );

        let err = result.expect_err("list attr path in top-level path should suggest add");
        let msg = err.to_string();
        assert!(
            msg.contains(r#""action": { "add": { "path": "homebrew.casks", "values": ["docker","iterm2","audacity","rectangle"] } }"#),
            "unexpected error: {err:#}"
        );
        assert!(
            msg.contains("use action.add/action.remove with 'values'"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn edit_nix_file_reports_string_array_set_as_add_values_for_generic_attr_path() {
        let tmp = tempdir().expect("tempdir");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "action": "set",
                "path": "programs.example.extraPackages",
                "value": ["alpha", "beta"]
            }),
            false,
            None,
            None,
            None,
        );

        let err = result.expect_err("string array set should suggest add values");
        let msg = err.to_string();
        assert!(
            msg.contains(r#""action": { "add": { "path": "programs.example.extraPackages", "values": ["alpha","beta"] } }"#),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn edit_nix_file_reports_shorthand_action_missing_attr_path() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::write(tmp.path().join("services.nix"), "{ ... }: { }\n").expect("write nix file");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "path": "services.nix",
                "action": "set_attrs",
                "attrs": {
                    "raycast": {
                        "serviceConfig": {
                            "Label": "com.raycast.macos",
                            "RunAtLoad": true
                        }
                    }
                }
            }),
            false,
            None,
            None,
            None,
        );

        let err = result.expect_err("shorthand set_attrs should require an action path");
        let msg = err.to_string();
        assert!(
            msg.contains("edit_nix_file.set_attrs: missing action path"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn edit_nix_file_recovers_double_encoded_action_string() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::write(tmp.path().join("system.nix"), "{ ... }: { }\n").expect("write nix file");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "path": "system.nix",
                "action": "{\"set\": {\"path\": \"system.defaults.NSGlobalDomain._HIHideMenuBar\", \"value\": false}}"
            }),
            false,
            None,
            None,
            None,
        )
        .expect("double-encoded action string should be recovered as the action object");

        assert!(matches!(result, ToolResult::EditSemantic(_)));
        let content = fs::read_to_string(tmp.path().join("system.nix")).expect("read nix file");
        assert!(
            content.contains("_HIHideMenuBar = false"),
            "unexpected content: {content}"
        );
    }

    #[test]
    fn execute_tool_repairs_stringified_action_payload() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::write(tmp.path().join("services.nix"), "{ ... }: { }\n").expect("write nix file");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "path": "services.nix",
                "action": {
                    "set": "{\"path\": \"services.tailscale.enable\", \"value\": true}"
                }
            }),
            false,
            None,
            None,
            None,
        )
        .expect("stringified action payload should be repaired at dispatch");

        assert!(matches!(result, ToolResult::EditSemantic(_)));
        let content = fs::read_to_string(tmp.path().join("services.nix")).expect("read nix file");
        assert!(
            content.contains("services.tailscale.enable = true"),
            "unexpected content: {content}"
        );
    }

    #[test]
    fn edit_nix_file_rejects_double_encoded_non_action_string() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::write(tmp.path().join("system.nix"), "{ ... }: { }\n").expect("write nix file");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "path": "system.nix",
                "action": "\"not-an-action\""
            }),
            false,
            None,
            None,
            None,
        );

        let err = result.expect_err("non-object double-encoded action should still error");
        assert!(
            err.to_string().contains("unsupported shorthand action"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn edit_nix_file_reports_non_object_action_payload() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::write(tmp.path().join("services.nix"), "{ ... }: { }\n").expect("write nix file");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "path": "services.nix",
                "action": {
                    "set_attrs": "launchd.user.agents"
                }
            }),
            false,
            None,
            None,
            None,
        );

        let err = result.expect_err("non-object set_attrs payload should be corrective");
        assert!(
            err.to_string()
                .contains("edit_nix_file.set_attrs: action payload must be an object"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn edit_nix_file_quotes_homebrew_add_values() {
        let tmp = tempdir().expect("tempdir");
        fs::write(
            tmp.path().join("homebrew.nix"),
            r#"{ ... }:
{
  homebrew = {
    brews = [ ];
  };
}
"#,
        )
        .expect("write homebrew module");

        execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "path": "homebrew.nix",
                "action": {
                    "add": {
                        "path": "homebrew.brews",
                        "values": ["bat"]
                    }
                }
            }),
            false,
            None,
            None,
            None,
        )
        .expect("edit_nix_file should quote Homebrew values");

        let edited = fs::read_to_string(tmp.path().join("homebrew.nix")).expect("read edited");
        assert!(edited.contains(r#"brews = [ "bat" ];"#), "{edited}");
        assert!(!edited.contains("brews = [ bat ];"), "{edited}");
    }

    #[test]
    fn edit_nix_file_accepts_add_shorthand_and_infers_only_list_path() {
        let tmp = tempdir().expect("tempdir");
        let module_dir = tmp.path().join("modules/darwin");
        fs::create_dir_all(&module_dir).expect("make module dir");
        fs::write(
            module_dir.join("packages.nix"),
            r#"{ pkgs, ... }:
{
  environment.systemPackages = with pkgs; [
    git
  ];
}
"#,
        )
        .expect("write package module");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "action": "add",
                "path": "modules/darwin/packages.nix",
                "values": ["wget"]
            }),
            false,
            None,
            None,
            None,
        )
        .expect("edit_nix_file should accept add shorthand");

        let ToolResult::EditSemantic(edit) = result else {
            panic!("expected semantic edit result");
        };
        assert_eq!(edit.path, "modules/darwin/packages.nix");
        let crate::evolve::types::FileEditAction::Add { path, values } = edit.action else {
            panic!("expected add action");
        };
        assert_eq!(path, "environment.systemPackages");
        assert_eq!(values, vec!["wget".to_string()]);

        let edited = fs::read_to_string(module_dir.join("packages.nix")).expect("read edited");
        assert!(
            edited.contains("environment.systemPackages = with pkgs; ["),
            "{edited}"
        );
        assert!(edited.contains("    git\n    wget"), "{edited}");
    }

    #[test]
    fn edit_nix_file_accepts_add_shorthand_with_explicit_attr_path() {
        let tmp = tempdir().expect("tempdir");
        fs::write(
            tmp.path().join("packages.nix"),
            r#"{ pkgs, ... }:
{
  environment.systemPackages = with pkgs; [
    git
  ];

  home.packages = with pkgs; [
    ripgrep
  ];
}
"#,
        )
        .expect("write package module");

        execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "action": "add",
                "path": "packages.nix",
                "attr_path": "home.packages",
                "values": ["fd"]
            }),
            false,
            None,
            None,
            None,
        )
        .expect("edit_nix_file should accept explicit attr_path shorthand");

        let edited = fs::read_to_string(tmp.path().join("packages.nix")).expect("read edited");
        assert!(
            edited.contains("home.packages = with pkgs; [\n    ripgrep\n    fd"),
            "{edited}"
        );
        assert!(!edited.contains("git\n    fd"), "{edited}");
    }

    #[test]
    fn edit_nix_file_rejects_add_shorthand_when_multiple_list_paths_are_possible() {
        let tmp = tempdir().expect("tempdir");
        let original = r#"{ pkgs, ... }:
{
  environment.systemPackages = with pkgs; [
    git
  ];

  home.packages = with pkgs; [
    ripgrep
  ];
}
"#;
        fs::write(tmp.path().join("packages.nix"), original).expect("write package module");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "action": "add",
                "path": "packages.nix",
                "values": ["fd"]
            }),
            false,
            None,
            None,
            None,
        );

        let err = result.expect_err("ambiguous shorthand should require an explicit attr path");
        assert!(
            err.to_string()
                .contains("edit_nix_file.add: missing action path"),
            "unexpected error: {err:#}"
        );

        let edited = fs::read_to_string(tmp.path().join("packages.nix")).expect("read file");
        assert_eq!(edited, original);
    }

    #[test]
    fn edit_nix_file_quotes_homebrew_remove_values() {
        let tmp = tempdir().expect("tempdir");
        fs::write(
            tmp.path().join("homebrew.nix"),
            r#"{ ... }:
{
  homebrew = {
    brews = [ "bat" "jq" ];
  };
}
"#,
        )
        .expect("write homebrew module");

        execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "path": "homebrew.nix",
                "action": {
                    "remove": {
                        "path": "homebrew.brews",
                        "values": ["bat"]
                    }
                }
            }),
            false,
            None,
            None,
            None,
        )
        .expect("edit_nix_file should match quoted Homebrew values");

        let edited = fs::read_to_string(tmp.path().join("homebrew.nix")).expect("read edited");
        assert!(edited.contains(r#"brews = [ "jq" ];"#), "{edited}");
        assert!(!edited.contains(r#""bat""#), "{edited}");
    }

    #[test]
    fn edit_file_allows_nixmac_data_json() {
        let tmp = tempdir().expect("tempdir");
        let module_dir = tmp.path().join(".nixmac/homebrew");
        fs::create_dir_all(&module_dir).expect("make module dir");
        fs::write(module_dir.join("data.json"), "{\n  \"brews\": []\n}\n").expect("write data");

        execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_file",
            &json!({
                "path": ".nixmac/homebrew/data.json",
                "search": "[]",
                "replace": "[\"git\"]"
            }),
            false,
            None,
            None,
            None,
        )
        .expect("data.json edits should be allowed");
    }

    #[test]
    fn edit_file_rejects_nixmac_metadata() {
        let tmp = tempdir().expect("tempdir");
        let module_dir = tmp.path().join(".nixmac/homebrew");
        fs::create_dir_all(&module_dir).expect("make module dir");
        fs::write(module_dir.join("meta.json"), "{}\n").expect("write metadata");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_file",
            &json!({
                "path": ".nixmac/homebrew/meta.json",
                "search": "{}",
                "replace": "{\"name\":\"Changed\"}"
            }),
            false,
            None,
            None,
            None,
        );

        let err = result.expect_err("meta.json edits should be rejected");
        assert!(err.to_string().contains(".nixmac is reserved"));
    }

    #[test]
    fn edit_file_rejects_stray_nixmac_data_json() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::create_dir_all(tmp.path().join(".nixmac")).expect("make nixmac dir");
        fs::write(tmp.path().join(".nixmac/data.json"), "{}\n").expect("write stray data");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_file",
            &json!({
                "path": ".nixmac/data.json",
                "search": "{}",
                "replace": "{\"enabled\":true}"
            }),
            false,
            None,
            None,
            None,
        );

        let err = result.expect_err("top-level .nixmac/data.json should be rejected");
        assert!(err.to_string().contains(".nixmac is reserved"));
    }

    #[test]
    fn edit_nix_file_rejects_nixmac_nix_files() {
        let tmp = tempdir().expect("tempdir");
        let module_dir = tmp.path().join(".nixmac/homebrew");
        fs::create_dir_all(&module_dir).expect("make module dir");
        fs::write(module_dir.join("default.nix"), "{ ... }: { }\n").expect("write module");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_nix_file",
            &json!({
                "path": ".nixmac/homebrew/default.nix",
                "action": {
                    "set": {
                        "path": "homebrew.enable",
                        "value": true
                    }
                }
            }),
            false,
            None,
            None,
            None,
        );

        let err = result.expect_err(".nixmac nix edits should be rejected");
        assert!(err.to_string().contains(".nixmac is reserved"));
    }

    #[test]
    fn ensure_secret_rejects_nixmac_injection_targets() {
        let tmp = tempdir().expect("tempdir");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "ensure_secret",
            &json!({
                "name": "api-token",
                "inject": {
                    "type": "nix_env",
                    "file": ".nixmac/homebrew/default.nix",
                    "target": "environment.variables.API_TOKEN"
                }
            }),
            false,
            None,
            None,
            None,
        );

        let err = result.expect_err(".nixmac ensure_secret injection should be rejected");
        assert!(err.to_string().contains(".nixmac is reserved"));
    }

    #[test]
    fn edit_file_rejects_subdir_gitignored_paths() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::create_dir_all(tmp.path().join("nested")).expect("make nested dir");
        fs::write(tmp.path().join("nested/.gitignore"), "secret.txt\n")
            .expect("write nested .gitignore");
        let gitignore_matcher = GitignoreChecker::new(tmp.path()).expect("load matcher");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "edit_file",
            &json!({
                "path": "nested/secret.txt",
                "search": "",
                "replace": "hello"
            }),
            false,
            gitignore_matcher.as_ref(),
            None,
            None,
        );

        let err = result.expect_err("edit_file should reject nested gitignored paths");
        let err_chain = format!("{err:#}");
        assert!(
            err_chain.contains("ignored by .gitignore"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn create_tools_allows_bans() {
        let banned_tools = ["edit_file", "edit_nix_file"];
        let tools = super::create_tools(&banned_tools);

        // Ensure tools doesn't contain either of the banned ones
        // by looking for the tools with the banned names and asserting they are not found.
        for banned in &banned_tools {
            let found = tools.iter().find(|tool| tool.name == *banned);
            assert!(
                found.is_none(),
                "Banned tool '{}' should not be in the tools list",
                banned
            );
        }
    }

    #[test]
    fn nixmac_guard_names_edit_file_for_module_data_json() {
        let err =
            super::ensure_nixmac_edit_allowed("ensure_secret", ".nixmac/homebrew/data.json", None)
                .expect_err("only edit_file may edit module data.json");
        assert!(
            err.to_string().contains("edit_file"),
            "error must name the tool that CAN do this edit: {err:#}"
        );

        let err =
            super::ensure_nixmac_edit_allowed("edit_file", ".nixmac/homebrew/default.nix", None)
                .expect_err("non-data.json .nixmac files stay reserved");
        assert!(err.to_string().contains("reserved"), "unexpected: {err:#}");

        super::ensure_nixmac_edit_allowed("edit_file", ".nixmac/homebrew/data.json", None)
            .expect("edit_file on module data.json is allowed");
    }

    #[test]
    fn nixmac_guard_applies_reserved_rules_to_nested_nixmac_directories() {
        super::ensure_nixmac_edit_allowed(
            "edit_file",
            "hosts/macbook/.nixmac/homebrew/data.json",
            None,
        )
        .expect("nested module data.json is allowed through edit_file");

        for (tool, path) in [
            ("edit_nix_file", "hosts/macbook/.nixmac/homebrew/data.json"),
            ("edit_file", "hosts/macbook/.nixmac/homebrew/default.nix"),
            ("edit_file", "hosts/macbook/.nixmac/data.json"),
        ] {
            let error = super::ensure_nixmac_edit_allowed(tool, path, None)
                .expect_err("reserved nested .nixmac path must be rejected");
            assert!(error.to_string().contains("reserved"), "error: {error:#}");
        }
    }

    #[test]
    fn nixmac_guard_rejects_nixmac_ignored_edit_paths() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::write(tmp.path().join(".nixmacignore"), "private/\n").expect("write ignore file");
        let checker = NixmacIgnoreChecker::new(tmp.path())
            .expect("create checker")
            .expect("git repository has a checker");

        let error =
            super::ensure_nixmac_edit_allowed("edit_file", "private/settings.json", Some(&checker))
                .expect_err("nixmac-ignored file must be rejected");
        assert!(
            error.to_string().contains("Nixmac ignore rules"),
            "error: {error:#}"
        );

        super::ensure_nixmac_edit_allowed("edit_file", "visible/settings.json", Some(&checker))
            .expect("non-ignored ordinary path remains editable");
    }

    #[test]
    fn nixmac_guard_preserves_nested_module_data_exception_with_ignore_matcher() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        fs::write(tmp.path().join(".nixmacignore"), "*\n").expect("write ignore file");
        let checker = NixmacIgnoreChecker::new(tmp.path())
            .expect("create checker")
            .expect("git repository has a checker");

        super::ensure_nixmac_edit_allowed(
            "edit_file",
            "hosts/macbook/.nixmac/homebrew/data.json",
            Some(&checker),
        )
        .expect("the special .nixmac directory is immune to user ignore rules");
    }

    #[test]
    fn nixmac_guard_never_allows_root_nixmacignore_edits() {
        let error = super::ensure_nixmac_edit_allowed("edit_file", "./.nixmacignore", None)
            .expect_err(".nixmacignore must be protected even without a checker");
        assert!(
            error.to_string().contains("Nixmac ignore rules"),
            "error: {error:#}"
        );
    }

    #[test]
    fn mandatory_ignores_precede_nested_nixmac_edit_exception() {
        let tmp = tempdir().expect("tempdir");
        git2::Repository::init(tmp.path()).expect("init git repo");
        let checker = NixmacIgnoreChecker::new(tmp.path())
            .expect("create checker")
            .expect("git repository has a checker");

        let error = super::ensure_nixmac_edit_allowed(
            "edit_file",
            "result/.nixmac/homebrew/data.json",
            Some(&checker),
        )
        .expect_err("mandatory result ignore must take precedence");
        assert!(
            error.to_string().contains("Nixmac ignore rules"),
            "error: {error:#}"
        );
    }

    #[test]
    fn edit_nix_file_rejects_non_nix_files_and_names_edit_file() {
        let tmp = tempdir().expect("tempdir");

        for path in [".nixmac/homebrew/data.json", "config/settings.json"] {
            let result = execute_tool(
                tmp.path(),
                tmp.path().to_str().expect("utf-8 path"),
                "dummy-host",
                "edit_nix_file",
                &json!({
                    "path": path,
                    "action": {
                        "set": {
                            "path": "homebrew.enable",
                            "value": true
                        }
                    }
                }),
                false,
                None,
                None,
                None,
            );

            let err = result.expect_err("edit_nix_file must reject non-.nix files");
            assert!(
                err.to_string().contains("not a .nix file"),
                "'{path}' must be rejected by the extension gate: {err:#}"
            );
            assert!(
                err.to_string().contains("edit_file"),
                "error must name the tool that CAN edit '{path}': {err:#}"
            );
        }
    }
}
