const DEFAULT_CONTEXT_WINDOW_TOKENS: u32 = 8192;
const GPT_4O_MAX_COMPLETION_TOKENS: u32 = 16_384;

/// Extra output-token headroom applied for reasoning models. Reasoning models
/// spend part of `max_completion_tokens` on hidden chain-of-thought before
/// emitting visible content, so budgets that work for non-reasoning models
/// silently truncate to an empty response.
const REASONING_OUTPUT_TOKEN_MULTIPLIER: u32 = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelCapabilities {
    /// Conservative local budget cap. A future server registry can replace this
    /// source without changing provider call sites.
    pub context_window_tokens: u32,
    pub max_completion_tokens: Option<u32>,
    pub supports_custom_temperature: bool,
    /// True for models that emit hidden reasoning tokens counted against
    /// `max_completion_tokens` (e.g. gpt-oss, o1, o3, gpt-5).
    pub is_reasoning_model: bool,
}

impl ModelCapabilities {
    pub fn clamp_max_completion_tokens(&self, requested: u32) -> u32 {
        self.max_completion_tokens
            .map_or(requested, |limit| requested.min(limit))
    }
}

fn normalized_model_name(model: &str) -> String {
    model
        .strip_prefix("openai/")
        .unwrap_or(model)
        .to_ascii_lowercase()
}

fn is_reasoning_model_for_normalized_model(model: &str) -> bool {
    model == "flash"
        || model.starts_with("o1")
        || model.starts_with("o3")
        || model.starts_with("o4")
        || model.starts_with("gpt-5")
        || model.starts_with("gpt-oss")
}

fn supports_custom_temperature_for_normalized_model(model: &str) -> bool {
    !is_reasoning_model_for_normalized_model(model)
}

fn max_completion_tokens_for_normalized_model(model: &str) -> Option<u32> {
    if matches!(model, "gpt-4o" | "gpt-4o-mini") || model.starts_with("gpt-4o-") {
        Some(GPT_4O_MAX_COMPLETION_TOKENS)
    } else {
        None
    }
}
fn context_window_tokens(model: &str) -> u32 {
    let model = model.to_ascii_lowercase();

    if model == "flash"
        || model.contains("gpt-oss")
        || model.contains("gpt-5")
        || model.contains("o1")
        || model.contains("o3")
        || model.contains("o4")
        || model.contains("gpt-4.1")
        || model.contains("claude")
        || model.contains("gemini")
    {
        return 32768;
    }

    if model.contains("gpt-4o")
        || model.contains("llama3")
        || model.contains("qwen")
        || model.contains("mistral")
        || model.contains("codellama")
    {
        return 16384;
    }

    DEFAULT_CONTEXT_WINDOW_TOKENS
}

pub fn capabilities_for_model(model: &str) -> ModelCapabilities {
    let normalized_model = normalized_model_name(model);

    ModelCapabilities {
        context_window_tokens: context_window_tokens(model),
        max_completion_tokens: max_completion_tokens_for_normalized_model(&normalized_model),
        supports_custom_temperature: supports_custom_temperature_for_normalized_model(
            &normalized_model,
        ),
        is_reasoning_model: is_reasoning_model_for_normalized_model(&normalized_model),
    }
}

