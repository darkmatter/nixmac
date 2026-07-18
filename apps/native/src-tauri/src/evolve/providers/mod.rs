use super::messages::{Message, Tool};
use crate::ai::provider_errors::friendly_provider_error;
use anyhow::Error as AnyhowError;
use async_trait::async_trait;
use reqwest::StatusCode;
use thiserror::Error;

pub mod cli;
pub mod ollama;
pub mod openai;

pub use cli::CliProvider;
pub use ollama::OllamaProvider;
pub use openai::OpenAIProvider;

#[derive(Debug, Clone)]
pub struct TokenUsage {
    pub input: u32,
    pub output: u32,
    pub total: u32,
}

#[derive(Debug)]
pub struct ProviderResponse {
    pub message: Message,
    pub usage: Option<TokenUsage>,
}

/// A streamed signal from a provider mid-completion.
pub enum StreamEvent<'a> {
    /// Text to append to the visible stream tail.
    Delta(&'a str),
    /// The provider abandoned the partial response (it is retrying); the
    /// visible tail should discard what this attempt streamed.
    Reset,
}

/// Callback receiving streamed events as they arrive.
pub type OnDelta<'a> = &'a (dyn Fn(StreamEvent<'_>) + Send + Sync);

/// The line streamed when a tool call's name arrives, before its arguments
/// finish generating: the tool's shared action label (see
/// `types::tool_action_label`) on its own arrow-prefixed line. None for
/// `think`, whose thought text streams instead of an announcement.
pub(crate) fn tool_call_announcement(tool: &str) -> Option<String> {
    let label = crate::types::tool_action_label(tool)?;
    Some(format!("\n\u{2192} {}\n", label))
}

/// Incrementally extracts the `think` tool's `thought` string value from
/// streamed JSON argument fragments, so the model's reasoning can be
/// displayed while it generates. Models in the evolve loop emit most of
/// their tokens as tool-call arguments, not assistant content — without
/// this, streaming has almost nothing to show.
///
/// Feed fragments in arrival order via [`Self::push`]; each call returns the
/// newly decoded thought text (JSON string escapes resolved), empty until
/// the `"thought":"` prefix has been seen and after the closing quote.
#[derive(Default)]
pub struct ThoughtExtractor {
    /// Unprocessed input: everything not yet consumed by the scanner. While
    /// seeking the key this accumulates fragments; inside the value it holds
    /// at most a partial escape sequence.
    pending: String,
    state: ThoughtExtractorState,
}

#[derive(Default, PartialEq)]
enum ThoughtExtractorState {
    #[default]
    SeekingKey,
    /// Key found; expecting (whitespace and) a colon then the opening quote.
    SeekingValue,
    InValue,
    Done,
}

impl ThoughtExtractor {
    pub fn push(&mut self, fragment: &str) -> String {
        self.pending.push_str(fragment);
        let mut out = String::new();
        loop {
            match self.state {
                ThoughtExtractorState::SeekingKey => {
                    let Some(pos) = self.pending.find("\"thought\"") else {
                        // Keep a tail so a key split across fragments still
                        // matches; anything older can never match.
                        let keep = self.pending.len().min("\"thought\"".len() - 1);
                        let cut = self.pending.len() - keep;
                        self.pending.drain(..self.pending.floor_char_boundary(cut));
                        return out;
                    };
                    self.pending.drain(..pos + "\"thought\"".len());
                    self.state = ThoughtExtractorState::SeekingValue;
                }
                ThoughtExtractorState::SeekingValue => {
                    let Some((idx, ch)) = self
                        .pending
                        .char_indices()
                        .find(|(_, c)| !c.is_whitespace())
                    else {
                        self.pending.clear();
                        return out;
                    };
                    match ch {
                        ':' => {
                            self.pending.drain(..=idx);
                        }
                        '"' => {
                            self.pending.drain(..=idx);
                            self.state = ThoughtExtractorState::InValue;
                        }
                        // Not a key after all (e.g. "category": "thought");
                        // resume the search.
                        _ => {
                            self.state = ThoughtExtractorState::SeekingKey;
                        }
                    }
                }
                ThoughtExtractorState::InValue => {
                    let (decoded, consumed, closed) = decode_json_string_prefix(&self.pending);
                    out.push_str(&decoded);
                    self.pending.drain(..consumed);
                    if closed {
                        self.state = ThoughtExtractorState::Done;
                    }
                    return out;
                }
                ThoughtExtractorState::Done => {
                    self.pending.clear();
                    return out;
                }
            }
        }
    }
}

/// Decode the body of a JSON string from `input` until its closing quote or
/// the end of the available bytes. Returns the decoded text, the number of
/// input bytes consumed, and whether the closing quote was reached. A
/// trailing partial escape sequence is left unconsumed for the next call.
fn decode_json_string_prefix(input: &str) -> (String, usize, bool) {
    let mut out = String::new();
    let mut chars = input.char_indices().peekable();
    let mut consumed = 0;
    while let Some((idx, ch)) = chars.next() {
        match ch {
            '"' => return (out, idx + 1, true),
            '\\' => {
                let Some((_, esc)) = chars.next() else {
                    // Partial escape: wait for the next fragment.
                    return (out, idx, false);
                };
                match esc {
                    'n' => out.push('\n'),
                    't' => out.push('\t'),
                    'r' => out.push('\r'),
                    'b' | 'f' => {}
                    'u' => {
                        let hex_start = idx + 2;
                        let Some(hex) = input.get(hex_start..hex_start + 4) else {
                            return (out, idx, false);
                        };
                        let code = u32::from_str_radix(hex, 16).ok();

                        // Non-BMP characters (emoji etc.) arrive as UTF-16
                        // surrogate pairs: a high surrogate escape followed
                        // by a low one. Combine them; a pair split across
                        // fragments is held until both halves are buffered.
                        if let Some(hi) = code.filter(|c| (0xD800..=0xDBFF).contains(c)) {
                            let pair_start = hex_start + 4;
                            // ASCII hex precedes pair_start, so this is a
                            // valid boundary.
                            let rest = &input.as_bytes()[pair_start..];
                            let escape_prefix = &b"\\u"[..rest.len().min(2)];
                            if rest.len() < 6 && rest.starts_with(escape_prefix) {
                                // The low surrogate may still be arriving —
                                // what's buffered so far is a prefix of a
                                // possible \uXXXX escape.
                                return (out, idx, false);
                            }
                            let low = input
                                .get(pair_start..pair_start + 6)
                                .and_then(|s| s.strip_prefix("\\u"))
                                .and_then(|h| u32::from_str_radix(h, 16).ok())
                                .filter(|c| (0xDC00..=0xDFFF).contains(c));
                            if let Some(lo) = low {
                                let scalar = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00);
                                if let Some(c) = char::from_u32(scalar) {
                                    out.push(c);
                                }
                                // Skip this escape's hex plus the whole
                                // second escape (all ASCII).
                                for _ in 0..10 {
                                    chars.next();
                                }
                                consumed = pair_start + 6;
                                continue;
                            }
                            // Lone high surrogate: drop it and move on.
                        } else if let Some(c) = code.and_then(char::from_u32) {
                            out.push(c);
                        }
                        // Skip the 4 hex chars (ASCII, 1 byte each).
                        for _ in 0..4 {
                            chars.next();
                        }
                        consumed = hex_start + 4;
                        continue;
                    }
                    other => out.push(other),
                }
                consumed = idx + 1 + esc.len_utf8();
            }
            _ => {
                consumed = idx + ch.len_utf8();
                out.push(ch);
            }
        }
    }
    (out, consumed, false)
}

#[async_trait]
pub trait AiProvider: Send + Sync {
    async fn completion(
        &self,
        messages: &[Message],
        tools: &[Tool],
    ) -> std::result::Result<ProviderResponse, ProviderError>;

    /// Like [`Self::completion`], but forwards assistant-text deltas to
    /// `on_delta` while the response is assembled. The returned response is
    /// identical to the blocking call's. The default delegates to
    /// [`Self::completion`] without deltas — the CLI provider can never
    /// stream (its stdout is the parsed payload, arriving whole on exit),
    /// and the accepted design gives it no filler treatment (design §7).
    async fn completion_streaming(
        &self,
        messages: &[Message],
        tools: &[Tool],
        _on_delta: OnDelta<'_>,
    ) -> std::result::Result<ProviderResponse, ProviderError> {
        self.completion(messages, tools).await
    }

    fn model_name(&self) -> String;
}

/// Errors returned by AI providers in the evolve subsystem.
///
/// Purpose:
/// - Represent provider-level failures while preserving useful debug data for
///   local diagnostics and UI display (HTTP status and provider response body).
///
/// Security & privacy rules:
/// - `Http { status, body }` intentionally keeps the full response `body` for
///   *local* debugging and UI only. Depending on the AI provider,
///   the body may contain sensitive data (prompts, completions, or user content)
///   and MUST NOT be sent to remote diagnostics (Sentry, analytics) in raw form.
/// - Before sending anything to remote telemetry, use a redaction/summary helper
///   to send only non-sensitive metadata such as status code, error type, length,
///   and a correlation hash. Never send `body` itself.
///
/// API guidance for callers:
/// - Prefer matching on `ProviderError` directly when you need `status` or the
///   full `body` for local handling:
///     - `ProviderError::Http { status, body }` — safe to inspect for local logs/UI.
///     - `ProviderError::Other(e)` — wrapper for non-HTTP errors (keeps original error).
/// - If a public API returns `anyhow::Error` (error erasure), callers that need
///   `ProviderError` can downcast the `anyhow::Error` with `err.downcast_ref::<ProviderError>()`
///   or `err.downcast::<ProviderError>()` to recover the concrete error and inspect `status`.
/// - Avoid `format!("{}", e)` or `e.to_string()` for remote reporting because
///   `Display` includes the raw body for `Http` variants.
///
/// See `report_provider_error` in `evolve/mod.rs` for an example of safe telemetry
/// reporting and `extract_error_metadata` for extracting non-sensitive fields.
#[derive(Debug, Error)]
pub enum ProviderError {
    /// HTTP-style error with status code and body
    #[error("http error {status}: {body}")]
    Http { status: StatusCode, body: String },
    /// Other error (wrapped anyhow::Error)
    #[error(transparent)]
    Other(AnyhowError),
}

fn looks_like_context_window_error(body: &str) -> bool {
    let body = body.to_ascii_lowercase();
    (body.contains("context")
        || body.contains("maximum context")
        || body.contains("context length"))
        && (body.contains("max_tokens")
            || body.contains("max_output_tokens")
            || body.contains("max tokens")
            || body.contains("max completion")
            || body.contains("output tokens")
            || body.contains("token limit")
            || body.contains("requested"))
}

impl ProviderError {
    /// Return a user-friendly error message suitable for display in the UI.
    ///
    /// Translates raw provider errors into actionable guidance without
    /// exposing technical details like JSON payloads or deserialization failures.
    /// The concrete `OpenAIError` matching in `openai.rs` ensures that both
    /// standard API errors and deserialization failures are already mapped to
    /// `Http { status, body }` before reaching this method.
    pub fn user_message(&self) -> String {
        match self {
            ProviderError::Http { status: _, body } if looks_like_context_window_error(body) => {
                "The AI provider rejected the request because the configured max output tokens exceed the model's context window. Lower Max output tokens in Settings or switch to a model with a larger context window.".to_string()
            }
            ProviderError::Http { status, .. } => friendly_provider_error(status.as_u16()),
            ProviderError::Other(e) => {
                let msg = format!("{:#}", e);
                // Preserve controlled messages that are already user-friendly.
                // These are our own anyhow errors from setup validation, not
                // raw provider/network errors:
                //   - "No API key found. Please add your API key in Settings..."
                //   - "No host attribute configured. Please set a host first."
                if msg.contains("API key") || msg.contains("No host") {
                    msg
                } else {
                    // Transport errors, DNS failures, connection refused, etc.
                    // should not leak raw technical text to the user.
                    "Something went wrong connecting to the AI provider. Please check your connection and try again.".to_string()
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extract_split(json: &str, at: usize) -> String {
        let mut extractor = ThoughtExtractor::default();
        let split = json.floor_char_boundary(at.min(json.len()));
        let mut out = extractor.push(&json[..split]);
        out.push_str(&extractor.push(&json[split..]));
        out
    }

    #[test]
    fn thought_extractor_decodes_a_whole_payload() {
        let json = r#"{"category":"planning","thought":"Add vim.\nThen check."}"#;
        let mut extractor = ThoughtExtractor::default();
        assert_eq!(extractor.push(json), "Add vim.\nThen check.");
    }

    #[test]
    fn thought_extractor_survives_any_fragment_boundary() {
        let json = r#"{"category":"debugging","thought":"Fix the \"broken\" attr → done"}"#;
        let expected = "Fix the \"broken\" attr \u{2192} done";
        for at in 0..json.len() {
            assert_eq!(extract_split(json, at), expected, "split at {at}");
        }
    }

    #[test]
    fn thought_extractor_streams_incrementally() {
        let mut extractor = ThoughtExtractor::default();
        assert_eq!(extractor.push(r#"{"thought":"Hel"#), "Hel");
        assert_eq!(extractor.push("lo wor"), "lo wor");
        assert_eq!(extractor.push(r#"ld"}"#), "ld");
        assert_eq!(extractor.push("ignored"), "");
    }

    #[test]
    fn thought_extractor_ignores_thought_as_a_value() {
        let json = r#"{"category":"thought","thought":"real text"}"#;
        let mut extractor = ThoughtExtractor::default();
        assert_eq!(extractor.push(json), "real text");
    }

    #[test]
    fn thought_extractor_combines_surrogate_pairs_at_any_boundary() {
        // JSON encodes 😀 (U+1F600) as the surrogate pair \uD83D\uDE00; it
        // must decode whole wherever the fragment boundary lands — before,
        // between, or inside the escapes.
        let json = r#"{"thought":"done \uD83D\uDE00 next"}"#;
        let expected = "done \u{1F600} next";
        let mut extractor = ThoughtExtractor::default();
        assert_eq!(extractor.push(json), expected);
        for at in 0..json.len() {
            assert_eq!(extract_split(json, at), expected, "split at {at}");
        }
    }

    #[test]
    fn thought_extractor_drops_lone_surrogates() {
        let mut extractor = ThoughtExtractor::default();
        assert_eq!(
            extractor.push(r#"{"thought":"a \uD83D b"}"#),
            "a  b",
            "an unpaired high surrogate cannot be rendered"
        );
    }

    #[test]
    fn tool_announcements_use_the_timeline_voice() {
        assert_eq!(
            tool_call_announcement("edit_nix_file").as_deref(),
            Some("\n\u{2192} Editing configuration...\n")
        );
        assert_eq!(
            tool_call_announcement("build_check").as_deref(),
            Some("\n\u{2192} Checking the configuration builds...\n")
        );
        assert_eq!(
            tool_call_announcement("future_tool").as_deref(),
            Some("\n\u{2192} Using future_tool tool...\n")
        );
        // The think tool streams its thought text instead.
        assert_eq!(tool_call_announcement("think"), None);
    }

    #[test]
    fn thought_extractor_returns_nothing_without_the_key() {
        let mut extractor = ThoughtExtractor::default();
        assert_eq!(
            extractor.push(r#"{"path":"flake.nix","values":["vim"]}"#),
            ""
        );
    }

    #[test]
    fn recognizes_context_window_token_errors() {
        let body = "This model's maximum context length is 65536 tokens. However, you requested 65000 output tokens.";
        assert!(looks_like_context_window_error(body));
    }

    #[test]
    fn context_window_errors_suggest_token_setting() {
        let err = ProviderError::Http {
            status: StatusCode::BAD_REQUEST,
            body: "maximum context length is 65536 tokens; requested max_tokens is too high"
                .to_string(),
        };

        let msg = err.user_message();
        assert!(msg.contains("Max output tokens"));
        assert!(msg.contains("Lower"));
    }
}
