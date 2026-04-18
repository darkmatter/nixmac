use super::messages::Message;
use chrono::{DateTime, Utc};
use log::debug;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

pub const DEFAULT_THREAD_MAX_MESSAGES: usize = 10;
pub const DEFAULT_THREAD_MAX_TOKENS: usize = 4_000;

/// Role type for chat messages, used for chat memory storage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
    Tool,
}

/// Chat message type for memory storage, with timestamp for eviction and debugging.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
    pub timestamp: DateTime<Utc>,
}

/// Maximum limits for chat memory retention, used to enforce eviction of oldest messages.
#[derive(Debug, Clone, Copy)]
pub struct ThreadLimits {
    pub max_messages: usize,
    pub max_tokens: usize,
}

/// Default limits for chat memory retention if not specified by the app or provider configuration.
impl Default for ThreadLimits {
    fn default() -> Self {
        Self {
            max_messages: DEFAULT_THREAD_MAX_MESSAGES,
            max_tokens: DEFAULT_THREAD_MAX_TOKENS,
        }
    }
}

/// Trait for chat memory storage, allowing for different implementations (in-memory, sqlite, etc.).
pub trait ChatMemoryStore: Send + Sync {
    /// Appends a new message at the tail only.
    ///
    /// Memory is intentionally append-only to preserve strict chronology and
    /// avoid retroactive mutation of prior context.
    fn append(&self, message: ChatMessage);

    fn snapshot(&self) -> Vec<ChatMessage>;

    /// Clears all messages from the store.
    #[allow(unused)]
    fn clear(&self);
}

/// In-memory implementation of the ChatMemoryStore trait, using a VecDeque for efficient eviction of oldest messages.
pub struct InMemoryChatMemoryStore {
    messages: Mutex<VecDeque<ChatMessage>>,
    limits: ThreadLimits,
}

/// In-memory chat memory store implementation with eviction based on message count and token count limits.
impl InMemoryChatMemoryStore {
    pub fn new(limits: ThreadLimits) -> Self {
        Self {
            messages: Mutex::new(VecDeque::new()),
            limits,
        }
    }
}

/// ChatMemoryStore implementation for InMemoryChatMemoryStore, enforcing limits on message count
/// and token count by evicting oldest messages when limits are exceeded.
impl ChatMemoryStore for InMemoryChatMemoryStore {
    fn append(&self, message: ChatMessage) {
        if message.content.trim().is_empty() {
            debug!("[chat_memory] skipping empty message append");
            return;
        }
        let role = message.role.clone();

        // Lock once to compute before_count, push the new message, enforce limits,
        // and compute the post-update metrics.
        let mut guard = self.messages.lock().unwrap_or_else(|e| e.into_inner());
        let before_count = guard.len();
        guard.push_back(message);
        enforce_limits(&mut guard, self.limits);

        let after_count = guard.len();
        let total_tokens = estimate_total_tokens(&guard);
        debug!(
            "[chat_memory] append role={:?} before={} after={} total_tokens={} max_messages={} max_tokens={}",
            role,
            before_count,
            after_count,
            total_tokens,
            self.limits.max_messages,
            self.limits.max_tokens
        );
    }

    fn snapshot(&self) -> Vec<ChatMessage> {
        let messages = self.messages.lock().unwrap_or_else(|e| e.into_inner());
        debug!("[chat_memory] snapshot count={}", messages.len());
        messages.iter().cloned().collect()
    }

    fn clear(&self) {
        let mut guard = self.messages.lock().unwrap_or_else(|e| e.into_inner());
        let before = guard.len();
        guard.clear();
        debug!(
            "[chat_memory] cleared messages count_before={} count_after=0",
            before
        );
    }
}

static SESSION_CHAT_MEMORY: Lazy<Arc<dyn ChatMemoryStore>> = Lazy::new(|| {
    Arc::new(InMemoryChatMemoryStore::new(ThreadLimits::default())) as Arc<dyn ChatMemoryStore>
});

