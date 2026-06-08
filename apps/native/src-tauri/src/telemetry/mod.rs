//! Unified OpenTelemetry telemetry module.
//!
//! Rust owns all OTEL providers. The WebView forwards spans via Tauri IPC.
//! Sentry and PostHog both consume from the same OTEL pipeline.

pub mod init;
pub mod ipc;
pub mod scrub;
