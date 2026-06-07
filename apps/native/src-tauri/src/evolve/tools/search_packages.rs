//! `search_packages` tool: wrapper around `nix search`.

use anyhow::{anyhow, Result};

use crate::evolve::messages::Tool;
use crate::evolve::search_packages::execute_search_packages;

use super::{ToolCtx, ToolResult};

pub(crate) fn definition() -> Tool {
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
    }
}

pub(crate) fn execute(ctx: &ToolCtx) -> Result<ToolResult> {
    let args = ctx.args;
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

    let result = execute_search_packages(ctx.config_dir, query, limit, use_regex, &channels)?;
    Ok(ToolResult::SearchPackages(result))
}
