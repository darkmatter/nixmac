//! `read_file` tool: read a file's contents (gitignore-aware).
//!
//! Default reads return a tree-sitter structural outline via `pi-ast` when the
//! language is recognized and bodies can be elided. Pass `full=true` or a
//! `line_start`/`line_end` range for verbatim content.

use anyhow::{Result, anyhow};
use log::info;
use pi_ast::summary::{SummaryOptions, SummaryResult, summarize_code};
use std::path::Path;

use crate::evolve::file_ops::resolve_existing_path_in_dir;
use crate::evolve::gitignore::is_path_ignored;
use crate::evolve::messages::Tool;
use crate::evolve::utils::normalize_relative_path;

use super::{ToolCtx, ToolResult};

pub(crate) fn definition() -> Tool {
    Tool {
        name: "read_file".to_string(),
        description: "Read a file under the config repo. By default returns a structural outline \
             (signatures/structure kept, large bodies elided) to save tokens. Pass full=true for \
             the entire file, or line_start/line_end (1-based, inclusive) for a verbatim range. \
             Always inspect relevant files before editing."
            .to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path to the file"
                },
                "full": {
                    "type": "boolean",
                    "description": "If true, return the entire file verbatim (no outline)."
                },
                "line_start": {
                    "type": "integer",
                    "description": "1-based inclusive start line for a verbatim slice (requires line_end)."
                },
                "line_end": {
                    "type": "integer",
                    "description": "1-based inclusive end line for a verbatim slice (requires line_start)."
                }
            },
            "required": ["path"]
        }),
    }
}

pub(crate) fn execute(ctx: &ToolCtx) -> Result<ToolResult> {
    let path = ctx.args["path"]
        .as_str()
        .ok_or_else(|| anyhow!("read_file: missing path"))?;
    let normalized_rel = normalize_relative_path(Path::new(path))?;
    if is_path_ignored(ctx.gitignore_matcher, &normalized_rel)? {
        return Err(anyhow!(
            "read_file: '{}' is ignored by .gitignore in git repository at '{}'",
            path,
            ctx.repo_root.display()
        ));
    }

    if let Some(nixmac_ignore) = &ctx.nixmac_ignore_matcher
        && nixmac_ignore.is_ignored(&normalized_rel, false)
    {
        return Err(anyhow!(
            "read_file: '{}' is ignored by .nixmac in git repository at '{}'",
            path,
            ctx.repo_root.display()
        ));
    }

    let full_path = resolve_existing_path_in_dir(ctx.repo_root, path)?;
    info!("Reading file: {}", full_path.display());
    let content = std::fs::read_to_string(&full_path)
        .map_err(|e| anyhow!("Failed to read {}: {}", path, e))?;

    let want_full = ctx.args["full"].as_bool().unwrap_or(false);
    let line_start = ctx.args.get("line_start").and_then(|v| v.as_u64());
    let line_end = ctx.args.get("line_end").and_then(|v| v.as_u64());

    match (line_start, line_end) {
        (Some(start), Some(end)) => {
            let sliced = slice_lines(&content, start, end)?;
            Ok(ToolResult::Continue(sliced))
        }
        (None, None) if want_full => Ok(ToolResult::Continue(content)),
        (None, None) => Ok(ToolResult::Continue(outline_or_full(&content, path))),
        _ => Err(anyhow!(
            "read_file: line_start and line_end must both be provided for a line range"
        )),
    }
}

fn outline_or_full(content: &str, path: &str) -> String {
    // unfold_until_lines = 0 keeps outermost bodies folded (max compression).
    // Agents expand with full=true or a line range when they need verbatim text.
    let summary = match summarize_code(SummaryOptions {
        code: content.to_string(),
        lang: None,
        path: Some(path.to_string()),
        min_body_lines: None,
        min_comment_lines: None,
        unfold_until_lines: None,
        unfold_limit_lines: None,
    }) {
        Ok(summary) => summary,
        Err(err) => {
            log::warn!(
                "read_file: outline failed for '{}': {:#}; returning full file",
                path,
                err
            );
            return content.to_string();
        }
    };

    if !summary.parsed || !summary.elided {
        return content.to_string();
    }

    format_outline(path, &summary)
}

