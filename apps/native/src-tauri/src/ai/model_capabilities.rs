const DEFAULT_CONTEXT_WINDOW_TOKENS: u32 = 8192;
const GPT_4O_MAX_COMPLETION_TOKENS: u32 = 16_384;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelCapabilities {
    /// Conservative local budget cap. A future server registry can replace this
    /// source without changing provider call sites.
    pub context_window_tokens: u32,
    pub max_completion_tokens: Option<u32>,
    pub supports_custom_temperature: bool,
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

fn supports_custom_temperature_for_normalized_model(model: &str) -> bool {
    !(model == "o1"
        || model == "o3"
        || model == "o4"
        || model == "gpt-5"
        || model.starts_with("o1-")
        || model.starts_with("o3-")
        || model.starts_with("o4-")
        || model.starts_with("gpt-5-")
        || model.starts_with("gpt-5."))
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

    if model.contains("gpt-oss")
        || model.contains("o1")
        || model.contains("o3")
        || model.contains("gpt-4.1")
        || model.contains("claude-3")
        || model.contains("gemini-1.5")
        || model.contains("gemini-2")
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
    }
}

#[cfg(test)]
mod tests {
    use super::{DEFAULT_CONTEXT_WINDOW_TOKENS, capabilities_for_model};

    #[test]
    fn reasoning_models_do_not_support_custom_temperature() {
        for model in [
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
            "gpt-oss-120b",
            "o1-preview",
            "o3-mini",
            "gpt-4.1-mini",
            "claude-3-5-sonnet",
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
}
