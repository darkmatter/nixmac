//! Token budget constants and prompt-length based budget computation for model calls.

use once_cell::sync::Lazy;
use tiktoken_rs::{cl100k_base, CoreBPE};

const CTX_SAFETY_MARGIN: u32 = 512;

#[derive(Debug, Clone, Copy)]
pub struct TokenAllocation {
    pub output_tokens: u32,
    pub required_context_tokens: u32,
}

static CL100K_BPE: Lazy<Option<CoreBPE>> = Lazy::new(|| cl100k_base().ok());

fn estimate_input_tokens(prompt: &str) -> u32 {
    if let Some(bpe) = CL100K_BPE.as_ref() {
        // cl100k is a strong default across OpenAI-compatible chat models.
        return bpe.encode_with_special_tokens(prompt).len() as u32;
    }

    // Fallback keeps behavior stable even if tokenizer init fails.
    (prompt.len() as u32) / 4
}

/// Computes token allocation for a model call from completion and context budgets.
pub fn compute_token_allocation(
    prompt: &str,
    completion_tokens: u32,
    max_context_tokens: u32,
) -> TokenAllocation {
    let input_est = estimate_input_tokens(prompt);

    let required_context_tokens = input_est
        .saturating_add(CTX_SAFETY_MARGIN)
        .min(max_context_tokens);

    TokenAllocation {
        output_tokens: completion_tokens,
        required_context_tokens,
    }
}

// ── map_relations ─────────────────────────────────────────────────────────────
const MAP_COMPLETION_TOKENS: u32 = 800;
const MAP_MAX_CONTEXT_TOKENS: u32 = 8000;

pub fn map_relations_budget(prompt: &str) -> TokenAllocation {
    compute_token_allocation(prompt, MAP_COMPLETION_TOKENS, MAP_MAX_CONTEXT_TOKENS)
}

// ── map_relations_to_existing ─────────────────────────────────────────────────
const MAP_TO_EXISTING_COMPLETION_TOKENS: u32 = 800;
const MAP_TO_EXISTING_MAX_CONTEXT_TOKENS: u32 = 8000;

pub fn map_relations_to_existing_budget(prompt: &str) -> TokenAllocation {
    compute_token_allocation(
        prompt,
        MAP_TO_EXISTING_COMPLETION_TOKENS,
        MAP_TO_EXISTING_MAX_CONTEXT_TOKENS,
    )
}

// ── summarize_evolved_group / summarize_new_group ─────────────────────────────
const GROUP_COMPLETION_TOKENS: u32 = 700;
const GROUP_MAX_CONTEXT_TOKENS: u32 = 6000;

pub fn group_budget(prompt: &str) -> TokenAllocation {
    compute_token_allocation(prompt, GROUP_COMPLETION_TOKENS, GROUP_MAX_CONTEXT_TOKENS)
}

// ── summarize_new_single ──────────────────────────────────────────────────────
const SINGLE_COMPLETION_TOKENS: u32 = 800;
const SINGLE_MAX_CONTEXT_TOKENS: u32 = 2500;

pub fn single_budget(prompt: &str) -> TokenAllocation {
    compute_token_allocation(prompt, SINGLE_COMPLETION_TOKENS, SINGLE_MAX_CONTEXT_TOKENS)
}

// ── generate_commit_message_from_map ─────────────────────────────────────────
const COMMIT_MESSAGE_COMPLETION_TOKENS: u32 = 300;
const COMMIT_MESSAGE_MAX_CONTEXT_TOKENS: u32 = 600;

pub fn commit_message_budget(prompt: &str) -> TokenAllocation {
    compute_token_allocation(
        prompt,
        COMMIT_MESSAGE_COMPLETION_TOKENS,
        COMMIT_MESSAGE_MAX_CONTEXT_TOKENS,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budget_grows_with_prompt_size() {
        let short = "small prompt";
        let long = "small prompt\nwith additional context\nand even more details";

        let short_alloc = compute_token_allocation(short, 400, 4000);
        let long_alloc = compute_token_allocation(long, 400, 4000);

        assert!(long_alloc.required_context_tokens >= short_alloc.required_context_tokens);
    }

    #[test]
    fn output_budget_matches_configured_completion_tokens() {
        let single = "one line";
        let multi = "one line\ntwo line\nthree line";

        let single_alloc = compute_token_allocation(single, 300, 600);
        let multi_alloc = compute_token_allocation(multi, 300, 600);

        assert_eq!(single_alloc.output_tokens, 300);
        assert_eq!(multi_alloc.output_tokens, 300);
    }
}
