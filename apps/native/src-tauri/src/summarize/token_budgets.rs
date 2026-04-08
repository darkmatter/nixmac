//! Token budget constants and prompt-length based budget computation for model calls.

const OUTPUT_PER_LINE: u32 = 5;
const CTX_SAFETY_MARGIN: u32 = 512;

/// Returns `(max_output_tokens, num_ctx)` scaled to prompt line count, clamped to `[min, max]`.
pub fn prompt_budget(prompt: &str, min_tokens: u32, max_tokens: u32) -> (u32, u32) {
    let lines = prompt.lines().count() as u32;
    let max_output = (min_tokens + lines * OUTPUT_PER_LINE).min(max_tokens);
    let input_est = (prompt.len() as u32) / 4;
    (max_output, input_est + max_output + CTX_SAFETY_MARGIN)
}

// ── map_relations ─────────────────────────────────────────────────────────────
const MAP_MIN: u32 = 800;
const MAP_MAX: u32 = 8000;

pub fn map_relations_budget(prompt: &str) -> (u32, u32) {
    prompt_budget(prompt, MAP_MIN, MAP_MAX)
}

// ── map_relations_to_existing ─────────────────────────────────────────────────
const MAP_TO_MIN: u32 = 800;
const MAP_TO_MAX: u32 = 8000;

pub fn map_relations_to_existing_budget(prompt: &str) -> (u32, u32) {
    prompt_budget(prompt, MAP_TO_MIN, MAP_TO_MAX)
}

// ── summarize_evolved_group / summarize_new_group ─────────────────────────────
const GROUP_MIN: u32 = 700;
const GROUP_MAX: u32 = 6000;

pub fn group_budget(prompt: &str) -> (u32, u32) {
    prompt_budget(prompt, GROUP_MIN, GROUP_MAX)
}

// ── summarize_new_single ──────────────────────────────────────────────────────
const SINGLE_MIN: u32 = 400;
const SINGLE_MAX: u32 = 4000;

pub fn new_single_budget(prompt: &str) -> (u32, u32) {
    prompt_budget(prompt, SINGLE_MIN, SINGLE_MAX)
}

// ── generate_commit_message_from_map ─────────────────────────────────────────
const MSG_MIN: u32 = 300;
const MSG_MAX: u32 = 600;

pub fn commit_message_budget(prompt: &str) -> (u32, u32) {
    prompt_budget(prompt, MSG_MIN, MSG_MAX)
}
