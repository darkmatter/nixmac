use serde::{Deserialize, Serialize};

/// Application state - computed based on configuration and working tree status.
/// This replaces the old EvolutionState which was manually assigned.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppState {
    /// Missing configuration (host, user, directory, etc.)
    Onboarding,
    /// Default state - configured and no pending changes
    Idle,
    /// LLM is actively generating changes
    Generating,
    /// Working changes have been activated with `darwin-rebuild switch`
    /// but the changes are not committed yet
    Preview,
}

impl Default for AppState {
    fn default() -> Self {
        Self::Idle
    }
}

/// Input data used to compute the current app state
#[derive(Debug, Clone, Default)]
pub struct AppStateInput {
    /// Whether a config directory is set
    pub has_config_dir: bool,
    /// Whether a host attribute is configured
    pub has_host_attr: bool,
    /// Whether there are uncommitted changes in the working tree
    pub has_uncommitted_changes: bool,
    /// Whether the LLM is currently generating
    pub is_generating: bool,
    /// Whether changes have been applied with darwin-rebuild switch
    pub has_applied_preview: bool,
}

impl AppState {
    /// Compute the current app state based on the input conditions.
    ///
    /// Rules (in priority order):
    /// 1. If missing config_dir or host_attr → Onboarding
    /// 2. If LLM is generating → Generating
    /// 3. If has uncommitted changes AND applied preview → Preview
    /// 4. Otherwise → Idle
    pub fn compute(input: &AppStateInput) -> Self {
        // Rule 1: Missing configuration
        if !input.has_config_dir || !input.has_host_attr {
            return Self::Onboarding;
        }

        // Rule 2: LLM is generating
        if input.is_generating {
            return Self::Generating;
        }

        // Rule 3: Preview mode - has applied changes that aren't committed
        if input.has_uncommitted_changes && input.has_applied_preview {
            return Self::Preview;
        }

        // Rule 4: Default idle state
        Self::Idle
    }
}

/// Legacy evolution state - kept for backwards compatibility during generation
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EvolutionState {
    /// Initial state before generation starts
    Pending,
    /// Currently generating/processing
    Loading,
    /// Generation complete, ready for review
    Generated,
    /// Changes have been applied (darwin-rebuild ran)
    Applied,
    /// Changes have been committed
    Committed,
    /// An error occurred
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEdit {
    pub path: String,
    pub search: String,
    pub replace: String,
}

/// A single thinking entry from the agent's reasoning process
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingEntry {
    /// When this thought occurred (ms since evolution start)
    pub timestamp_ms: i64,
    /// The iteration number when this thought occurred
    pub iteration: usize,
    /// Category of thinking (planning, analysis, debugging, etc.)
    pub category: String,
    /// The actual thought content
    pub content: String,
}

/// A tool call record for the activity log
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRecord {
    /// When this tool was called (ms since evolution start)
    pub timestamp_ms: i64,
    /// The iteration number
    pub iteration: usize,
    /// Tool name
    pub tool: String,
    /// Tool arguments (simplified)
    pub args_summary: String,
    /// Result summary
    pub result_summary: String,
    /// Whether the call succeeded
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evolution {
    pub id: String,
    pub created_at: i64,
    pub state: EvolutionState,
    pub prompt: String,
    pub edits: Vec<FileEdit>,
    pub commit_hash: Option<String>,
    pub summary: Option<String>,
    /// Full message history for context
    pub messages: Vec<serde_json::Value>,
    /// Agent's thinking/reasoning log
    pub thinking: Vec<ThinkingEntry>,
    /// Tool call activity log
    pub tool_calls: Vec<ToolCallRecord>,
    /// Total tokens used
    pub total_tokens: u32,
    /// Number of iterations
    pub iterations: usize,
    /// Number of build attempts
    pub build_attempts: usize,
    /// AI-generated summary of changes for preview
    pub changes_summary: Option<String>,
    /// AI-generated commit message suggestion
    pub suggested_commit_message: Option<String>,
}

impl Evolution {
    pub fn new(prompt: &str) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            created_at: chrono::Utc::now().timestamp(),
            state: EvolutionState::Pending,
            prompt: prompt.to_string(),
            edits: vec![],
            commit_hash: None,
            summary: None,
            messages: vec![],
            thinking: vec![],
            tool_calls: vec![],
            total_tokens: 0,
            iterations: 0,
            build_attempts: 0,
            changes_summary: None,
            suggested_commit_message: None,
        }
    }

    pub fn has_edits(&self) -> bool {
        !self.edits.is_empty()
    }

    /// Add a thinking entry
    pub fn add_thought(
        &mut self,
        start_time: i64,
        iteration: usize,
        category: &str,
        content: &str,
    ) {
        let now = chrono::Utc::now().timestamp_millis();
        self.thinking.push(ThinkingEntry {
            timestamp_ms: now - (start_time * 1000),
            iteration,
            category: category.to_string(),
            content: content.to_string(),
        });
    }

    /// Add a tool call record
    pub fn add_tool_call(
        &mut self,
        start_time: i64,
        iteration: usize,
        tool: &str,
        args_summary: &str,
        result_summary: &str,
        success: bool,
    ) {
        let now = chrono::Utc::now().timestamp_millis();
        self.tool_calls.push(ToolCallRecord {
            timestamp_ms: now - (start_time * 1000),
            iteration,
            tool: tool.to_string(),
            args_summary: args_summary.to_string(),
            result_summary: result_summary.to_string(),
            success,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_state_onboarding_no_config() {
        let input = AppStateInput {
            has_config_dir: false,
            has_host_attr: false,
            ..Default::default()
        };
        assert_eq!(AppState::compute(&input), AppState::Onboarding);
    }

    #[test]
    fn test_app_state_onboarding_no_host() {
        let input = AppStateInput {
            has_config_dir: true,
            has_host_attr: false,
            ..Default::default()
        };
        assert_eq!(AppState::compute(&input), AppState::Onboarding);
    }

    #[test]
    fn test_app_state_generating() {
        let input = AppStateInput {
            has_config_dir: true,
            has_host_attr: true,
            is_generating: true,
            ..Default::default()
        };
        assert_eq!(AppState::compute(&input), AppState::Generating);
    }

    #[test]
    fn test_app_state_preview() {
        let input = AppStateInput {
            has_config_dir: true,
            has_host_attr: true,
            has_uncommitted_changes: true,
            has_applied_preview: true,
            ..Default::default()
        };
        assert_eq!(AppState::compute(&input), AppState::Preview);
    }

    #[test]
    fn test_app_state_idle() {
        let input = AppStateInput {
            has_config_dir: true,
            has_host_attr: true,
            has_uncommitted_changes: false,
            has_applied_preview: false,
            is_generating: false,
        };
        assert_eq!(AppState::compute(&input), AppState::Idle);
    }

    #[test]
    fn test_app_state_uncommitted_without_preview_is_idle() {
        // If there are uncommitted changes but preview wasn't applied,
        // we stay in Idle (user might have made manual edits)
        let input = AppStateInput {
            has_config_dir: true,
            has_host_attr: true,
            has_uncommitted_changes: true,
            has_applied_preview: false,
            is_generating: false,
        };
        assert_eq!(AppState::compute(&input), AppState::Idle);
    }
}
