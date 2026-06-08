//! Tools used by AI
//!
//! Each tool lives in its own submodule under `tools/`, exposing a
//! `definition()` (the schema advertised to the model) and an `execute()`
//! (the handler). This file wires them together: [`create_tools`] collects the
//! definitions and [`execute_tool`] dispatches a call by name. Shared types
//! ([`ToolResult`], [`ToolCtx`]) and helpers live here so every tool module can
//! reach them via `super::`.

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

use crate::evolve::edit_nix_file::nix_quote_values;
use crate::evolve::ensure_secret::EnsureSecretResult;
use crate::evolve::messages::Tool;
use crate::evolve::search_packages::SearchPackageResult;
use crate::evolve::types::SemanticFileEdit;
use crate::evolve::utils::normalize_relative_path;
use crate::shared_types::FileEdit;

use anyhow::{anyhow, Result};
use ignore::gitignore::Gitignore;
use std::path::{Component, Path};

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
    pub(crate) gitignore_matcher: Option<&'a Gitignore>,
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
    gitignore_matcher: Option<&Gitignore>,
) -> Result<ToolResult> {
    let ctx = ToolCtx {
        repo_root,
        config_dir,
        host_attr,
        args,
        gitignore_matcher,
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

pub(crate) fn ensure_nixmac_edit_allowed(tool: &str, path: &str) -> Result<()> {
    let normalized = normalize_relative_path(Path::new(path))?;
    let components = normalized.components().collect::<Vec<_>>();
    let is_nixmac =
        matches!(components.first(), Some(Component::Normal(name)) if *name == ".nixmac");

    if !is_nixmac {
        return Ok(());
    }

    let is_module_data_json = matches!(
        components.as_slice(),
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
        "{}: .nixmac is reserved for Nixmac official modules; agents may edit only .nixmac/<module>/data.json",
        tool
    ))
}

#[cfg(test)]
mod tests {
    use super::{execute_tool, truncate_for_log, ToolResult};
    use crate::evolve::gitignore::load_gitignore_matcher;
    use serde_json::json;
    use std::fs;
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
    fn read_file_rejects_base_gitignored_files() {
        let tmp = tempdir().expect("tempdir");
        fs::write(tmp.path().join(".gitignore"), "secret.txt\n").expect("write .gitignore");
        fs::write(tmp.path().join("secret.txt"), "top secret").expect("write secret file");
        let gitignore_matcher = load_gitignore_matcher(tmp.path()).expect("load matcher");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "read_file",
            &json!({ "path": "secret.txt" }),
            gitignore_matcher.as_ref(),
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
        fs::create_dir_all(tmp.path().join("nested")).expect("make nested dir");
        fs::write(tmp.path().join("nested/.gitignore"), "secret.txt\n")
            .expect("write nested .gitignore");
        fs::write(tmp.path().join("nested/secret.txt"), "top secret")
            .expect("write nested secret file");
        let gitignore_matcher = load_gitignore_matcher(tmp.path()).expect("load matcher");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "read_file",
            &json!({ "path": "nested/secret.txt" }),
            gitignore_matcher.as_ref(),
        );

        let err = result.expect_err("nested gitignored file should be rejected");
        assert!(
            err.to_string().contains("ignored by .gitignore"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn list_files_skips_base_gitignored_files() {
        let tmp = tempdir().expect("tempdir");
        fs::write(tmp.path().join(".gitignore"), "secret.txt\nignored-dir/\n")
            .expect("write .gitignore");
        fs::write(tmp.path().join("visible.txt"), "visible").expect("write visible file");
        fs::write(tmp.path().join("secret.txt"), "secret").expect("write secret file");
        fs::create_dir_all(tmp.path().join("ignored-dir")).expect("make ignored dir");
        fs::write(tmp.path().join("ignored-dir/file.txt"), "ignored").expect("write ignored file");
        let gitignore_matcher = load_gitignore_matcher(tmp.path()).expect("load matcher");

        let result = execute_tool(
            tmp.path(),
            tmp.path().to_str().expect("utf-8 path"),
            "dummy-host",
            "list_files",
            &json!({ "pattern": "**/*.txt" }),
            gitignore_matcher.as_ref(),
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
    fn edit_file_rejects_base_gitignored_paths() {
        let tmp = tempdir().expect("tempdir");
        fs::write(tmp.path().join(".gitignore"), "secret.txt\n").expect("write .gitignore");
        let gitignore_matcher = load_gitignore_matcher(tmp.path()).expect("load matcher");

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
            gitignore_matcher.as_ref(),
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
        fs::write(tmp.path().join(".gitignore"), "ignored.nix\n").expect("write .gitignore");
        fs::write(tmp.path().join("ignored.nix"), "{ ... }: { }\n").expect("write nix file");
        let gitignore_matcher = load_gitignore_matcher(tmp.path()).expect("load matcher");

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
            gitignore_matcher.as_ref(),
        );

        let err = result.expect_err("edit_nix_file should reject gitignored paths");
        assert!(
            err.to_string().contains("ignored by .gitignore"),
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
            None,
        );

        let err = result.expect_err("ambiguous shorthand should require an explicit attr path");
        assert!(
            err.to_string().contains("edit_nix_file.add: missing path"),
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
            None,
        );

        let err = result.expect_err("meta.json edits should be rejected");
        assert!(err.to_string().contains(".nixmac is reserved"));
    }

    #[test]
    fn edit_file_rejects_stray_nixmac_data_json() {
        let tmp = tempdir().expect("tempdir");
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
            None,
        );

        let err = result.expect_err(".nixmac ensure_secret injection should be rejected");
        assert!(err.to_string().contains(".nixmac is reserved"));
    }

    #[test]
    fn edit_file_rejects_subdir_gitignored_paths() {
        let tmp = tempdir().expect("tempdir");
        fs::create_dir_all(tmp.path().join("nested")).expect("make nested dir");
        fs::write(tmp.path().join("nested/.gitignore"), "secret.txt\n")
            .expect("write nested .gitignore");
        let gitignore_matcher = load_gitignore_matcher(tmp.path()).expect("load matcher");

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
            gitignore_matcher.as_ref(),
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
}