fn format_outline(path: &str, summary: &SummaryResult) -> String {
    let rendered = render_summary_segments(summary);
    let lang = summary.language.as_deref().unwrap_or("unknown");
    format!(
        "[summarized outline of `{path}` — {lines} lines, language={lang}; large bodies elided. \
Re-read with full=true for the entire file, or line_start/line_end for a verbatim range.]\n\n{rendered}",
        lines = summary.total_lines,
    )
}

fn render_summary_segments(summary: &SummaryResult) -> String {
    summary
        .segments
        .iter()
        .map(|segment| match segment.kind.as_str() {
            "kept" => segment.text.clone().unwrap_or_default(),
            _ => format!("... (lines {}–{})", segment.start_line, segment.end_line),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// 1-based inclusive line slice. Empty files and out-of-range bounds error.
fn slice_lines(content: &str, line_start: u64, line_end: u64) -> Result<String> {
    if line_start == 0 || line_end == 0 {
        return Err(anyhow!(
            "read_file: line_start and line_end must be 1-based (got {line_start}..{line_end})"
        ));
    }
    if line_end < line_start {
        return Err(anyhow!(
            "read_file: line_end ({line_end}) must be >= line_start ({line_start})"
        ));
    }

    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return Ok(String::new());
    }

    let start_idx = (line_start as usize).saturating_sub(1);
    if start_idx >= lines.len() {
        return Err(anyhow!(
            "read_file: line_start {line_start} is past end of file ({} lines)",
            lines.len()
        ));
    }
    let end_idx = (line_end as usize).min(lines.len());
    Ok(lines[start_idx..end_idx].join("\n"))
}

#[cfg(test)]
mod tests {
    use super::{format_outline, outline_or_full, render_summary_segments, slice_lines};
    use pi_ast::summary::{SummaryOptions, summarize_code};

    #[test]
    fn slice_lines_is_one_based_inclusive() {
        let content = "a\nb\nc\nd\n";
        assert_eq!(slice_lines(content, 2, 3).expect("slice"), "b\nc");
        assert_eq!(slice_lines(content, 1, 1).expect("slice"), "a");
        assert_eq!(slice_lines(content, 4, 10).expect("slice"), "d");
    }

    #[test]
    fn slice_lines_rejects_inverted_or_zero_ranges() {
        assert!(slice_lines("a\nb\n", 0, 1).is_err());
        assert!(slice_lines("a\nb\n", 2, 1).is_err());
        assert!(slice_lines("a\nb\n", 5, 6).is_err());
    }

    #[test]
    fn outline_elides_rust_function_bodies() {
        let code = "\
fn keep_sig() -> i32 {\n\
\tlet a = 1;\n\
\tlet b = 2;\n\
\tlet c = 3;\n\
\ta + b + c\n\
}\n\
";
        let out = outline_or_full(code, "fixture.rs");
        assert!(
            out.contains("summarized outline"),
            "expected outline header: {out}"
        );
        assert!(out.contains("fn keep_sig() -> i32 {"), "output: {out}");
        assert!(out.contains("... (lines"), "expected elision marker: {out}");
        assert!(!out.contains("let a = 1"), "body should be elided: {out}");
    }

    #[test]
    fn outline_passes_through_tiny_or_unparsed_files() {
        let tiny = "x = 1\n";
        assert_eq!(outline_or_full(tiny, "notes.txt"), tiny);

        let short_rs = "fn f() {}\n";
        let out = outline_or_full(short_rs, "short.rs");
        assert_eq!(out, short_rs, "nothing to elide → full content");
    }

    #[test]
    fn render_uses_line_range_placeholders() {
        let result = summarize_code(SummaryOptions {
            code: "\
export function greet(name: string): string {\n\
\tconst clean = name.trim();\n\
\tconst label = clean || 'world';\n\
\treturn `hello ${label}`;\n\
}\n"
            .to_string(),
            lang: None,
            path: Some("fixture.ts".to_string()),
            min_body_lines: None,
            min_comment_lines: None,
            unfold_until_lines: None,
            unfold_limit_lines: None,
        })
        .expect("summarize");
        assert!(result.elided);
        let rendered = render_summary_segments(&result);
        assert!(rendered.contains("... (lines"));
        let formatted = format_outline("fixture.ts", &result);
        assert!(formatted.contains("full=true"));
    }
}
