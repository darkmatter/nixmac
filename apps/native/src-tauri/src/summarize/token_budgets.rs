//! Token budget constants and prompt-length based budget computation for model calls.

use once_cell::sync::Lazy;
use tiktoken_rs::{cl100k_base, CoreBPE};

const DEFAULT_MODEL_CONTEXT_WINDOW: u32 = 8192;
const MIN_MEANINGFUL_OUTPUT_TOKENS: u32 = 128;

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

pub fn compute_token_allocation(
    prompt: &str,
    requested_output_tokens: u32,
    max_context_tokens: u32,
) -> TokenAllocation {
    let input_est = estimate_input_tokens(prompt);

    let safety_margin = (max_context_tokens / 16).max(128);

    let desired_total = input_est
        .saturating_add(requested_output_tokens)
        .saturating_add(safety_margin);

    if desired_total <= max_context_tokens {
        return TokenAllocation {
            output_tokens: requested_output_tokens,
            required_context_tokens: desired_total,
        };
    }

    let available_for_output = max_context_tokens
        .saturating_sub(input_est)
        .saturating_sub(safety_margin);

    if available_for_output < MIN_MEANINGFUL_OUTPUT_TOKENS {
        log::warn!(
            "Prompt exceeds context window without enough room for meaningful completion. input={} available_output={} min_output={} ctx={}",
            input_est,
            available_for_output,
            MIN_MEANINGFUL_OUTPUT_TOKENS,
            max_context_tokens
        );

        return TokenAllocation {
            output_tokens: 0,
            required_context_tokens: max_context_tokens,
        };
    }

    let clamped_output = requested_output_tokens.min(available_for_output);

    log::warn!(
        "Token allocation clamped. input={} requested_output={} clamped_output={} ctx={}",
        input_est,
        requested_output_tokens,
        clamped_output,
        max_context_tokens
    );

    TokenAllocation {
        output_tokens: clamped_output,
        required_context_tokens: max_context_tokens,
    }
}

/// Returns a best-effort context window size for a model identifier.
pub fn model_context_window(model: &str) -> u32 {
    let m = model.to_ascii_lowercase();

    if m.contains("gpt-oss")
        || m.contains("o1")
        || m.contains("o3")
        || m.contains("gpt-4.1")
        || m.contains("claude-3")
        || m.contains("gemini-1.5")
        || m.contains("gemini-2")
    {
        return 32768;
    }

    if m.contains("gpt-4o")
        || m.contains("llama3")
        || m.contains("qwen")
        || m.contains("mistral")
        || m.contains("codellama")
    {
        return 16384;
    }

    DEFAULT_MODEL_CONTEXT_WINDOW
}

// ── map_relations ─────────────────────────────────────────────────────────────
const MAP_MAX_OUTPUT_TOKENS: u32 = 800;

pub fn map_relations_budget(prompt: &str, model: &str) -> TokenAllocation {
    compute_token_allocation(prompt, MAP_MAX_OUTPUT_TOKENS, model_context_window(model))
}

// ── map_relations_to_existing ─────────────────────────────────────────────────
const MAP_TO_EXISTING_MAX_OUTPUT_TOKENS: u32 = 800;

pub fn map_relations_to_existing_budget(prompt: &str, model: &str) -> TokenAllocation {
    compute_token_allocation(
        prompt,
        MAP_TO_EXISTING_MAX_OUTPUT_TOKENS,
        model_context_window(model),
    )
}

// ── summarize_evolved_group / summarize_new_group ─────────────────────────────
const GROUP_MAX_OUTPUT_TOKENS: u32 = 700;

pub fn group_budget(prompt: &str, model: &str) -> TokenAllocation {
    compute_token_allocation(prompt, GROUP_MAX_OUTPUT_TOKENS, model_context_window(model))
}

// ── summarize_new_single ──────────────────────────────────────────────────────
const SINGLE_MAX_OUTPUT_TOKENS: u32 = 800;

pub fn single_budget(prompt: &str, model: &str) -> TokenAllocation {
    compute_token_allocation(
        prompt,
        SINGLE_MAX_OUTPUT_TOKENS,
        model_context_window(model),
    )
}

// ── generate_commit_message_from_map ─────────────────────────────────────────
const COMMIT_MESSAGE_MAX_OUTPUT_TOKENS: u32 = 300;

pub fn commit_message_budget(prompt: &str, model: &str) -> TokenAllocation {
    compute_token_allocation(
        prompt,
        COMMIT_MESSAGE_MAX_OUTPUT_TOKENS,
        model_context_window(model),
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
    fn returns_requested_output_when_budget_fits() {
        let prompt = "one line";
        let input = estimate_input_tokens(prompt);
        let requested_output = 300;
        let safety_margin = (4096 / 16).max(128);
        let max_ctx = input + requested_output + safety_margin + 50;

        let alloc = compute_token_allocation(prompt, requested_output, max_ctx);

        assert_eq!(alloc.output_tokens, requested_output);
        assert_eq!(
            alloc.required_context_tokens,
            input + requested_output + safety_margin
        );
    }

    #[test]
    fn clamps_output_to_available_context_when_needed() {
        let prompt = "one line";
        let input = estimate_input_tokens(prompt);
        let requested_output = 300;
        let max_ctx = 4096;
        let safety_margin = (max_ctx / 16).max(128);
        let available_output = 256;
        let max_ctx = input + safety_margin + available_output;

        let alloc = compute_token_allocation(prompt, requested_output, max_ctx);

        assert_eq!(alloc.output_tokens, available_output);
        assert_eq!(alloc.required_context_tokens, max_ctx);
    }

    #[test]
    fn returns_zero_output_when_only_tiny_completion_would_fit() {
        let prompt = "one line";
        let input = estimate_input_tokens(prompt);
        let max_ctx = 4096;
        let safety_margin = (max_ctx / 16).max(128);
        let tiny_available_output = MIN_MEANINGFUL_OUTPUT_TOKENS - 1;
        let max_ctx = input + safety_margin + tiny_available_output;

        let alloc = compute_token_allocation(prompt, 300, max_ctx);

        assert_eq!(alloc.output_tokens, 0);
        assert_eq!(alloc.required_context_tokens, max_ctx);
    }

    #[test]
    fn model_context_window_uses_reasonable_defaults() {
        assert_eq!(model_context_window("openai/gpt-4o-mini"), 16384);
        assert_eq!(model_context_window("gpt-oss-120b"), 32768);
        assert_eq!(
            model_context_window("unknown-model"),
            DEFAULT_MODEL_CONTEXT_WINDOW
        );
    }
}
