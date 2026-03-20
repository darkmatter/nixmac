//! Tools used by AI

use super::file_ops::{
    apply_file_edits, ensure_path_under_base, join_in_dir, resolve_existing_path_in_dir,
};
use super::messages::Tool;
use super::search_code::execute_search_code;
use super::search_packages::execute_search_packages;
use super::types::FileEdit;

use super::utils::truncate_error;
use anyhow::{anyhow, Result};
use log::{debug, error, info};
use std::path::{Component, Path};
use std::process::Command;

// =============================================================================
// Tool Definitions
// =============================================================================

/// Creates provider-agnostic tools
pub fn create_tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "think".to_string(),
            description: "Use this tool to think through problems step by step. You should use this \
                         tool FREQUENTLY - before reading files, before making edits, when analyzing \
                         errors, and when planning your approach. Categories: 'planning' for initial \
                         strategy, 'analysis' for understanding code, 'debugging' for fixing errors, \
                         'verification' for checking your work. Keep thought concise and actionable \
                         (prefer 1-2 sentences, <= 200 characters)."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "enum": ["planning", "analysis", "debugging", "verification", "other"],
                        "description": "Category of thinking"
                    },
                    "thought": {
                        "type": "string",
                        "description": "Brief thought content, ideally 1-2 sentences and <= 200 characters"
                    }
                },
                "required": ["category", "thought"]
            }),
        },
        Tool {
            name: "read_file".to_string(),
            description: "Read the contents of a file. Always read relevant files before making edits to understand the existing code structure and patterns.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to the file"
                    }
                },
                "required": ["path"]
            }),
        },
        Tool {
            name: "edit_file".to_string(),
            description: "Edit a file by finding and replacing text. The search string must be \
                         unique in the file. For new files, use empty search string. \
                         IMPORTANT: Always provide complete, production-ready code - never use \
                         placeholders, TODOs, or abbreviated implementations.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to the file"
                    },
                    "search": {
                        "type": "string",
                        "description": "Exact text to find (empty for new file)"
                    },
                    "replace": {
                        "type": "string",
                        "description": "Text to replace with"
                    }
                },
                "required": ["path", "search", "replace"]
            }),
        },
        Tool {
            name: "list_files".to_string(),
            description: "List files in the config directory. Use glob patterns to find specific file types.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Glob pattern (default: **/*)"
                    }
                }
            }),
        },
        Tool {
            name: "build_check".to_string(),
            description: "Validate the Nix flake by running a dry-run build. This checks for syntax \
                         errors and evaluation errors WITHOUT actually building derivations. \
                         Call this BEFORE calling 'done' to ensure your changes are valid. \
                         If the build fails, analyze the error and fix it before trying again.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "show_trace": {
                        "type": "boolean",
                        "description": "Include --show-trace in nix build for deeper stack traces (default: false)"
                    }
                },
            }),
        },
        Tool {
            name: "search_code".to_string(),
            description: "Search for text patterns in the codebase using ripgrep. \
                         This helps locate where functions or variables are defined or used. \
                         Output format: one match per line as file:line:text, where \
                         text is the matching line content.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regex pattern to search for"
                    },
                    "file_pattern": {
                        "type": "string",
                        "description": "Optional glob pattern for files to search in"
                    }
                },
                "required": ["pattern"]
            }),
        },
        Tool {
            name: "search_packages".to_string(),
            description: "Search for Nix packages by name or description. This is a convenient \
                         wrapper around 'nix search' that returns compact structured JSON results. \
                         Output format: JSON object keyed by package name. Each value must include \
                         {\"attr_path\": string, \"version\": string, \"description\": string, \"channel\": string}. \
                         Example: {\"wget\": {\"attr_path\": \"wget\", \"version\": \"1.21.3\", \"description\": \"retrieves files from the web\", \"channel\": \"nixpkgs-unstable\"}}. \
                         Return JSON only (no prose). \
                         Parameters: search_type controls where to search (names, descriptions, or both); \
                         use_regex enables regex patterns for advanced matching; \
                         channel lets you search in different flakes (nixpkgs, nixpkgs-unstable, etc.)".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query (package name, description keywords, or regex pattern)"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default: 20)"
                    },
                    "search_type": {
                        "type": "string",
                        "enum": ["name", "description", "both"],
                        "description": "What to search in: 'name' for package names only, 'description' for descriptions only, 'both' for all fields (default: 'both')"
                    },
                    "use_regex": {
                        "type": "boolean",
                        "description": "Whether to interpret query as a regex pattern (default: false). Use for complex patterns like 'python[0-9]+'"
                    },
                    "channel": {
                        "type": "string",
                        "description": "Flake/channel to search in: 'nixpkgs' (default), 'nixpkgs-unstable', 'nixpkgs-master', etc."
                    }
                },
                "required": ["query"]
            }),
        },
        Tool {
            name: "done".to_string(),
            description: "Signal that all changes are complete. IMPORTANT: Only call this AFTER \
                         you have verified your changes with build_check and are confident they work.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "Description of changes made"
                    }
                },
                "required": ["summary"]
            }),
        },
    ]
}

