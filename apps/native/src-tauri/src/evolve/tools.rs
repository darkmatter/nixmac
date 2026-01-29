//! Tools used by AI

use super::file_ops::apply_file_edits;
use super::messages::Tool;
use super::types::FileEdit;

use anyhow::{anyhow, Result};
use log::{debug, error, info};
use std::path::Path;
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
                         'verification' for checking your work. Thorough thinking leads to better results."
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
                        "description": "The thought content - be detailed and thorough"
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
                    "host": {
                        "type": "string",
                        "description": "The host configuration to check (e.g., 'macbook')"
                    }
                },
                "required": ["host"]
            }),
        },
        Tool {
            name: "run_command".to_string(),
            description: "Run a shell command in the config directory. Use sparingly - prefer \
                         specific tools when available. Useful for checking nix syntax, \
                         searching code, or other exploratory commands.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Shell command to run"
                    }
                },
                "required": ["command"]
            }),
        },
        Tool {
            name: "search_code".to_string(),
            description: "Search for text patterns in the codebase using ripgrep. \
                         This helps locate where functions or variables are defined or used.".to_string(),
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
    /// Build check result (success, output)
    BuildResult { success: bool, output: String },
    /// Agent thinking/reasoning (category, content)
    Think { category: String, thought: String },
}

/// Execute a tool call and return the result
pub fn execute_tool(config_dir: &str, name: &str, args: &serde_json::Value) -> Result<ToolResult> {
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
            let full_path = Path::new(config_dir).join(path);
            info!("Reading file: {}", full_path.display());
            let content = std::fs::read_to_string(&full_path)
                .map_err(|e| anyhow!("Failed to read {}: {}", path, e))?;
            debug!("Read {} bytes from {}", content.len(), path);
            Ok(ToolResult::Continue(content))
        }

        "list_files" => {
            let pattern = args["pattern"].as_str().unwrap_or("**/*");
            let full_pattern = Path::new(config_dir).join(pattern);
            info!("Listing files matching: {}", full_pattern.display());

            let files: Vec<String> = glob::glob(full_pattern.to_str().unwrap())
                .map_err(|e| anyhow!("Invalid glob pattern: {}", e))?
                .filter_map(|p| p.ok())
                .filter(|p| p.is_file())
                .filter_map(|p| {
                    p.strip_prefix(config_dir)
                        .ok()
                        .map(|rel| rel.to_string_lossy().to_string())
                })
                .collect();

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
                config_dir,
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
            let host = args["host"]
                .as_str()
                .ok_or_else(|| anyhow!("build_check: missing host"))?;

            info!("Running build check for host: {}", host);

            // Use nix build --dry-run to check without actually building
            let output = Command::new("nix")
                .args([
                    "build",
                    &format!(".#darwinConfigurations.{}.system", host),
                    "--dry-run",
                    "--show-trace",
                ])
                .current_dir(config_dir)
                .env("PATH", crate::nix::get_nix_path())
                .env("NIX_CONFIG", "experimental-features = nix-command flakes")
                .output()?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let combined = format!("{}\n{}", stdout, stderr);

            if output.status.success() {
                info!("Build check passed for host: {}", host);
                Ok(ToolResult::BuildResult {
                    success: true,
                    output: format!("✓ Build check passed for '{}'", host),
                })
            } else {
                error!("Build check failed for host: {}", host);
                debug!("Build error output: {}", combined);
                Ok(ToolResult::BuildResult {
                    success: false,
                    output: format!(
                        "✗ Build check FAILED for '{}':\n\n{}",
                        host,
                        truncate_error(&combined, 4000)
                    ),
                })
            }
        }

        "run_command" => {
            let command = args["command"]
                .as_str()
                .ok_or_else(|| anyhow!("run_command: missing command"))?;

            info!("Running command: {}", command);

            let output = Command::new("sh")
                .args(["-c", command])
                .current_dir(config_dir)
                .env("PATH", crate::nix::get_nix_path())
                .output()?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let exit_code = output.status.code().unwrap_or(-1);

            let result = format!(
                "Exit code: {}\n\nSTDOUT:\n{}\n\nSTDERR:\n{}",
                exit_code, stdout, stderr
            );

            Ok(ToolResult::Continue(truncate_error(&result, 8000)))
        }

        "search_code" => {
            let pattern = args["pattern"]
                .as_str()
                .ok_or_else(|| anyhow!("search_code: missing pattern"))?;
            let file_pattern = args["file_pattern"].as_str();

            info!("Searching for pattern: {}", pattern);

            let mut cmd = Command::new("rg");
            cmd.args(["--line-number", "--no-heading", pattern]);

            if let Some(fp) = file_pattern {
                cmd.args(["--glob", fp]);
            }

            let output = cmd.current_dir(config_dir).output();

            match output {
                Ok(out) => {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    if stdout.is_empty() {
                        Ok(ToolResult::Continue("No matches found.".to_string()))
                    } else {
                        Ok(ToolResult::Continue(truncate_error(&stdout, 8000)))
                    }
                }
                Err(_) => {
                    // Fallback to grep if rg not available
                    let output = Command::new("grep")
                        .args(["-rn", pattern, "."])
                        .current_dir(config_dir)
                        .output()?;
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    Ok(ToolResult::Continue(truncate_error(&stdout, 8000)))
                }
            }
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

/// Truncate error output to a maximum length, keeping the most relevant parts
fn truncate_error(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        return s.to_string();
    }

    // Keep the beginning and end, which usually have the most relevant info
    let half = max_len / 2;
    let start = &s[..half];
    let end = &s[s.len() - half..];

    format!(
        "{}\n\n... [truncated {} bytes] ...\n\n{}",
        start,
        s.len() - max_len,
        end
    )
}

/// Truncate string for logging (single line preview)
fn truncate_for_log(s: &str, max_len: usize) -> String {
    let s = s.replace('\n', " ").replace('\r', "");
    if s.len() <= max_len {
        s
    } else {
        format!("{}...", &s[..max_len])
    }
}
