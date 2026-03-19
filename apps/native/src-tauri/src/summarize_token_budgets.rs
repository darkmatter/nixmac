//! Token budget computations for the summarisation pipeline.
//!
//! Public functions return [`TokenBudget`] containing both
//! `max_output_tokens` (the output cap) and `num_ctx` (the context window).
//! Pass `num_ctx` to Ollama to prevent errors from exceeding context window size.

use crate::sqlite_types::Change;

// ── Shared input-estimation constants ─────────────────────────────────────────

/// 15 tokens per diff line generous for code and diff content
const INPUT_TOKENS_PER_DIFF_LINE: u32 = 15;

/// Diff lines per hunk are capped at 60 — matches our truncation rule
const INPUT_MAX_LINES_PER_HUNK: u32 = 60;

/// Extra tokens added on top of (input_est + max_output_tokens) to absorb tokenizer variance.
const CTX_SAFETY_MARGIN: u32 = 512;

fn ctx_window(input_est: u32, max_output_tokens: u32) -> u32 {
    input_est + max_output_tokens + CTX_SAFETY_MARGIN
}

// ── Token budget ───────────────────────────────────────────────────────────────

/// Output cap and total context window
pub struct TokenBudget {
    pub max_output_tokens: u32,
    pub num_ctx: u32,
}

// ── Stage 1 — semantic map ────────────────────────────────────────────────────

const STAGE1_BASE: u32 = 1800;
const STAGE1_PER_LINE: u32 = 3;
const STAGE1_OUTPUT_LINES_CAP: u32 = 50;
const STAGE1_MAX: u32 = 8000;

/// System prompt in `analyze_hunks` (summarize_changes.rs) is ~2 400 chars ≈ 600 tokens.
const STAGE1_SYSTEM_TOKENS: u32 = 600;

pub fn stage_one_budget(changes: &[Change]) -> TokenBudget {
    let mut output_lines = 0u32;
    let mut input_lines = 0u32;
    for c in changes {
        let n = c.diff.lines().count() as u32;
        output_lines += n.min(STAGE1_OUTPUT_LINES_CAP);
        input_lines += n.min(INPUT_MAX_LINES_PER_HUNK);
    }

    let max_output_tokens = (STAGE1_BASE + output_lines * STAGE1_PER_LINE).min(STAGE1_MAX);
    let input_est = STAGE1_SYSTEM_TOKENS + input_lines * INPUT_TOKENS_PER_DIFF_LINE;

    TokenBudget {
        max_output_tokens,
        num_ctx: ctx_window(input_est, max_output_tokens),
    }
}

// ── Stage 2 — per-group summary ───────────────────────────────────────────────

const STAGE2_MIN: u32 = 600;
const STAGE2_PER_LINE: u32 = 3;
const STAGE2_OUTPUT_LINES_CAP: u32 = 50;
const STAGE2_MAX: u32 = 1200;

/// System prompt base estimate
const STAGE2_SYSTEM_TOKENS: u32 = 375;

/// `total_capped_diff_lines` = Σ min(hunk_lines, [`stage_two_lines_cap`]) across all group hunks.
pub fn stage_two_group_budget(total_capped_diff_lines: u32) -> TokenBudget {
    let max_output_tokens =
        (STAGE2_MIN + STAGE2_PER_LINE * total_capped_diff_lines).min(STAGE2_MAX);
    let input_est = STAGE2_SYSTEM_TOKENS + total_capped_diff_lines * INPUT_TOKENS_PER_DIFF_LINE;

    TokenBudget {
        max_output_tokens,
        num_ctx: ctx_window(input_est, max_output_tokens),
    }
}

pub fn stage_two_lines_cap() -> u32 {
    STAGE2_OUTPUT_LINES_CAP
}

// ── Commit message ────────────────────────────────────────────────────────────

const COMMIT_MSG_BASE: u32 = 300;
const COMMIT_MSG_PER_TITLE: u32 = 25;
const COMMIT_MSG_MAX: u32 = 600;

pub fn commit_msg_budget(n_titles: u32) -> u32 {
    (COMMIT_MSG_BASE + COMMIT_MSG_PER_TITLE * n_titles).min(COMMIT_MSG_MAX)
}