pub fn session_chat_memory_store() -> Arc<dyn ChatMemoryStore> {
    Arc::clone(&SESSION_CHAT_MEMORY)
}

pub fn to_provider_context_messages(store: &dyn ChatMemoryStore) -> Vec<Message> {
    // Provider context only includes persisted thread messages, never system prompts.
    // System instructions are regenerated per request and applied at generation time.
    // Tool-role messages are intentionally never restored in this session memory mode
    // to reduce prompt bloat and avoid accidentally injecting sensitive tool output.
    let messages = store
        .snapshot()
        .into_iter()
        .filter_map(|msg| match msg.role {
            Role::User => Some(Message::User {
                content: msg.content,
            }),
            Role::Assistant => Some(Message::Assistant {
                content: Some(msg.content),
                tool_calls: None,
            }),
            Role::Tool => None,
        })
        .collect::<Vec<_>>();

    debug!(
        "[chat_memory] restored provider context messages={}",
        messages.len()
    );

    messages
}

/// Enforces the configured limits on the chat memory by evicting oldest messages until both
/// the message count and the estimated token count are within limits. Logs eviction actions for debugging.
fn enforce_limits(messages: &mut VecDeque<ChatMessage>, limits: ThreadLimits) {
    let before_count = messages.len();

    while messages.len() > limits.max_messages {
        messages.pop_front();
    }

    // Evict oldest messages while we have more than one message and are over the
    // token budget. We intentionally keep at least one message in the queue to
    // avoid dropping the entire thread, but if that single remaining message
    // itself exceeds the token budget we must truncate it so `max_tokens` is
    // always respected.
    while messages.len() > 1 && estimate_total_tokens(messages) > limits.max_tokens {
        messages.pop_front();
    }

    // If after evictions we're still over the token budget and only a single
    // message remains, truncate its content to fit the budget instead of
    // keeping an oversized message.
    if estimate_total_tokens(messages) > limits.max_tokens {
        if messages.len() == 1 {
            if let Some(msg) = messages.front_mut() {
                // Approximate max chars from token budget using same heuristic
                // as `estimate_tokens` (chars / 4). Multiply tokens by 4 to get
                // an allowed character budget.
                let max_chars = limits.max_tokens.saturating_mul(4);

                crate::evolve::global_utils::truncate_utf8(&mut msg.content, max_chars);
                debug!(
                    "[chat_memory] truncated single oversized message to fit token budget max_tokens={} resulting_chars={}",
                    limits.max_tokens,
                    msg.content.chars().count()
                );
            }
        } else {
            // As a fallback keep popping until within budget.
            while messages.len() > 1 && estimate_total_tokens(messages) > limits.max_tokens {
                messages.pop_front();
            }
        }
    }

    let after_count = messages.len();
    if after_count < before_count {
        debug!(
            "[chat_memory] evicted oldest messages count_before={} count_after={} total_tokens_after={}",
            before_count,
            after_count,
            estimate_total_tokens(messages)
        );
    }
}

/// Estimates the total token count for a list of chat messages using a simple heuristic based on character count.
/// We could use a more sophisticated tokenization approach if needed, but this is sufficient for
/// eviction behavior and much faster to compute and doesn't require any external dependencies.
fn estimate_total_tokens(messages: &VecDeque<ChatMessage>) -> usize {
    messages
        .iter()
        .map(|m| estimate_tokens(&m.content))
        .sum::<usize>()
}

