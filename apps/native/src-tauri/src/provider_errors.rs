//! Provider error classification and user-friendly message generation.
//!
//! Centralises OpenAI/OpenRouter error handling so both the evolve and
//! summary/completion paths stay in sync. The flow is:
//!
//!   OpenAIError → classify_openai_error() → (status, message)
//!                                             ↓
//!                                  friendly_provider_error(status)
//!
//! Callers wrap the result into their own error type (`anyhow::Error` or
//! `ProviderError::Http`) — this module only handles classification.

use async_openai::error::OpenAIError;

/// Map an OpenAI/OpenRouter symbolic error code to an HTTP status code.
///
/// Returns `None` for unrecognised codes — callers should treat those as 500.
pub fn openai_error_code_to_status(code: &str) -> Option<u16> {
    match code {
        "invalid_api_key" => Some(401),
        "insufficient_quota" | "billing_hard_limit_reached" => Some(402),
        "rate_limit_exceeded" => Some(429),
        _ => None,
    }
}

/// Classify an `OpenAIError` into an HTTP status code and provider message.
///
/// Handles two async_openai variants:
/// - `ApiError` — standard errors that async_openai parsed successfully.
/// - `JSONDeserialize` — non-standard payloads (e.g. OpenRouter integer `code`).
///
/// Returns `None` for network errors, timeouts, and other non-API failures.
pub fn classify_openai_error(e: &OpenAIError) -> Option<(u16, String)> {
    match e {
        OpenAIError::ApiError(api_err) => {
            let code = api_err.code.as_deref().unwrap_or("");
            let status = openai_error_code_to_status(code).unwrap_or(500);
            Some((status, api_err.message.clone()))
        }
        OpenAIError::JSONDeserialize(_serde_err, content) => parse_provider_error_body(content),
        _ => None,
    }
}

/// Extract status code and message from a provider error JSON body.
///
/// Parses `{"error":{"message":"...","code":...}}` with `code` as either
/// integer (OpenRouter) or numeric string (some providers).
fn parse_provider_error_body(json_str: &str) -> Option<(u16, String)> {
    let parsed: serde_json::Value = serde_json::from_str(json_str).ok()?;
    let error_obj = parsed.get("error")?;

    let message = error_obj
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown provider error")
        .to_string();

    let code = error_obj
        .get("code")
        .and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
        })
        .unwrap_or(0) as u16;

    Some((code, message))
}

/// Generate a user-friendly error message from an HTTP status code.
///
/// The returned messages use specific phrasing that the frontend relies on
/// to determine UI behavior (e.g. showing a "Settings" CTA for auth errors).
/// See `ErrorMessage` in `error-message.tsx` for the frontend contract.
///
/// Phrasing contract:
/// - Auth (401/403): contains "API key" → frontend shows Settings deep-link
/// - Billing (402): contains "credits"/"billing" → no Settings CTA
/// - Rate limit (429): contains "wait"
/// - Server (5xx): contains "provider" + "try again"
/// - Other: generic guidance
pub fn friendly_provider_error(code: u16) -> String {
    match code {
        401 | 403 => {
            "Please make sure you've entered a valid API key in Settings.".to_string()
        }
        402 => {
            "Your API account may be out of credits or has hit its billing limit. Please check your provider's billing page.".to_string()
        }
        429 => "Too many requests. Please wait a moment and try again.".to_string(),
        500..=599 => {
            "The AI provider is experiencing issues. Please try again in a moment.".to_string()
        }
        _ => "Something went wrong with the AI request. Please try again.".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_openrouter_error_with_integer_code() {
        let body = r#"{"error":{"message":"Insufficient credits","code":402}}"#;
        let (code, message) = parse_provider_error_body(body).unwrap();
        assert_eq!(code, 402);
        assert!(message.contains("Insufficient credits"));
    }

    #[test]
    fn parses_openai_error_with_string_code() {
        let body = r#"{"error":{"message":"Invalid API key","code":"invalid_api_key"}}"#;
        let (code, _message) = parse_provider_error_body(body).unwrap();
        // Symbolic string codes are not numeric, so they parse as 0.
        // classify_openai_error handles these via openai_error_code_to_status instead.
        assert_eq!(code, 0);
    }

    #[test]
    fn returns_none_for_non_error_json() {
        assert!(parse_provider_error_body("not-json").is_none());
        assert!(parse_provider_error_body(r#"{"data": "ok"}"#).is_none());
    }

    #[test]
    fn friendly_auth_message_mentions_api_key_and_settings() {
        let msg = friendly_provider_error(401);
        assert!(msg.contains("API key") && msg.contains("Settings"));
    }

    #[test]
    fn friendly_billing_message_does_not_mention_api_key() {
        let msg = friendly_provider_error(402);
        assert!(msg.contains("billing") || msg.contains("credits"));
        assert!(!msg.contains("API key"));
    }

    #[test]
    fn friendly_rate_limit_message_suggests_waiting() {
        assert!(friendly_provider_error(429).contains("wait"));
    }

    #[test]
    fn friendly_server_message_blames_provider() {
        let msg = friendly_provider_error(500);
        assert!(msg.contains("provider") && msg.contains("try again"));
        assert!(!msg.contains("API key"));
    }
}
