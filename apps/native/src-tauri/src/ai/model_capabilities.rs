fn normalized_model_name(model: &str) -> String {
    model
        .strip_prefix("openai/")
        .unwrap_or(model)
        .to_ascii_lowercase()
}

pub fn supports_custom_temperature(model: &str) -> bool {
    let model = normalized_model_name(model);
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

#[cfg(test)]
mod tests {
    use super::supports_custom_temperature;

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
            assert!(!supports_custom_temperature(model), "{model}");
        }
    }

    #[test]
    fn gpt_models_support_custom_temperature() {
        for model in ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "openai/gpt-4.1-mini"] {
            assert!(supports_custom_temperature(model), "{model}");
        }
    }
}
