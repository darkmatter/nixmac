use serde::{Deserialize, Serialize};

use crate::shared_types::{
    Evolution, EvolutionState, ProviderFailure, TerminalReason, ThinkingEntry, ToolCallRecord,
};

// Moved to shared_types so they can ride the wire in EvolveEventDetail;
// re-exported here for the existing tool/editor code.
pub use crate::shared_types::{FileEditAction, SemanticFileEdit};

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
            terminal_reason: None,
            build_verified: false,
            last_build_ok: None,
        }
    }

    pub fn has_edits(&self) -> bool {
        !self.edits.is_empty()
    }

    /// Names of the tools invoked so far, deduplicated in first-call order.
    pub fn tool_names(&self) -> Vec<String> {
        let mut seen = std::collections::HashSet::new();
        self.tool_calls
            .iter()
            .filter(|call| seen.insert(call.tool.as_str()))
            .map(|call| call.tool.clone())
            .collect()
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

/// Partial evolution telemetry captured on failed runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionProgress {
    pub state: EvolutionState,
    pub terminal_reason: Option<TerminalReason>,
    pub build_verified: bool,
    pub last_build_ok: Option<bool>,
    pub tool_names: Vec<String>,
    pub iterations: usize,
    pub build_attempts: usize,
    pub total_tokens: u32,
    pub edits_count: usize,
    pub thinking_count: usize,
    pub tool_calls_count: usize,
}

/// Error for failed evolution generation that still carries partial progress.
#[derive(Debug, Clone, thiserror::Error)]
#[error("{message}")]
pub struct EvolutionRunError {
    pub message: String,
    pub progress: EvolutionProgress,
    /// Structured metadata when the run died on an AI provider request.
    pub provider_failure: Option<ProviderFailure>,
}

impl EvolutionRunError {
    pub(super) fn from_state(
        message: impl Into<String>,
        evolution: &Evolution,
        iterations: usize,
        build_attempts: usize,
        total_tokens: u32,
    ) -> Self {
        Self {
            message: message.into(),
            provider_failure: None,
            progress: EvolutionProgress {
                state: EvolutionState::Failed,
                terminal_reason: evolution.terminal_reason,
                build_verified: evolution.build_verified,
                last_build_ok: evolution.last_build_ok,
                tool_names: evolution.tool_names(),
                iterations,
                build_attempts,
                total_tokens,
                edits_count: evolution.edits.len(),
                thinking_count: evolution.thinking.len(),
                tool_calls_count: evolution.tool_calls.len(),
            },
        }
    }
}
