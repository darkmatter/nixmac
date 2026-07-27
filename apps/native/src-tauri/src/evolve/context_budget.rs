//! Keep evolve provider calls from requesting a tiny leftover completion budget.
//!
//! When the filtered message history nearly fills the model window, we drop the
//! oldest keyed tool results until there is room for a meaningful response
//! (or stop the run if the irreducible core is still too large).

use super::{EvolutionMessage, filter_evolution_messages};
use crate::ai::model_capabilities::capabilities_for_model;
use crate::evolve::messages::Message;
use crate::summarize::token_budgets::{TokenAllocation, compute_token_allocation};
use log::warn;

/// Minimum completion budget we will send on an evolve request. Below this the
/// model tends to emit truncated / empty tool calls and rabbit-hole — better to
/// compact or stop than to request ~32 leftover tokens.
pub(crate) const EVOLVE_MIN_OUTPUT_TOKENS: u32 = 1024;

const MAX_DROPS: usize = 32;

/// Flatten provider messages into text for token estimation.
fn estimate_messages_prompt_text(messages: &[Message]) -> String {
    let mut out = String::new();
    for message in messages {
        match message {
            Message::System { content }
            | Message::User { content }
            | Message::Tool { content, .. } => {
                out.push_str(content);
                out.push('\n');
            }
            Message::Assistant {
                content,
                tool_calls,
            } => {
                if let Some(text) = content {
                    out.push_str(text);
                }
                if let Some(calls) = tool_calls {
                    for call in calls {
                        out.push_str(&call.name);
                        out.push('\n');
                        out.push_str(&call.arguments);
                        out.push('\n');
                    }
                }
                out.push('\n');
            }
        }
    }
    out
}

fn allocate_evolve_completion(
    messages: &[Message],
    model: &str,
    requested_output_tokens: u32,
) -> TokenAllocation {
    let prompt = estimate_messages_prompt_text(messages);
    let context_window = capabilities_for_model(model).context_window_tokens;
    compute_token_allocation(&prompt, requested_output_tokens, context_window)
}

fn find_oldest_keyed_tool_index(messages: &[EvolutionMessage]) -> Option<usize> {
    messages
        .iter()
        .position(|m| m.key.is_some() && matches!(m.message, Message::Tool { .. }))
}

/// True when the message before `tool_idx` is a lone assistant tool-call turn for
/// this id (no text). Dropping that pair keeps the provider transcript valid.
fn is_lone_tool_call_assistant(
    messages: &[EvolutionMessage],
    tool_idx: usize,
    tool_call_id: &str,
) -> bool {
    if tool_idx == 0 {
        return false;
    }

    let Message::Assistant {
        tool_calls: Some(calls),
        content,
    } = &messages[tool_idx - 1].message
    else {
        return false;
    };

    if calls.len() != 1 || calls[0].id != tool_call_id {
        return false;
    }

    content.as_ref().is_none_or(|c| c.trim().is_empty())
}

/// Drop the oldest keyed tool result (and its paired assistant tool-call turn when
/// that turn only existed to produce this result). Used under context pressure so
/// we free room for a meaningful completion instead of requesting ~32 tokens.
fn drop_oldest_keyed_tool_result(messages: &mut Vec<EvolutionMessage>) -> bool {
    let Some(tool_idx) = find_oldest_keyed_tool_index(messages) else {
        return false;
    };

    let tool_call_id = match &messages[tool_idx].message {
        Message::Tool { tool_call_id, .. } => tool_call_id.clone(),
        _ => return false,
    };

    if is_lone_tool_call_assistant(messages, tool_idx, &tool_call_id) {
        // Remove tool result first so indices stay valid, then the assistant turn.
        messages.remove(tool_idx);
        messages.remove(tool_idx - 1);
        return true;
    }

    messages.remove(tool_idx);
    true
}

