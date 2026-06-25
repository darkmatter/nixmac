// Shared environment variable names and build-time embed keys.
//
// Included from `build.rs` and re-exported by `crate::env`.

#[allow(dead_code)]
/// Environment variables embedded at build time via `build.rs` (`cargo:rustc-env`).
pub const BUILD_EMBED_KEYS: &[&str] = &[
    "SENTRY_DSN",
    "VITE_SERVER_URL",
    "SUBMITTED_FEEDBACK_DSN",
    "NIXMAC_ENV",
];

/// Application environment variable names.
#[allow(dead_code)]
pub mod names {
    pub const NIXMAC_ENV: &str = "NIXMAC_ENV";
    pub const NIXMAC_VERSION: &str = "NIXMAC_VERSION";
    pub const SENTRY_DSN: &str = "SENTRY_DSN";
    pub const VITE_SERVER_URL: &str = "VITE_SERVER_URL";
    pub const SUBMITTED_FEEDBACK_DSN: &str = "SUBMITTED_FEEDBACK_DSN";

    pub const NIXMAC_DISABLE_UPDATER: &str = "NIXMAC_DISABLE_UPDATER";
    pub const VITE_NIXMAC_SKIP_PERMISSIONS: &str = "VITE_NIXMAC_SKIP_PERMISSIONS";
    pub const NIXMAC_EVOLUTION_MEMORY_STRATEGY: &str = "NIXMAC_EVOLUTION_MEMORY_STRATEGY";
    pub const DEBUG_SKIP_RESTORE_ALL: &str = "DEBUG_SKIP_RESTORE_ALL";

    pub const SUMMARY_AI_PROVIDER: &str = "SUMMARY_AI_PROVIDER";
    pub const SUMMARY_MODEL: &str = "SUMMARY_MODEL";
    pub const EVOLVE_PROVIDER: &str = "EVOLVE_PROVIDER";
    pub const EVOLVE_MODEL: &str = "EVOLVE_MODEL";
    pub const OLLAMA_API_BASE: &str = "OLLAMA_API_BASE";
    pub const VLLM_API_BASE: &str = "VLLM_API_BASE";

    pub const OPENAI_API_KEY: &str = "OPENAI_API_KEY";
    pub const OPENROUTER_API_KEY: &str = "OPENROUTER_API_KEY";
    pub const VLLM_API_KEY: &str = "VLLM_API_KEY";

    pub const NIXMAC_E2E_MOCK_SYSTEM: &str = "NIXMAC_E2E_MOCK_SYSTEM";
    pub const NIXMAC_E2E_WEB_SERVER_URL: &str = "NIXMAC_E2E_WEB_SERVER_URL";
    pub const NIXMAC_E2E_SYNC_SERVER_URL: &str = "NIXMAC_E2E_SYNC_SERVER_URL";
    pub const NIXMAC_E2E_CONFIG_DIR: &str = "NIXMAC_E2E_CONFIG_DIR";
    pub const NIXMAC_E2E_HOST_ATTR: &str = "NIXMAC_E2E_HOST_ATTR";
}