/// Scales an output-token budget for a model, adding headroom for reasoning
/// models whose hidden chain-of-thought is counted against
/// `max_completion_tokens`. Non-reasoning models receive the requested budget
/// unchanged.
pub fn scale_output_tokens_for_model(model: &str, requested: u32) -> u32 {
    let capabilities = capabilities_for_model(model);
    let scaled = if capabilities.is_reasoning_model {
        requested.saturating_mul(REASONING_OUTPUT_TOKEN_MULTIPLIER)
    } else {
        requested
    };
    capabilities.clamp_max_completion_tokens(scaled)
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_CONTEXT_WINDOW_TOKENS, capabilities_for_model, scale_output_tokens_for_model,
    };

    #[test]
    fn reasoning_models_do_not_support_custom_temperature() {
        for model in [
            "flash",
            "o1",
            "o1-2024-12-17",
            "o3",
            "o3-mini",
            "o3-2025-04-16",
            "o4-mini",
            "openai/o4-mini",
            "gpt-5",
            "gpt-5-mini",
            "gpt-5.1",
            "gpt-5.2",
            "openai/gpt-5-nano",
        ] {
            assert!(
                !capabilities_for_model(model).supports_custom_temperature,
                "{model}"
            );
        }
    }

    #[test]
    fn gpt_models_support_custom_temperature() {
        for model in ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "openai/gpt-4.1-mini"] {
            assert!(
                capabilities_for_model(model).supports_custom_temperature,
                "{model}"
            );
        }
    }

    #[test]
    fn gpt_4o_models_cap_max_completion_tokens() {
        for model in [
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4o-2024-08-06",
            "openai/gpt-4o-mini",
        ] {
            let capabilities = capabilities_for_model(model);

            assert_eq!(capabilities.max_completion_tokens, Some(16_384), "{model}");
            assert_eq!(capabilities.clamp_max_completion_tokens(32_768), 16_384);
            assert_eq!(capabilities.clamp_max_completion_tokens(4_096), 4_096);
        }
    }

    #[test]
    fn non_gpt_4o_models_do_not_cap_max_completion_tokens() {
        for model in [
            "gpt-4.1",
            "gpt-5",
            "custom-openai-model",
            "openai/gpt-5-nano",
        ] {
            let capabilities = capabilities_for_model(model);

            assert_eq!(capabilities.max_completion_tokens, None, "{model}");
            assert_eq!(capabilities.clamp_max_completion_tokens(32_768), 32_768);
        }
    }

    #[test]
    fn context_window_budget_preserves_existing_model_groups() {
        for model in [
            "flash",
            "gpt-oss-120b",
            "openai/gpt-oss-120b",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.5",
            "o1-preview",
            "o3-mini",
            "o4-mini",
            "gpt-4.1-mini",
            "claude-3-5-sonnet",
            "claude-sonnet-4.5",
            "~anthropic/claude-sonnet-latest",
            "gemini-1.5-pro",
            "gemini-2.5-pro",
            "my-qwen-finetune",
        ] {
            let expected = if model.contains("qwen") {
                16_384
            } else {
                32_768
            };

            assert_eq!(
                capabilities_for_model(model).context_window_tokens,
                expected,
                "{model}"
            );
        }

        for model in [
            "openai/gpt-4o-mini",
            "llama3:8b-instruct",
            "qwen2.5-coder",
            "mistral-small",
            "codellama:13b",
        ] {
            assert_eq!(
                capabilities_for_model(model).context_window_tokens,
                16_384,
                "{model}"
            );
        }

        assert_eq!(
            capabilities_for_model("unknown-model").context_window_tokens,
            DEFAULT_CONTEXT_WINDOW_TOKENS
        );
    }

    #[test]
    fn reasoning_models_are_detected() {
        for model in [
            "flash",
            "gpt-oss-120b",
            "o1",
            "o1-2024-12-17",
            "o3-mini",
            "o4-mini",
            "gpt-5",
            "gpt-5.1",
            "gpt-5.5",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "openai/gpt-5.6-luna",
            "openai/gpt-oss-20b",
            "openai/o3",
        ] {
            assert!(
                capabilities_for_model(model).is_reasoning_model,
                "{model} should be a reasoning model"
            );
        }
    }

    #[test]
    fn non_reasoning_models_are_not_flagged() {
        for model in [
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4.1",
            "claude-3-5-sonnet",
            "~anthropic/claude-sonnet-latest",
            "gemini-2.5-pro",
            "llama3:8b-instruct",
            "unknown-model",
        ] {
            assert!(
                !capabilities_for_model(model).is_reasoning_model,
                "{model} should not be a reasoning model"
            );
        }
    }

    #[test]
    fn scale_output_tokens_multiplies_for_reasoning_models() {
        // Reasoning models get headroom for hidden chain-of-thought.
        assert_eq!(scale_output_tokens_for_model("flash", 600), 2_400);
        assert_eq!(scale_output_tokens_for_model("gpt-oss-120b", 600), 2_400);
        assert_eq!(scale_output_tokens_for_model("o3-mini", 600), 2_400);
        assert_eq!(scale_output_tokens_for_model("gpt-5", 600), 2_400);
    }

    #[test]
    fn scale_output_tokens_passes_through_for_non_reasoning_models() {
        assert_eq!(scale_output_tokens_for_model("gpt-4o-mini", 600), 600);
        assert_eq!(scale_output_tokens_for_model("claude-3-5-sonnet", 600), 600);
        assert_eq!(scale_output_tokens_for_model("unknown-model", 600), 600);
    }

    #[test]
    fn scale_output_tokens_clamps_for_gpt_4o_reasoning_hybrid() {
        // gpt-4o is not a reasoning model, so no multiplier — but the
        // max_completion_tokens cap still applies for the 4o family.
        assert_eq!(scale_output_tokens_for_model("gpt-4o", 32_768), 16_384);
    }
}