fn estimate_tokens(content: &str) -> usize {
    let char_count = content.chars().count();
    if char_count == 0 {
        return 0;
    }

    // Fast heuristic for budgeting context size.
    // This does not need to be exact for eviction behavior to be useful.
    char_count.div_ceil(4)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, TimeZone};

    fn msg(role: Role, content: &str, second: i64) -> ChatMessage {
        ChatMessage {
            role,
            content: content.to_string(),
            timestamp: Utc.timestamp_opt(second, 0).single().unwrap(),
        }
    }

    #[test]
    fn evicts_oldest_when_message_limit_exceeded() {
        let store = InMemoryChatMemoryStore::new(ThreadLimits {
            max_messages: 3,
            max_tokens: 10_000,
        });

        store.append(msg(Role::User, "first", 1));
        store.append(msg(Role::Assistant, "second", 2));
        store.append(msg(Role::User, "third", 3));
        store.append(msg(Role::Assistant, "fourth", 4));

        let snapshot = store.snapshot();
        assert_eq!(snapshot.len(), 3);
        assert_eq!(snapshot[0].content, "second");
        assert_eq!(snapshot[1].content, "third");
        assert_eq!(snapshot[2].content, "fourth");

        // Chronological order must remain strictly increasing after eviction.
        assert!(snapshot[0].timestamp < snapshot[1].timestamp);
        assert!(snapshot[1].timestamp < snapshot[2].timestamp);
    }

    #[test]
    fn evicts_oldest_when_token_limit_exceeded() {
        let store = InMemoryChatMemoryStore::new(ThreadLimits {
            max_messages: 10,
            max_tokens: 2,
        });

        // ~2 tokens each using the chars/4 heuristic.
        store.append(msg(Role::User, "aaaa", 1));
        store.append(msg(Role::Assistant, "bbbb", 2));
        store.append(msg(Role::User, "cccc", 3));
        store.append(msg(Role::Assistant, "dddd", 4));
        // Total would exceed 2 tokens after this append; oldest should be evicted.
        store.append(msg(Role::User, "eeee", 5));

        let snapshot = store.snapshot();
        let total_tokens = snapshot
            .iter()
            .map(|m| estimate_tokens(&m.content))
            .sum::<usize>();

        assert!(total_tokens <= 2);
        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot.first().map(|m| m.content.as_str()), Some("dddd"));
        assert_eq!(snapshot.last().map(|m| m.content.as_str()), Some("eeee"));
    }

    #[test]
    fn truncates_single_oversized_message() {
        let store = InMemoryChatMemoryStore::new(ThreadLimits {
            max_messages: 10,
            max_tokens: 1,
        });

        // Append a single very long message which exceeds the token budget.
        let long = "x".repeat(20);
        store.append(msg(Role::Assistant, &long, 1));

        let snapshot = store.snapshot();
        assert_eq!(snapshot.len(), 1);

        // With max_tokens=1 and the heuristic chars/4, allowed chars ~= 4.
        let content_chars = snapshot[0].content.chars().count();
        assert!(
            content_chars <= 4,
            "message was not truncated: {} chars",
            content_chars
        );
    }

    #[test]
    fn provider_context_omits_tool_messages() {
        let store = InMemoryChatMemoryStore::new(ThreadLimits {
            max_messages: 10,
            max_tokens: 10_000,
        });

        let base = Utc.with_ymd_and_hms(2026, 4, 8, 10, 0, 0).unwrap();
        store.append(ChatMessage {
            role: Role::User,
            content: "user".to_string(),
            timestamp: base,
        });
        store.append(ChatMessage {
            role: Role::Tool,
            content: "secret tool output".to_string(),
            timestamp: base + Duration::seconds(1),
        });
        store.append(ChatMessage {
            role: Role::Assistant,
            content: "assistant".to_string(),
            timestamp: base + Duration::seconds(2),
        });

        let context = to_provider_context_messages(&store);
        assert_eq!(context.len(), 2);
        assert!(matches!(context[0], Message::User { .. }));
        assert!(matches!(context[1], Message::Assistant { .. }));
    }

    #[test]
    fn clears_all_messages() {
        let store = InMemoryChatMemoryStore::new(ThreadLimits {
            max_messages: 10,
            max_tokens: 10_000,
        });

        store.append(msg(Role::User, "one", 1));
        store.append(msg(Role::Assistant, "two", 2));

        let snapshot = store.snapshot();
        assert_eq!(snapshot.len(), 2);

        store.clear();

        let snapshot = store.snapshot();
        assert_eq!(snapshot.len(), 0);
    }
}
