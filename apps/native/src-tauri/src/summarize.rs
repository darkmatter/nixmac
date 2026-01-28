//! Summarization service using a fast, small model.
//!
//! This module provides AI-powered summarization for:
//! - Working changes (git diff) for preview mode
//! - Commit message generation based on changes

use anyhow::Result;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::providers::create_provider;

const MAX_SUMMARY_TOKENS: u32 = 800;
const TEMPERATURE: f32 = 0.3;

/// A single summary item with a title and description
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryItem {
    pub title: String,
    pub description: String,
}

/// Structured summary response from the AI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeSummary {
    pub items: Vec<SummaryItem>,
    pub instructions: String,
}

/// Generate a human-readable summary of file changes for preview mode.
///
/// This creates a structured summary with friendly descriptions and
/// suggestions for testing the changes.
pub async fn summarize_changes<R: Runtime>(
    diff: &str,
    file_list: &[String],
    app_handle: Option<&AppHandle<R>>,
) -> Result<ChangeSummary> {
    if diff.is_empty() && file_list.is_empty() {
        return Ok(ChangeSummary {
            items: vec![SummaryItem {
                title: "No changes".to_string(),
                description: "No changes were detected in your configuration.".to_string(),
            }],
            instructions: "Make some changes to your nix-darwin configuration to get started."
                .to_string(),
        });
    }

    let provider = create_provider(app_handle)?;

    let file_summary = if file_list.is_empty() {
        String::new()
    } else {
        format!("\n\nModified files:\n{}", file_list.join("\n"))
    };

    let truncated_diff = if diff.len() > 8000 {
        format!("{}...\n[diff truncated]", &diff[..8000])
    } else {
        diff.to_string()
    };

    let system_prompt = r#"You summarize nix-darwin configuration changes in a friendly, non-technical way.

Respond with valid JSON matching this exact structure:
{
  "items": [
    { "title": "Short title", "description": "Friendly description of what this change does" }
  ],
  "instructions": "A helpful suggestion for testing these changes"
}

Guidelines:
- Keep titles short (2-5 words) and describe the change type (e.g., "New App Installed", "Theme Updated")
- Write descriptions in plain English, explaining the benefit to the user
- For instructions, give actionable suggestions like:
  - "Open the X app from your Applications folder" (for new apps)
  - "Run 'vim .' in your terminal to try out the new theme" (for vim changes)
  - "Open a new terminal window to see the updated shell prompt" (for shell changes)
  - "Check System Preferences > Keyboard to see your new shortcuts" (for keyboard changes)
- Keep items focused on user-visible changes (skip internal refactoring details)
- Limit to 3-5 items maximum

Respond with ONLY valid JSON, no markdown code blocks or extra text."#;

    let user_prompt = format!(
        "Summarize these nix-darwin configuration changes:\n\n\
        ```diff\n{}\n```{}",
        truncated_diff, file_summary
    );

    debug!("Requesting change summary from {}", provider.model());
    let raw_response = provider
        .completion(system_prompt, &user_prompt, MAX_SUMMARY_TOKENS, TEMPERATURE)
        .await?;

    info!("Generated change summary ({} chars)", raw_response.len());
    debug!(
        "Raw change summary response from {}: {}",
        provider.model(),
        raw_response
    );

    // Parse the JSON response
    match serde_json::from_str::<ChangeSummary>(&raw_response) {
        Ok(summary) => Ok(summary),
        Err(e) => {
            warn!("Failed to parse summary JSON: {}. Raw: {}", e, raw_response);
            // Return a fallback summary
            Ok(ChangeSummary {
                items: vec![SummaryItem {
                    title: "Configuration Updated".to_string(),
                    description: "Your nix-darwin configuration has been modified.".to_string(),
                }],
                instructions: "Preview your changes to see them in action.".to_string(),
            })
        }
    }
}

/// Generate a suggested commit message based on the changes.
///
/// Returns a conventional commit style message that can be used as-is
/// or edited by the user.
pub async fn generate_commit_message<R: Runtime>(
    diff: &str,
    file_list: &[String],
    app_handle: Option<&AppHandle<R>>,
) -> Result<String> {
    if diff.is_empty() && file_list.is_empty() {
        return Ok("chore: no changes".to_string());
    }

    let provider = create_provider(app_handle)?;

    let file_summary = if file_list.is_empty() {
        String::new()
    } else {
        format!("\n\nModified files:\n{}", file_list.join("\n"))
    };

    let truncated_diff = if diff.len() > 6000 {
        format!("{}...\n[diff truncated]", &diff[..6000])
    } else {
        diff.to_string()
    };

    let system_prompt = "You generate git commit messages following conventional commit format. \
                    Format: <type>(<scope>): <description>\n\n\
                    Types: feat, fix, chore, refactor, docs, style, test, perf\n\
                    Scope: optional, the area of the codebase (e.g., darwin, homebrew, git)\n\
                    Description: imperative mood, lowercase, no period at end\n\n\
                    Examples:\n\
                    - feat(darwin): add vim to system packages\n\
                    - fix(homebrew): correct Rectangle app cask name\n\
                    - chore: update flake inputs\n\n\
                    Return ONLY the commit message, nothing else.";

    let user_prompt = format!(
        "Generate a commit message for these nix-darwin changes:\n\n\
        ```diff\n{}\n```{}",
        truncated_diff, file_summary
    );

    debug!("Requesting commit message from {}", provider.model());
    let response = provider
        .completion(system_prompt, &user_prompt, 100u32, 0.2)
        .await?;

    let message = response.trim().to_string();
    let message = if message.is_empty() {
        "chore: update configuration".to_string()
    } else {
        message
    };

    debug!(
        "Raw commit message response from {}: {}",
        provider.model(),
        response
    );
    info!("Generated commit message: {}", message);
    Ok(message)
}

/// Batch summarize both changes and generate commit message.
/// More efficient than calling each separately.
pub async fn summarize_for_preview<R: Runtime>(
    diff: &str,
    file_list: &[String],
    app_handle: Option<&AppHandle<R>>,
) -> Result<(ChangeSummary, String)> {
    // Run both in parallel
    let (summary, commit_msg) = tokio::join!(
        summarize_changes(diff, file_list, app_handle),
        generate_commit_message(diff, file_list, app_handle)
    );

    Ok((summary?, commit_msg?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_changes() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let summary = summarize_changes::<tauri::Wry>("", &[], None).await;
            assert!(summary.is_ok());
            let result = summary.unwrap();
            assert_eq!(result.items.len(), 1);
            assert_eq!(result.items[0].title, "No changes");
        });
    }
}