// =============================================================================
// Tool Execution
// =============================================================================

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
    Think { category: String, thought: String },
}

/// Execute a tool call and return the result
pub fn execute_tool(
    config_dir: &str,
    host_attr: &str,
    name: &str,
    args: &serde_json::Value,
) -> Result<ToolResult> {
    let base = Path::new(config_dir);
    match name {
        "think" => {
            let category = args["category"].as_str().unwrap_or("other").to_string();
            let thought = args["thought"]
                .as_str()
                .ok_or_else(|| anyhow!("think: missing thought"))?
                .to_string();

            info!(
                "🧠 THINKING [{}]: {}",
                category,
                truncate_for_log(&thought, 200)
            );
            debug!("Full thought: {}", thought);

            Ok(ToolResult::Think { category, thought })
        }

        "read_file" => {
            let path = args["path"]
                .as_str()
                .ok_or_else(|| anyhow!("read_file: missing path"))?;
            let full_path = resolve_existing_path_in_dir(base, path)?;
            info!("Reading file: {}", full_path.display());
            let content = std::fs::read_to_string(&full_path)
                .map_err(|e| anyhow!("Failed to read {}: {}", path, e))?;
            Ok(ToolResult::Continue(content))
        }

        "list_files" => {
            let pattern = args["pattern"].as_str().unwrap_or("**/*");
            // Validate and normalize the provided glob pattern so it cannot
            // escape `base` (reject absolute/prefix components) and so any
            // `..`/`.` components are resolved before we run the glob.
            let full_pattern = join_in_dir(base, pattern)?;
            info!("Listing files matching: {}", full_pattern.display());

            let ignored_dirs = super::IGNORED_DIRS;
            let matched_files = glob::glob(full_pattern.to_str().unwrap())
                .map_err(|e| anyhow!("Invalid glob pattern: {}", e))?
                .filter_map(|p| p.ok())
                .filter(|p| p.is_file())
                .collect::<Vec<_>>();

            let mut files: Vec<String> = Vec::new();
            let mut escaped_matches: Vec<String> = Vec::new();

            for p in matched_files {
                if ensure_path_under_base(base, &p).is_err() {
                    escaped_matches.push(p.display().to_string());
                    continue;
                }

                // Strip the normalized `base` so results are returned
                // relative to the same directory we validated above.
                let Some(rel) = p.strip_prefix(base).ok() else {
                    continue;
                };

                if let Some(Component::Normal(name)) = rel.components().next() {
                    if ignored_dirs.contains(&name.to_string_lossy().as_ref()) {
                        continue;
                    }
                }

                files.push(rel.to_string_lossy().to_string());
            }

            if !escaped_matches.is_empty() {
                let sample = escaped_matches
                    .iter()
                    .take(3)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ");

                return Err(anyhow!(
                    "list_files matched one or more files outside config_dir after symlink resolution. pattern='{}' config_dir='{}'. Example match(es): {}. Fix: narrow the pattern to files under config_dir and avoid symlink targets outside config_dir.",
                    pattern,
                    base.display(),
                    sample
                ));
            }

            debug!("Found {} files", files.len());
            Ok(ToolResult::Continue(files.join("\n")))
        }

        "edit_file" => {
            let path = args["path"]
                .as_str()
                .ok_or_else(|| anyhow!("edit_file: missing path"))?;
            let search = args["search"]
                .as_str()
                .ok_or_else(|| anyhow!("edit_file: missing search"))?;
            let replace = args["replace"]
                .as_str()
                .ok_or_else(|| anyhow!("edit_file: missing replace"))?;

            info!("Editing file: {}", path);
            apply_file_edits(
                base,
                &FileEdit {
                    path: path.to_string(),
                    search: search.to_string(),
                    replace: replace.to_string(),
                },
            )?;

            Ok(ToolResult::Edit(FileEdit {
                path: path.to_string(),
                search: search.to_string(),
                replace: replace.to_string(),
            }))
        }

        "build_check" => {
            let show_trace = args["show_trace"].as_bool().unwrap_or(false);
            info!(
                "Running build check for host: {}, show_trace: {}",
                host_attr, show_trace
            );

            // First make sure we have all new add-files
            crate::git::intent_add_untracked(config_dir).map_err(|e| {
                anyhow::anyhow!(
                    "Failed to register new files with git for flake visibility: {}",
                    e
                )
            })?;

            // Use nix build --dry-run to check without actually building
            let mut command = Command::new("nix");
            command
                .arg("build")
                .arg(format!(".#darwinConfigurations.{}.system", host_attr))
                .arg("--dry-run");

            if show_trace {
                command.arg("--show-trace");
            }

            let output = command
                .current_dir(config_dir)
                .env("PATH", crate::nix::get_nix_path())
                .env("NIX_CONFIG", "experimental-features = nix-command flakes")
                .output()?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            if output.status.success() {
                info!("Build check passed for host: {}", host_attr);
                Ok(ToolResult::BuildResult {
                    success: true,
                    output: format!("✓ Build check passed for '{}'", host_attr),
                    stdout: stdout.to_string(),
                    stderr: stderr.to_string(),
                })
            } else {
                error!("Build check failed for host: {}", host_attr);
                debug!("Build error output: stderr: {}, stdout: {}", stderr, stdout);
                Ok(ToolResult::BuildResult {
                    success: false,
                    output: format!(
                        "✗ Build check FAILED for '{}':\n\nTip: Re-run build_check with show_trace=true if you need additional debugging details.",
                        host_attr,
                    ),
                    stdout: stdout.to_string(),
                    stderr: stderr.to_string(),
                })
            }
        }

        "search_code" => {
            let pattern = args["pattern"]
                .as_str()
                .ok_or_else(|| anyhow!("search_code: missing pattern"))?;
            let file_pattern = args["file_pattern"].as_str();
            let output = execute_search_code(config_dir, pattern, file_pattern)?;
            Ok(ToolResult::Continue(output))
        }

        "search_packages" => {
            let query = args["query"]
                .as_str()
                .ok_or_else(|| anyhow!("search_packages: missing query"))?;
            // Clamp `limit` between 1 and 50 (default 20). Use as_i64 so negative
            // and crazy-large values provided by callers are handled gracefully.
            let limit = args["limit"].as_i64().unwrap_or(20).clamp(1, 50) as u64;
            let search_type = args["search_type"].as_str().unwrap_or("both");
            let use_regex = args["use_regex"].as_bool().unwrap_or(false);
            let channel = args["channel"].as_str().unwrap_or("nixpkgs");

            let result =
                execute_search_packages(config_dir, query, limit, search_type, use_regex, channel)?;
            Ok(ToolResult::Continue(result))
        }

        "done" => {
            let summary = args["summary"]
                .as_str()
                .unwrap_or("Changes complete")
                .to_string();
            info!("Agent signaled done: {}", summary);
            Ok(ToolResult::Done(summary))
        }

        _ => Err(anyhow!("Unknown tool: {}", name)),
    }
}

// Truncate string for logging (single line preview)
fn truncate_for_log(s: &str, max_len: usize) -> String {
    let s = s.replace('\n', " ").replace('\r', "");
    if s.len() <= max_len {
        s
    } else {
        format!("{}...", &s[..max_len])
    }
}
