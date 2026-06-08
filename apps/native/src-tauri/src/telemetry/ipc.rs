//! Tauri IPC bridge that receives OTEL spans forwarded from the WebView.
//!
//! The WebView runs its own OTEL SDK with a `ForwardingSpanProcessor` that
//! serializes finished spans and ships them across IPC to the Rust side, which
//! owns the export pipeline.

use serde::Deserialize;
use tauri::command;

/// Serialized span data received from the WebView's ForwardingSpanProcessor.
#[derive(Deserialize)]
pub struct ForwardedSpan {
    pub name: String,
    pub trace_id: String,
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub start_time_unix_nano: u64,
    pub end_time_unix_nano: u64,
    pub attributes: std::collections::HashMap<String, serde_json::Value>,
    pub status_code: Option<i32>,
    pub status_message: Option<String>,
}

#[command]
pub async fn otel_forward_span(mut span: ForwardedSpan) -> Result<(), String> {
    // Scrub PII / secrets from the forwarded attributes before the span is
    // logged or (in a follow-up) reconstructed into the Rust TracerProvider.
    crate::telemetry::scrub::scrub_attributes(&mut span.attributes);

    // For now: log the forwarded span at debug level.
    // Full span reconstruction into the Rust TracerProvider is a follow-up
    // because opentelemetry-rust doesn't expose a simple "inject external span" API.
    // The immediate value is that the IPC bridge is established and can be iterated on.
    log::debug!(
        "Received forwarded span from WebView: name={} trace_id={} span_id={} parent={:?} \
         start_ns={} end_ns={} attrs={} status_code={:?} status_message={:?}",
        span.name,
        span.trace_id,
        span.span_id,
        span.parent_span_id,
        span.start_time_unix_nano,
        span.end_time_unix_nano,
        span.attributes.len(),
        span.status_code,
        span.status_message
    );
    Ok(())
}
