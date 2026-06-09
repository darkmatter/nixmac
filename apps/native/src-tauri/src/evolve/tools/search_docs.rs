//! `search_docs` tool: two-step nix-darwin/home-manager option docs lookup.

use anyhow::{Result, anyhow};

use crate::evolve::messages::Tool;
use crate::evolve::search_docs::{DocsSource, default_limit, execute_search_docs, max_limit};

use super::{ToolCtx, ToolResult};

pub(crate) fn definition() -> Tool {
    let limit_description = format!(
        "Maximum results to return (default: {}, max: {})",
        default_limit(),
        max_limit()
    );

    Tool {
        name: "search_docs".to_string(),
        description: "Search nix-darwin and home-manager configuration option docs in two cheap steps. \
                     Step 1 (discover): call with `query` to get a compact ranked list of doc keys \
                     (markdown filenames like `home-manager/programs/git.md` or `nix-darwin/homebrew.md`) \
                     with option counts — no per-option summaries, so it costs few tokens. \
                     Step 2 (read): call with `path` set to one of those doc keys to get the flat table \
                     of every option in that doc (fully-qualified dotted path, type, and summary). \
                     Big categories `programs` and `services` are split per-subcategory \
                     (e.g. `nix-darwin/services/nginx.md`). \
                     Use the 'source' parameter to narrow to a specific doc set.".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Discovery query: matches option names, path segments, and doc keys/filenames. Returns matching doc keys. Omit when reading a doc via `path`."
                },
                "path": {
                    "type": "string",
                    "description": "A doc key from a prior query (e.g. `home-manager/programs/git.md`). When set, returns that doc's full option table instead of searching."
                },
                "limit": {
                    "type": "integer",
                    "description": limit_description
                },
                "source": {
                    "type": "string",
                    "enum": ["nix-darwin", "home-manager", "all"],
                    "description": "Which doc set to search: 'nix-darwin', 'home-manager', or 'all' (default: 'all')"
                }
            },
            "required": []
        }),
    }
}

pub(crate) fn execute(ctx: &ToolCtx) -> Result<ToolResult> {
    let args = ctx.args;
    let query = args["query"].as_str().unwrap_or("");
    let doc_path = args["path"].as_str().filter(|p| !p.trim().is_empty());
    if query.trim().is_empty() && doc_path.is_none() {
        return Err(anyhow!("search_docs: provide a `query` or a `path`"));
    }
    let limit = args["limit"]
        .as_u64()
        .map(|n| n as usize)
        .unwrap_or_else(default_limit)
        .clamp(1, max_limit());
    let source_filter = args["source"].as_str().and_then(DocsSource::from_filter);

    let result = execute_search_docs(query, doc_path, limit, source_filter)?;
    Ok(ToolResult::Continue(result))
}