fn context_full_error(provider_messages: &[Message], model: &str, output_tokens: u32) -> String {
    format!(
        "Context window is full ({}/{} tokens estimated for input) with only {} completion tokens left. \
         Compaction could not free enough room for a meaningful response. Try a shorter prompt or a model with a larger context window.",
        estimate_messages_prompt_text(provider_messages).len() / 4,
        capabilities_for_model(model).context_window_tokens,
        output_tokens
    )
}

/// Ensure the active provider payload leaves enough room for a useful completion.
/// Compacts by dropping oldest keyed tool results until the allocation clears the
/// floor, or returns an error if even the irreducible core is too large.
pub(crate) fn ensure_meaningful_completion_budget(
    messages: &mut Vec<EvolutionMessage>,
    iteration: usize,
    made_build_check: bool,
    model: &str,
    requested_output_tokens: u32,
) -> Result<u32, String> {
    let min_required = EVOLVE_MIN_OUTPUT_TOKENS.min(requested_output_tokens);

    for _ in 0..MAX_DROPS {
        let active = filter_evolution_messages(messages, iteration, made_build_check);
        let provider_messages: Vec<Message> = active.iter().map(|m| m.message.clone()).collect();
        let allocation =
            allocate_evolve_completion(&provider_messages, model, requested_output_tokens);

        if allocation.output_tokens >= min_required {
            return Ok(allocation.output_tokens.min(requested_output_tokens));
        }

        if !drop_oldest_keyed_tool_result(messages) {
            return Err(context_full_error(
                &provider_messages,
                model,
                allocation.output_tokens,
            ));
        }

        warn!(
            "Context pressure: dropped oldest keyed tool result to free completion budget (had {} output tokens available)",
            allocation.output_tokens
        );
    }

    Err(
        "Context window remained too full after compaction; stopping before sending a truncated-completion request."
            .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evolve::messages::ToolCall;

    #[test]
    fn drops_keyed_tool_results_under_pressure() {
        let mut messages = vec![
            EvolutionMessage::permanent(
                Message::System {
                    content: "System prompt".to_string(),
                },
                0,
                None,
            ),
            EvolutionMessage::permanent(
                Message::User {
                    content: "do the thing".to_string(),
                },
                0,
                None,
            ),
        ];

        // Pair an assistant tool call with a large keyed tool result so the
        // pressure gate must drop them. Unique tokens (not repeated chars) so
        // tiktoken cannot compress the fixture under the model window.
        let huge: String = (0..12_000).map(|i| format!("token{i} ")).collect();
        messages.push(EvolutionMessage::permanent(
            Message::Assistant {
                content: None,
                tool_calls: Some(vec![ToolCall {
                    id: "call-1".to_string(),
                    name: "read_file".to_string(),
                    arguments: "{\"path\":\"big.nix\"}".to_string(),
                }]),
            },
            1,
            None,
        ));
        messages.push(EvolutionMessage::recent(
            Message::Tool {
                tool_call_id: "call-1".to_string(),
                content: huge,
            },
            1,
            4,
            Some("big.nix".to_string()),
        ));

        let before = messages.len();
        let tokens = ensure_meaningful_completion_budget(
            &mut messages,
            2,
            false,
            "unknown-model", // 8k context window
            4_000,
        )
        .expect("should compact enough room for a meaningful completion");

        assert!(tokens >= EVOLVE_MIN_OUTPUT_TOKENS.min(4_000));
        assert!(messages.len() < before);
    }

    #[test]
    fn lone_assistant_tool_call_is_detected() {
        let messages = vec![
            EvolutionMessage::permanent(
                Message::Assistant {
                    content: None,
                    tool_calls: Some(vec![ToolCall {
                        id: "call-1".to_string(),
                        name: "read_file".to_string(),
                        arguments: "{}".to_string(),
                    }]),
                },
                1,
                None,
            ),
            EvolutionMessage::recent(
                Message::Tool {
                    tool_call_id: "call-1".to_string(),
                    content: "ok".to_string(),
                },
                1,
                4,
                Some("path".to_string()),
            ),
        ];

        assert!(is_lone_tool_call_assistant(&messages, 1, "call-1"));
        assert!(!is_lone_tool_call_assistant(&messages, 1, "other"));
    }
}
