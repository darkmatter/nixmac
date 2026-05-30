use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

/// Options indicating which feedback artifacts the user allows sharing.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackShareOptions {
    /// Include the current widget/store state snapshot.
    pub current_app_state: bool,
    /// Include OS, architecture, Nix, and app version details.
    pub system_info: bool,
    /// Include aggregated usage statistics.
    pub usage_stats: bool,
    /// Include the active evolution log.
    pub evolution_log: bool,
    /// Include the current diff for changed Nix files.
    pub changed_nix_files: bool,
    /// Include selected AI provider/model and usage details.
    pub ai_provider_model_info: bool,
    /// Include the latest build error output, if any.
    pub build_error_output: bool,
    /// Include selected `flake.lock` input metadata.
    pub flake_inputs_snapshot: bool,
    /// Include recent application logs.
    pub app_logs: bool,
}

/// System information captured from the runtime.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackSystemInfo {
    /// Operating system name, e.g. `macOS`.
    pub os_name: Option<String>,
    /// Operating system version string.
    pub os_version: Option<String>,
    /// Hardware/system architecture, e.g. `aarch64-darwin`.
    pub arch: Option<String>,
    /// Installed Nix version, when detected.
    pub nix_version: Option<String>,
    /// nixmac application version.
    pub app_version: Option<String>,
}

/// Aggregated usage stats for feedback.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackUsageStats {
    /// Number of evolutions recorded locally.
    pub total_evolutions: Option<u64>,
    /// Percentage of evolutions that completed successfully.
    pub success_rate: Option<f64>,
    /// Average number of agent iterations per evolution.
    pub avg_iterations: Option<f64>,
    /// Timestamp when the stats were computed.
    pub last_computed_at: Option<String>,
    /// Additional structured usage fields that are not part of the stable contract.
    pub extra: Option<Value>,
}

/// AI provider/model info and usage signals.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackAiProviderModelInfo {
    /// Provider used for evolution requests.
    pub evolve_provider: Option<String>,
    /// Model used for evolution requests.
    pub evolve_model: Option<String>,
    /// Provider used for summary requests.
    pub summary_provider: Option<String>,
    /// Model used for summary requests.
    pub summary_model: Option<String>,
    /// Token count reported for the related AI run.
    pub total_tokens: Option<u32>,
    /// Latency in milliseconds for the related AI run.
    pub latency_ms: Option<i64>,
    /// Iterations completed by the related evolution.
    pub iterations: Option<usize>,
    /// Build attempts completed by the related evolution.
    pub build_attempts: Option<usize>,
}

/// Flake input metadata captured from flake.lock.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackFlakeInputEntry {
    /// Git revision for the flake input.
    pub rev: Option<String>,
    /// Flake input last-modified timestamp from `flake.lock`.
    pub last_modified: Option<i64>,
    /// Store hash for the locked input.
    pub nar_hash: Option<String>,
}

/// Snapshot of selected flake inputs.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FeedbackFlakeInputsSnapshot {
    /// Locked `nixpkgs` input metadata.
    pub nixpkgs: Option<FeedbackFlakeInputEntry>,
    /// Locked `nix-darwin` input metadata.
    #[serde(rename = "nix-darwin")]
    pub nix_darwin: Option<FeedbackFlakeInputEntry>,
    /// Locked `home-manager` input metadata.
    #[serde(rename = "home-manager")]
    pub home_manager: Option<FeedbackFlakeInputEntry>,
}

/// Request payload for gathering feedback metadata.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackMetadataRequest {
    /// Feedback category selected by the user.
    pub feedback_type: String,
    /// User opt-in flags controlling which artifacts may be gathered.
    pub share: FeedbackShareOptions,
}

/// Metadata collected for feedback submission based on user opt-in.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackMetadata {
    /// Current frontend/store snapshot, represented as arbitrary JSON.
    pub current_app_state_snapshot: Option<Value>,
    /// Runtime system information.
    pub system_info: Option<FeedbackSystemInfo>,
    /// Aggregated local usage statistics.
    pub usage_stats: Option<FeedbackUsageStats>,
    /// Captured evolution log content.
    pub evolution_log_content: Option<String>,
    /// Diff for changed Nix files at submission time.
    pub changed_nix_files_diff: Option<String>,
    /// AI provider/model metadata for the related run.
    pub ai_provider_model_info: Option<FeedbackAiProviderModelInfo>,
    /// Latest build error output.
    pub build_error_output: Option<String>,
    /// Selected locked flake input metadata.
    pub flake_inputs_snapshot: Option<FeedbackFlakeInputsSnapshot>,
    /// Recent application log content.
    pub app_logs_content: Option<String>,
    /// Panic details when feedback is submitted after a crash.
    pub panic_details: Option<FeedbackPanicDetails>,
}

/// Panic/crash information captured when a Rust panic occurs.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackPanicDetails {
    /// Panic message captured by the panic hook.
    pub message: String,
    /// Source location reported by Rust, when available.
    pub location: Option<String>,
    /// Captured backtrace, when available.
    pub backtrace: Option<String>,
    /// UTC timestamp when the panic was captured.
    pub timestamp: String,
}
