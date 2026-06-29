//! PII / secret scrubbing for OTEL attributes.
//!
//! Ported from the former WebView telemetry sanitizer so the Rust-owned OTEL
//! pipeline applies the same redaction rules the WebView path used.

use std::collections::HashMap;

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

const REDACTED: &str = "[REDACTED]";
const REDACTED_APP_CONTENT: &str = "[REDACTED_APP_CONTENT]";

/// Key names whose values are redacted wholesale (credentials, identity, etc).
/// These are more common to web apps, but we include them just in case.
static SENSITIVE_KEY_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)password|passwd|pwd|secret|token|api[-_]?key|authorization|cookie|session|bearer|email|phone|ssn|credit|card|cvv|cvc|iban|account|address|ip|private[-_]?key|ssh|gpg",
    )
    .expect("SENSITIVE_KEY_PATTERN is a valid regex")
});

/// Key names that signal the value contains nixmac app content (prompts, diffs,
/// config text, command output). Such values are redacted wholesale rather than
/// trying to extract specific secrets embedded within them.
static APP_CONTENT_KEY_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)prompt|messages|conversation|completion|response|input|output|diff|patch|nix(?:[-_]?darwin)?(?:[-_]?config)?|configuration|config[-_]?text|file[-_]?content|command|args|stderr|stdout|path|cwd|home",
    )
    .expect("APP_CONTENT_KEY_PATTERN is a valid regex")
});

static EMAIL_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}").expect("valid regex"));
static BEARER_TOKEN_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9\-._~+/]+=*").expect("valid regex"));
static GITHUB_TOKEN_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bgh[pousr]_[A-Za-z0-9]{20,}\b").expect("valid regex"));
static OPENAI_TOKEN_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\bsk-[A-Za-z0-9]{20,}\b").expect("valid regex"));
static ANTHROPIC_TOKEN_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bsk-ant-[A-Za-z0-9_-]{20,}\b").expect("valid regex"));
static PRIVATE_KEY_BLOCK_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----")
        .expect("valid regex")
});
static HOME_DIR_PATH_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"/Users/[^/\s'"`]+"#).expect("valid regex"));
static NIX_SECRET_ASSIGNMENT_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?i)\b(password|passwd|token|secret|api[-_]?key|private[-_]?key)\s*=\s*(".*?"|'.*?'|[^\s;]+)"#,
    )
    .expect("valid regex")
});

/// Strips the query string from http(s) URLs; leaves non-URL strings untouched.
fn sanitize_url(value: &str) -> String {
    if !(value.starts_with("http://") || value.starts_with("https://")) {
        return value.to_string();
    }

    match url::Url::parse(value) {
        Ok(mut parsed) => {
            if parsed.query().is_some() {
                parsed.set_query(None);
            }
            parsed.to_string()
        }
        Err(_) => value.to_string(),
    }
}

/// Applies the full regex redaction pipeline to a string value. Mirrors the
/// `sanitizeString` ordering in `sanitize.ts`.
pub fn sanitize_string(value: &str) -> String {
    let mut sanitized = EMAIL_PATTERN.replace_all(value, REDACTED).into_owned();
    sanitized = BEARER_TOKEN_PATTERN
        .replace_all(&sanitized, REDACTED)
        .into_owned();
    sanitized = GITHUB_TOKEN_PATTERN
        .replace_all(&sanitized, REDACTED)
        .into_owned();
    sanitized = OPENAI_TOKEN_PATTERN
        .replace_all(&sanitized, REDACTED)
        .into_owned();
    sanitized = ANTHROPIC_TOKEN_PATTERN
        .replace_all(&sanitized, REDACTED)
        .into_owned();
    sanitized = PRIVATE_KEY_BLOCK_PATTERN
        .replace_all(&sanitized, REDACTED)
        .into_owned();
    sanitized = HOME_DIR_PATH_PATTERN
        .replace_all(&sanitized, "/Users/[REDACTED_USER]")
        .into_owned();
    sanitized = NIX_SECRET_ASSIGNMENT_PATTERN
        .replace_all(&sanitized, |caps: &regex::Captures| {
            format!("{} = {}", &caps[1], REDACTED)
        })
        .into_owned();

    sanitize_url(&sanitized)
}

/// Recursively redacts a single JSON value, taking the owning key name into
/// account. Mirrors `sanitizeSentryValue` in `sanitize.ts`.
fn sanitize_value(value: &Value, key_name: &str) -> Value {
    if SENSITIVE_KEY_PATTERN.is_match(key_name) {
        return Value::String(REDACTED.to_string());
    }

    if APP_CONTENT_KEY_PATTERN.is_match(key_name) {
        match value {
            Value::String(s) if !s.is_empty() => {
                return Value::String(REDACTED_APP_CONTENT.to_string());
            }
            Value::Array(_) | Value::Object(_) => {
                return Value::String(REDACTED_APP_CONTENT.to_string());
            }
            _ => {}
        }
    }

    match value {
        Value::String(s) => Value::String(sanitize_string(s)),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|entry| sanitize_value(entry, ""))
                .collect(),
        ),
        Value::Object(map) => {
            let mut sanitized = serde_json::Map::with_capacity(map.len());
            for (child_key, child_value) in map {
                sanitized.insert(child_key.clone(), sanitize_value(child_value, child_key));
            }
            Value::Object(sanitized)
        }
        other => other.clone(),
    }
}

/// Scrubs OTEL span attributes in place.
///
/// 1. Keys matching [`SENSITIVE_KEY_PATTERN`] are redacted to `"[REDACTED]"`.
/// 2. Keys matching [`APP_CONTENT_KEY_PATTERN`] are redacted to
///    `"[REDACTED_APP_CONTENT]"`.
/// 3. Remaining string (and nested) values have the regex pipeline applied to
///    redact tokens, emails, home-dir paths, and inline secret assignments.
pub fn scrub_attributes(attrs: &mut HashMap<String, Value>) {
    for (key, value) in attrs.iter_mut() {
        let sanitized = sanitize_value(value, key);
        *value = sanitized;
    }
}
