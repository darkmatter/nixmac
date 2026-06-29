//! Low-level env source helpers used by generated `Configurable::resolve`.

pub fn trimmed_env(name: &str) -> Option<String> {
    crate::e2e_runtime::value(name)
        .or_else(|| std::env::var(name).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn env_is_truthy(value: &str) -> bool {
    matches!(value, "1" | "true" | "TRUE" | "yes" | "YES")
}

pub fn build_embed(name: &str) -> Option<String> {
    let raw = match name {
        "SENTRY_DSN" => option_env!("SENTRY_DSN").map(str::to_string),
        "VITE_SERVER_URL" => option_env!("VITE_SERVER_URL").map(str::to_string),
        "SUBMITTED_FEEDBACK_DSN" => option_env!("SUBMITTED_FEEDBACK_DSN").map(str::to_string),
        "NIXMAC_ENV" => option_env!("NIXMAC_ENV").map(str::to_string),
        "NIXMAC_VERSION" => option_env!("NIXMAC_VERSION").map(str::to_string),
        _ => None,
    };
    raw.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// JSON profile from `apps/native/env.{development,release,e2e}.json`, embedded at compile time.
pub fn build_profile() -> Option<serde_json::Value> {
    option_env!("NIXMAC_ENV_PROFILE_JSON").and_then(|raw| serde_json::from_str(raw).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_build_profile_parses_and_uses_env_var_keys() {
        let profile =
            build_profile().expect("NIXMAC_ENV_PROFILE_JSON should parse at compile time");
        assert_eq!(
            profile
                .get("VITE_SERVER_URL")
                .and_then(|value| value.as_str()),
            Some("https://nixmac.com")
        );
    }
}
