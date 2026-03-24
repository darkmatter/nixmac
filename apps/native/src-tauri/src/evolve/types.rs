use serde::{Deserialize, Serialize};

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
    /// Agent responded conversationally without making any environment changes
    Conversational,
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
