//! Tools used by AI

use crate::evolve::edit_nix_file::apply_semantic_edit;
use crate::evolve::types::{FileEditAction, SemanticFileEdit};

use super::file_ops::{
    apply_file_edits, ensure_path_under_base, join_in_dir, resolve_existing_path_in_dir,
};
use super::messages::Tool;
use super::search_code::execute_search_code;
use super::search_docs::{
    default_limit as search_docs_default_limit, execute_search_docs, DocsSource,
};
use super::search_packages::execute_search_packages;
use super::types::FileEdit;

use anyhow::{anyhow, Context, Result};
use log::{debug, error, info};
use std::path::{Component, Path};

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
                         unique in the file. For creating a new file or replacing an entire file, \
                         use empty search string. \
                         IMPORTANT: Always provide complete, production-ready code - never use \
                         placeholders, TODOs, or abbreviated implementations. \
                         NOTE: For .nix, .yaml, and .yml files, the edit will be rejected if syntax is invalid \
                         (e.g., unmatched braces/brackets, unclosed strings). Ensure edits maintain valid syntax.".to_string(),
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
            name: "edit_nix_file".to_string(),
            description: r#"Edit a Nix file with semantic operations using attribute-path Add/Remove/Set/SetAttrs actions.
Use this tool whenever you need the agent to make structured edits to Nix config. `add` and `remove` operate on list-valued attributes such as `home.packages` or `environment.systemPackages`. `set` assigns a scalar value such as a boolean, string, number, or `null` to an attribute path like `services.tailscale.enable`. `set_attrs` creates or updates a Nix attribute set (object) at a given path and sets key-value pairs inside it, including nested JSON objects/arrays that map to nested Nix attrsets/lists. Use this for options like `system.defaults.dock` that take an attrset value. The tool understands Nix syntax and will modify existing assignments when possible, or insert a new assignment into the module body if missing.
Always: provide an `action` object with exactly one of `add`, `remove`, `set`, or `set_attrs`. After calling this tool, run `build_check` to verify changes.
IMPORTANT: The generated Nix code is syntax-validated before writing. Edits with syntax errors (unmatched braces/brackets, unclosed strings, etc) will be rejected. Ensure all generated code is syntactically complete and correct."#.to_string(),            parameters: serde_json::json!({
                "type": "object",
                "$defs": {
                    "jsonValue": {
                        "oneOf": [
                            { "type": "boolean" },
                            { "type": "string" },
                            { "type": "number" },
                            { "type": "integer" },
                            { "type": "null" },
                            {
                                "type": "array",
                                "items": { "$ref": "#/$defs/jsonValue" }
                            },
                            {
                                "type": "object",
                                "additionalProperties": { "$ref": "#/$defs/jsonValue" }
                            }
                        ]
                    }
                },
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to the nix file to edit"
                    },
                    "action": {
                        "type": "object",
                        "oneOf": [
                            {
                                "type": "object",
                                "properties": {
                                    "add": {
                                        "type": "object",
                                        "properties": {
                                            "path": { "type": "string", "description": "Dot-separated attribute path (e.g. environment.systemPackages or home.packages)" },
                                            "values": {
                                                "type": "array",
                                                "items": { "type": "string" },
                                                "description": "Values to add to the list. Use a one-element array for a single package."
                                            }
                                        },
                                        "required": ["path", "values"],
                                        "additionalProperties": false
                                    }
                                },
                                "required": ["add"],
                                "additionalProperties": false
                            },
                            {
                                "type": "object",
                                "properties": {
                                    "remove": {
                                        "type": "object",
                                        "properties": {
                                            "path": { "type": "string", "description": "Dot-separated attribute path to remove from" },
                                            "values": {
                                                "type": "array",
                                                "items": { "type": "string" },
                                                "description": "Values to remove from the list. Use a one-element array for a single package."
                                            }
                                        },
                                        "required": ["path", "values"],
                                        "additionalProperties": false
                                    }
                                },
                                "required": ["remove"],
                                "additionalProperties": false
                            },
                            {
                                "type": "object",
                                "properties": {
                                    "set": {
                                        "type": "object",
                                        "properties": {
                                            "path": { "type": "string", "description": "Dot-separated attribute path to set (e.g. services.tailscale.enable)" },
                                            "value": {
                                                "description": "Scalar JSON value to assign. Supports booleans, strings, numbers, and null.",
                                                "oneOf": [
                                                    { "type": "boolean" },
                                                    { "type": "string" },
                                                    { "type": "number" },
                                                    { "type": "integer" },
                                                    { "type": "null" }
                                                ]
                                            }
                                        },
                                        "required": ["path", "value"],
                                        "additionalProperties": false
                                    }
                                },
                                "required": ["set"],
                                "additionalProperties": false
                            },
                            {
                                "type": "object",
                                "properties": {
                                    "set_attrs": {
                                        "type": "object",
                                        "properties": {
                                            "path": { "type": "string", "description": "Dot-separated attribute path of the attrset to create or update (e.g. system.defaults.dock)" },
                                            "attrs": {
                                                "type": "object",
                                                "description": "Key-value pairs to set inside the attrset. Values may be scalars, arrays, or nested objects.",
                                                "additionalProperties": {
                                                    "$ref": "#/$defs/jsonValue"
                                                }
                                            }
                                        },
                                        "required": ["path", "attrs"],
                                        "additionalProperties": false
                                    }
                                },
                                "required": ["set_attrs"],
                                "additionalProperties": false
                            }
                        ],
                        "description": "The specific edit action to perform on the nix file (object with one of `add`, `remove`, `set`, or `set_attrs`)",
                    }
                },
                "required": ["path", "action"]
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
            name: "search_docs".to_string(),
            description: "Search nix-darwin and home-manager configuration option docs by structure-aware scoring. \
                         Use this tool to discover the correct fully-qualified option path shape \
                         (for example: `homebrew.caskArgs.colorpickerdir` for nix-darwin, or \
                         `programs.git.signing` for home-manager). \
                         Returns top matches with option paths and concise summaries. \
                         Use the 'source' parameter to narrow results to a specific doc set.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query for option names or path segments"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum results to return (default: 3, max: 10)"
                    },
                    "source": {
                        "type": "string",
                        "enum": ["nix-darwin", "home-manager", "all"],
                        "description": "Which doc set to search: 'nix-darwin', 'home-manager', or 'all' (default: 'all')"
                    }
                },
                "required": ["query"]
            }),
        },
        Tool {
            name: "ask_user".to_string(),
            description: "Ask the user a question and wait for their response. Use this when you \
                         need clarification, want to confirm a destructive action, or need the user \
                         to choose between options. The question should be clear and specific. \
                         Optionally provide a list of choices for the user to pick from.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The question to ask the user"
                    },
                    "choices": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional list of choices for the user to pick from"
                    }
                },
                "required": ["question"]
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
    Think {
        category: String,
        thought: String,
    },
    EditSemantic(SemanticFileEdit),
    /// Agent wants to ask the user a question
    Question {
        question: String,
        choices: Option<Vec<String>>,
    },
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
            )
            .with_context(|| {
                format!(
                    "edit_file failed for path='{}' (search_len={}, replace_len={})",
                    path,
                    search.len(),
                    replace.len(),
                )
            })?;

            Ok(ToolResult::Edit(FileEdit {
                path: path.to_string(),
                search: search.to_string(),
                replace: replace.to_string(),
            }))
        }

        "edit_nix_file" => {
            let path = args["path"]
                .as_str()
                .ok_or_else(|| anyhow!("edit_nix_file: missing path"))?;

            // Expect `action` to be an object like { "add": { "path": "a.b", "values": ["v"] } }
            let action_val = &args["action"];
            if !action_val.is_object() {
                return Err(anyhow!("edit_nix_file: action must be an object"));
            }

            let parse_values = |value: &serde_json::Value, context: &str| -> Result<Vec<String>> {
                let values = value
                    .as_array()
                    .ok_or_else(|| anyhow!("{}: missing values array", context))?;

                if values.is_empty() {
                    return Err(anyhow!("{}: values array must not be empty", context));
                }

                values
                    .iter()
                    .map(|item| {
                        item.as_str()
                            .map(str::to_string)
                            .ok_or_else(|| anyhow!("{}: values must be strings", context))
                    })
                    .collect()
            };

            // Determine add/remove/set/set_attrs; require exactly one discriminant to avoid ambiguity
            // TODO: We could consider allowing multiple actions in one call (e.g. add and remove together for a package rename)
            // if we can handle the ordering correctly, but for now let's keep it simple with one action per call.
            let has_add = action_val.get("add").is_some();
            let has_remove = action_val.get("remove").is_some();
            let has_set = action_val.get("set").is_some();
            let has_set_attrs = action_val.get("set_attrs").is_some();

            let present_count =
                (has_add as u8) + (has_remove as u8) + (has_set as u8) + (has_set_attrs as u8);
            if present_count != 1 {
                return Err(anyhow!(
                    "edit_nix_file: action must contain exactly one of 'add', 'remove', 'set', or 'set_attrs'"
                ));
            }

            let action = if has_add {
                let add_obj = &action_val["add"];
                let attr_path = add_obj["path"]
                    .as_str()
                    .ok_or_else(|| anyhow!("edit_nix_file.add: missing path"))?;
                let values = parse_values(&add_obj["values"], "edit_nix_file.add")?;
                FileEditAction::Add {
                    path: attr_path.to_string(),
                    values,
                }
            } else if action_val.get("remove").is_some() {
                let rem_obj = &action_val["remove"];
                let attr_path = rem_obj["path"]
                    .as_str()
                    .ok_or_else(|| anyhow!("edit_nix_file.remove: missing path"))?;
                let values = parse_values(&rem_obj["values"], "edit_nix_file.remove")?;
                FileEditAction::Remove {
                    path: attr_path.to_string(),
                    values,
                }
            } else if action_val.get("set").is_some() {
                let set_obj = &action_val["set"];
                let attr_path = set_obj["path"]
                    .as_str()
                    .ok_or_else(|| anyhow!("edit_nix_file.set: missing path"))?;
                let value = set_obj
                    .get("value")
                    .ok_or_else(|| anyhow!("edit_nix_file.set: missing value"))?
                    .clone();

                match value {
                    serde_json::Value::Bool(_)
                    | serde_json::Value::String(_)
                    | serde_json::Value::Number(_)
                    | serde_json::Value::Null => {}
                    _ => {
                        return Err(anyhow!(
                            "edit_nix_file.set: value must be a scalar JSON value"
                        ));
                    }
                }

                FileEditAction::Set {
                    path: attr_path.to_string(),
                    value,
                }
            } else if has_set_attrs {
                let set_attrs_obj = &action_val["set_attrs"];
                let attr_path = set_attrs_obj["path"]
                    .as_str()
                    .ok_or_else(|| anyhow!("edit_nix_file.set_attrs: missing path"))?;
                let attrs_val = set_attrs_obj
                    .get("attrs")
                    .ok_or_else(|| anyhow!("edit_nix_file.set_attrs: missing attrs"))?;
                let attrs_map = attrs_val
                    .as_object()
                    .ok_or_else(|| anyhow!("edit_nix_file.set_attrs: attrs must be an object"))?;
                FileEditAction::SetAttrs {
                    path: attr_path.to_string(),
                    attrs: attrs_map.clone(),
                }
            } else {
                return Err(anyhow!("Unsupported edit_nix_file action object"));
            };

            apply_semantic_edit(
                base,
                &SemanticFileEdit {
                    path: path.to_string(),
                    action: action.clone(),
                },
            )?;

            Ok(ToolResult::EditSemantic(SemanticFileEdit {
                path: path.to_string(),
                action,
            }))
        }
        "build_check" => {
            let show_trace = args["show_trace"].as_bool().unwrap_or(false);
            info!(
                "Running build check for host: {}, show_trace: {}",
                host_attr, show_trace
            );

            let (passed, stdout, stderr) =
                crate::darwin::dry_run_build_check(config_dir, host_attr, show_trace)?;

            if passed {
                info!("Build check passed for host: {}", host_attr);
                Ok(ToolResult::BuildResult {
                    success: true,
                    output: format!("✓ Build check passed for '{}'", host_attr),
                    stdout,
                    stderr,
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
                    stdout,
                    stderr,
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

        "search_docs" => {
            let query = args["query"]
                .as_str()
                .ok_or_else(|| anyhow!("search_docs: missing query"))?;
            let limit = args["limit"]
                .as_u64()
                .map(|n| n as usize)
                .unwrap_or_else(search_docs_default_limit)
                .clamp(1, 10);
            let source_filter = args["source"].as_str().and_then(DocsSource::from_filter);

            let result = execute_search_docs(query, limit, source_filter)?;
            Ok(ToolResult::Continue(result))
        }

        "ask_user" => {
            let question = args["question"]
                .as_str()
                .ok_or_else(|| anyhow!("ask_user: missing question"))?
                .to_string();
            let choices = args["choices"].as_array().map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            });

            info!("❓ Agent asking user: {}", question);
            Ok(ToolResult::Question { question, choices })
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

/// Helper to determine if a tool is an editing tool, i.e. it
/// makes changes to the nix config that count as "edits" in the
/// evolution process and should be tracked as such.
pub fn is_editing_tool(name: &str) -> bool {
    matches!(name, "edit_file" | "edit_nix_file")
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

#[cfg(test)]
mod tests {
    use super::is_editing_tool;

    #[test]
    fn returns_true_for_editing_tools() {
        assert!(is_editing_tool("edit_file"));
        assert!(is_editing_tool("edit_nix_file"));
    }

    #[test]
    fn returns_false_for_non_editing_tools() {
        assert!(!is_editing_tool("read_file"));
        assert!(!is_editing_tool("list_files"));
        assert!(!is_editing_tool("build_check"));
        assert!(!is_editing_tool("done"));
        assert!(!is_editing_tool(""));
    }
}
