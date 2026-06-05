//! Tools used by AI

use crate::evolve::edit_nix_file::{apply_semantic_edit, nix_quote_values};
use crate::evolve::ensure_secret::{execute_ensure_secret, EnsureSecretResult};
use crate::evolve::search_packages::SearchPackageResult;
use crate::evolve::types::{FileEditAction, SemanticFileEdit};
use crate::shared_types::FileEdit;

use super::file_ops::{
    apply_file_edits, ensure_path_under_base, join_in_dir, resolve_existing_path_in_dir,
};
use super::gitignore::is_ignored_by_matcher;
use super::messages::Tool;
use super::search_code::execute_search_code;
use super::search_docs::{
    default_limit as search_docs_default_limit, execute_search_docs,
    max_limit as search_docs_max_limit, DocsSource,
};
use super::search_packages::execute_search_packages;
use super::utils::normalize_relative_path;

use anyhow::{anyhow, Context, Result};
use ignore::gitignore::Gitignore;
use log::{debug, error, info};
use std::path::{Component, Path};

// =============================================================================
// Tool Definitions
// =============================================================================

/// Creates provider-agnostic tools
pub fn create_tools(banned_tools: &[&str]) -> Vec<Tool> {
    let search_docs_limit_description = format!(
        "Maximum results to return (default: {}, max: {})",
        search_docs_default_limit(),
        search_docs_max_limit()
    );

    let allowed_tools = vec![
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
                          (e.g., unmatched braces/brackets, unclosed strings). Ensure edits maintain valid syntax. \
                          IMPORTANT: Under .nixmac, only exact .nixmac/<module>/data.json files may be edited; all other files are reserved.".to_string(),
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
Use this tool whenever you need the agent to make structured edits to Nix config. `add` and `remove` operate on list-valued attributes such as `home.packages` or `environment.systemPackages`. For Homebrew list attributes (`homebrew.brews`, `homebrew.casks`, and `homebrew.taps`), pass raw package/token strings such as `"bat"`; the tool writes them as Nix string literals. `set` assigns a scalar value such as a boolean, string, number, or `null` to an attribute path like `services.tailscale.enable`. `set_attrs` creates or updates a Nix attribute set (object) at a given path and sets key-value pairs inside it, including nested JSON objects/arrays that map to nested Nix attrsets/lists. Use this for options like `system.defaults.dock` that take an attrset value. The tool understands Nix syntax and will modify existing assignments when possible, or insert a new assignment into the module body if missing.
Always: provide an `action` object with exactly one of `add`, `remove`, `set`, or `set_attrs`. After calling this tool, run `build_check` to verify changes.
IMPORTANT: Do not use this tool for files under .nixmac. Nix implementation files there are reserved for Nixmac; only exact .nixmac/<module>/data.json files may be edited with edit_file.
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
                                            "path": { "type": "string", "description": "Dot-separated attribute path (e.g. environment.systemPackages, home.packages, or homebrew.brews)" },
                                            "values": {
                                                "type": "array",
                                                "items": { "type": "string" },
                                                "description": "Values to add to the list. Use a one-element array for a single package. For homebrew.brews/casks/taps, pass raw package or token names; the tool quotes them as Nix strings."
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
                                                "description": "Values to remove from the list. Use a one-element array for a single package. For homebrew.brews/casks/taps, pass raw package or token names; the tool matches their Nix string literal form."
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
                         wrapper around 'nix search' that returns a list of structured JSON results. \
                         Output format: Array of SearchPackageResult objects, each containing \
                         {\"name\": string, \"attrPath\": string, \"version\": string, \"description\": string, \"channel\": string, \"installTarget\": SearchResultInstallTarget, \"additionalInfo\": string?}. \
                         The installTarget field indicates whether a package should be installed via Homebrew (Homebrew), \
                         Nix (System), either (Either), or not at all (None or UnavailableOnHostPlatform). \
                         The additionalInfo field is an optional string containing any other relevant clues for how to install the package. IMPORTANT: When making nix package edits later, try to respect \
                         1) any expressed user preference, followed by 2) the installTarget value to guide installation method recommendations. \
                         Example: [{\"name\": \"wget\", \"attrPath\": \"wget\", \"version\": \"1.21.3\", \"description\": \"retrieves files from the web\", \"channel\": \"nixpkgs-unstable\", \"installTarget\": \"System\"}]. \
                         Parameters: \
                         useRegex enables regex patterns for advanced matching; \
                         channels lets you search in different flakes (one or more of nixpkgs, nixpkgs-unstable, etc.), max 5".to_string(),
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
                    "use_regex": {
                        "type": "boolean",
                        "description": "Whether to interpret query as a regex pattern (default: false). Use for complex patterns like 'python[0-9]+'"
                    },
                    "channels": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        },
                        "description": "Flake/channels to search in: list of 'nixpkgs' (default), 'nixpkgs-unstable', 'nixpkgs-master', etc."
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
                        "description": search_docs_limit_description
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
            name: "ensure_secret".to_string(),
            description: "Create and wire a SOPS-managed secret end-to-end without exposing plaintext to the agent. \
                         This tool ensures an age key exists, maintains SOPS config, creates/initializes an encrypted \
                         secret file under secrets/<name>.yaml, launches a blocking `sops <file>` editor session for \
                         user input, then optionally injects secret path wiring into Nix config. \
                         You can optionally provide a `scaffold` to prefill non-sensitive placeholder structure \
                         (for example env-file keys or YAML map keys) before the editor opens. \
                         IMPORTANT: Injection targets under .nixmac are rejected; agents may only edit exact .nixmac/<module>/data.json files via edit_file.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Secret name used for both secrets/<name>.yaml and /run/secrets/<name>"
                    },
                    "inject": {
                        "type": "object",
                        "description": "Optional Nix injection mapping with explicit file path and attribute path.",
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": ["nix_env", "nix_file", "service_binding"]
                            },
                            "file": {
                                "type": "string",
                                "description": "Relative path to the nix file to edit. Example: modules/darwin/services.nix"
                            },
                            "target": {
                                "type": "string",
                                "description": "Dot-separated target attribute path in the selected file. Example: services.github.tokenFile"
                            }
                        },
                        "required": ["type", "file", "target"],
                        "additionalProperties": false
                    },
                    "scaffold": {
                        "type": "object",
                        "description": "Optional skeleton for first-time secret file initialization. If the file already exists, it is left unchanged.",
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": ["raw", "raw_yaml", "raw-yaml", "envFile", "env_file", "env-file", "yamlMap", "yaml_map", "yaml-map"],
                                "description": "Skeleton strategy. `env_file` renders value: | with KEY= lines. `yaml_map` renders KEY: \"\" entries. `raw` creates an empty placeholder."
                            },
                            "keys": {
                                "type": "array",
                                "items": { "type": "string" },
                                "description": "Optional key names used by env_file/yaml_map scaffold types"
                            }
                        },
                        "additionalProperties": false
                    }
                },
                "required": ["name"],
                "additionalProperties": false
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
    ];

    allowed_tools
        .into_iter()
        .filter(|tool| !banned_tools.contains(&tool.name.as_str()))
        .collect()
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
            let normalized_rel = normalize_relative_path(Path::new(path))?;
            if is_ignored_by_matcher(gitignore_matcher, &normalized_rel, false) {
                return Err(anyhow!(
                    "read_file: '{}' is ignored by .gitignore in git repository at '{}'",
                    path,
                    repo_root.display()
                ));
            }

            let full_path = resolve_existing_path_in_dir(repo_root, path)?;
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
            let full_pattern = join_in_dir(repo_root, pattern)?;
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
                if ensure_path_under_base(repo_root, &p).is_err() {
                    escaped_matches.push(p.display().to_string());
                    continue;
                }

                // Strip the normalized `base` so results are returned
                // relative to the same directory we validated above.
                let Some(rel) = p.strip_prefix(repo_root).ok() else {
                    continue;
                };

                if let Some(Component::Normal(name)) = rel.components().next() {
                    if ignored_dirs.contains(&name.to_string_lossy().as_ref()) {
                        continue;
                    }
                }

                if is_ignored_by_matcher(gitignore_matcher, rel, false) {
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

        "edit_file" => {
            let path = args["path"]
                .as_str()
                .ok_or_else(|| anyhow!("edit_file: missing path"))?;
            ensure_nixmac_edit_allowed("edit_file", path)?;
            let search = args["search"]
                .as_str()
                .ok_or_else(|| anyhow!("edit_file: missing search"))?;
            let replace = args["replace"]
                .as_str()
                .ok_or_else(|| anyhow!("edit_file: missing replace"))?;

            info!("Editing file: {}", path);
            apply_file_edits(
                repo_root,
                &FileEdit {
                    path: path.to_string(),
                    search: search.to_string(),
                    replace: replace.to_string(),
                },
                gitignore_matcher,
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
            ensure_nixmac_edit_allowed("edit_nix_file", path)?;

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

            // Require exactly one discriminant to avoid ambiguous ordering (e.g. simultaneous add+remove).
            // TODO: Allow multiple actions per call once ordering semantics are defined.
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
                let values = quote_homebrew_list_values(
                    attr_path,
                    parse_values(&add_obj["values"], "edit_nix_file.add")?,
                );
                FileEditAction::Add {
                    path: attr_path.to_string(),
                    values,
                }
            } else if action_val.get("remove").is_some() {
                let rem_obj = &action_val["remove"];
                let attr_path = rem_obj["path"]
                    .as_str()
                    .ok_or_else(|| anyhow!("edit_nix_file.remove: missing path"))?;
                let values = quote_homebrew_list_values(
                    attr_path,
                    parse_values(&rem_obj["values"], "edit_nix_file.remove")?,
                );
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
                repo_root,
                &SemanticFileEdit {
                    path: path.to_string(),
                    action: action.clone(),
                },
                gitignore_matcher,
            )?;

            Ok(ToolResult::EditSemantic(SemanticFileEdit {
                path: path.to_string(),
                action,
            }))
        }
        "build_check" => {
            let show_trace = args["show_trace"].as_bool().unwrap_or(false);
            info!(
                "Running build check for host: {}, show_trace: {}, config_dir: {}",
                host_attr, show_trace, config_dir
            );

            let (passed, stdout, stderr) =
                crate::rebuild::dry_run_build_check(config_dir, host_attr, show_trace)?;

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
            let output = execute_search_code(repo_root, pattern, file_pattern, gitignore_matcher)?;
            Ok(ToolResult::Continue(output))
        }

        "search_packages" => {
            let query = args["query"]
                .as_str()
                .ok_or_else(|| anyhow!("search_packages: missing query"))?;
            // Clamp `limit` between 1 and 50 (default 20). Use as_i64 so negative
            // and crazy-large values provided by callers are handled gracefully.
            let limit = args["limit"].as_i64().unwrap_or(20).clamp(1, 50) as u64;
            let use_regex = args["use_regex"].as_bool().unwrap_or(false);

            // Clamp to at most 5 channels to prevent abuse since each channel adds latency
            // and we don't want to encourage broad searches across many channels.
            let channels = args["channels"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| vec!["nixpkgs".to_string()]);
            let channels = channels.into_iter().take(5).collect::<Vec<_>>();

            // If channels is empty after filtering, default to ["nixpkgs"] to ensure we search something.
            let channels = if channels.is_empty() {
                vec!["nixpkgs".to_string()]
            } else {
                channels
            };

            let result = execute_search_packages(config_dir, query, limit, use_regex, &channels)?;
            Ok(ToolResult::SearchPackages(result))
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

        "ensure_secret" => {
            // Only Nix injection targets need the .nixmac guard; secret files are written under secrets/.
            if let Some(inject_file) = args
                .get("inject")
                .and_then(|inject| inject.get("file"))
                .and_then(|file| file.as_str())
            {
                ensure_nixmac_edit_allowed("ensure_secret", inject_file)?;
            }

            let result = execute_ensure_secret(repo_root, args, gitignore_matcher)?;
            Ok(ToolResult::EnsureSecret(result))
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

fn is_homebrew_list_path(path: &str) -> bool {
    matches!(
        path.trim(),
        "homebrew.brews" | "homebrew.casks" | "homebrew.taps"
    )
}

fn quote_homebrew_list_values(path: &str, values: Vec<String>) -> Vec<String> {
    if is_homebrew_list_path(path) {
        nix_quote_values(&values)
    } else {
        values
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

fn ensure_nixmac_edit_allowed(tool: &str, path: &str) -> Result<()> {
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
    use super::{execute_tool, ToolResult};
    use crate::evolve::gitignore::load_gitignore_matcher;
    use serde_json::json;
    use std::fs;
    use tempfile::tempdir;

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
