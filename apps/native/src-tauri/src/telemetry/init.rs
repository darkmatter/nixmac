//! OpenTelemetry pipeline initialization.
//!
//! Rust owns the OTEL providers. When diagnostics are enabled and a Sentry DSN
//! is present, spans and logs are exported over OTLP/HTTP to Sentry's OTLP
//! ingestion endpoint (derived from the DSN). When disabled, no providers are
//! installed and [`init_telemetry`] returns an inert guard.

use std::collections::HashMap;

use opentelemetry::KeyValue;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::{LogExporter, Protocol, SpanExporter, WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::logs::SdkLoggerProvider;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::SdkTracerProvider;

const SERVICE_NAME: &str = "nixmac";

/// OTLP export configuration derived from a Sentry DSN.
struct SentryOtlpConfig {
    traces_url: String,
    logs_url: String,
    headers: Vec<(String, String)>,
}

/// Parses a Sentry DSN and derives the OTLP traces/logs URLs plus the
/// `X-Sentry-Auth` header.
///
/// Supports both SaaS (`https://key@o{id}.ingest.sentry.io/{pid}`) and
/// self-hosted (`https://key@sentry.example.com/{pid}`) DSNs.
///
/// The OTLP endpoint path follows the Sentry convention used by all official
/// SDKs (Python, JS, Go, Collector): `/api/{pid}/integration/otlp/v1/{signal}/`.
fn parse_sentry_dsn(dsn: &str) -> Option<SentryOtlpConfig> {
    let parsed = url::Url::parse(dsn).ok()?;
    let public_key = parsed.username().to_string();
    if public_key.is_empty() {
        return None;
    }
    let host = parsed.host_str()?.to_string();
    // For self-hosted Sentry behind a path-prefixed reverse proxy (e.g.
    // https://sentry.example.com/sentry/), preserve the base path.
    let project_id = parsed.path().trim_start_matches('/').to_string();
    if project_id.is_empty() {
        return None;
    }
    // Use the DSN's own scheme instead of hardcoding https, so http works
    // for local dev / self-hosted instances without TLS.
    let scheme = parsed.scheme();

    Some(SentryOtlpConfig {
        traces_url: format!("{scheme}://{host}/api/{project_id}/integration/otlp/v1/traces/"),
        logs_url: format!("{scheme}://{host}/api/{project_id}/integration/otlp/v1/logs/"),
        headers: vec![(
            "x-sentry-auth".to_string(),
            format!("sentry sentry_key={public_key}"),
        )],
    })
}

/// Holds the OTEL provider handles so they stay alive for the app's lifetime
/// and are flushed/shut down on drop. An inert guard (all `None`) is returned
/// when telemetry is disabled.
#[derive(Default)]
pub struct TelemetryGuard {
    tracer_provider: Option<SdkTracerProvider>,
    logger_provider: Option<SdkLoggerProvider>,
}

impl Drop for TelemetryGuard {
    fn drop(&mut self) {
        if let Some(provider) = self.tracer_provider.take() {
            if let Err(e) = provider.force_flush() {
                log::warn!("Failed to flush OTEL tracer provider: {e}");
            }
            if let Err(e) = provider.shutdown() {
                log::warn!("Failed to shut down OTEL tracer provider: {e}");
            }
        }
        if let Some(provider) = self.logger_provider.take() {
            if let Err(e) = provider.force_flush() {
                log::warn!("Failed to flush OTEL logger provider: {e}");
            }
            if let Err(e) = provider.shutdown() {
                log::warn!("Failed to shut down OTEL logger provider: {e}");
            }
        }
    }
}

fn build_resource(nixmac_env: &str, nixmac_version: &str) -> Resource {
    Resource::builder()
        .with_attributes([
            KeyValue::new("service.name", SERVICE_NAME),
            KeyValue::new("service.version", nixmac_version.to_string()),
            KeyValue::new("deployment.environment", nixmac_env.to_string()),
        ])
        .build()
}

/// Builds the OTLP-backed tracer + logger providers exporting to Sentry.
fn build_providers(
    config: &SentryOtlpConfig,
    nixmac_env: &str,
    nixmac_version: &str,
) -> Result<(SdkTracerProvider, SdkLoggerProvider), Box<dyn std::error::Error>> {
    let resource = build_resource(nixmac_env, nixmac_version);
    let headers: HashMap<String, String> = config.headers.iter().cloned().collect();

    // --- traces ---
    let span_exporter = SpanExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(config.traces_url.clone())
        .with_headers(headers.clone())
        .build()?;
    let tracer_provider = SdkTracerProvider::builder()
        .with_batch_exporter(span_exporter)
        .with_resource(resource.clone())
        .build();

    // --- logs ---
    let log_exporter = LogExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(config.logs_url.clone())
        .with_headers(headers)
        .build()?;
    let logger_provider = SdkLoggerProvider::builder()
        .with_batch_exporter(log_exporter)
        .with_resource(resource)
        .build();

    Ok((tracer_provider, logger_provider))
}

/// Initializes the OTEL pipeline.
///
/// Reads `SENTRY_DSN`, `NIXMAC_ENV`, and `NIXMAC_VERSION` via [`crate::env`].
/// When `send_diagnostics` is true and a DSN is present, installs OTLP providers exporting to Sentry and registers the
/// tracer provider globally. Otherwise returns an inert guard.
#[must_use]
pub fn init_telemetry(send_diagnostics: bool) -> TelemetryGuard {
    let sentry_dsn = crate::env::sentry_dsn();
    let nixmac_env = crate::env::nixmac_env();
    let nixmac_version = crate::env::nixmac_version();

    if !send_diagnostics {
        log::info!("OTEL telemetry disabled by user preference; using inert providers");
        return TelemetryGuard::default();
    }

    let Some(dsn) = sentry_dsn.filter(|s| !s.trim().is_empty()) else {
        log::info!("OTEL telemetry: no SENTRY_DSN configured; using inert providers");
        return TelemetryGuard::default();
    };

    let Some(config) = parse_sentry_dsn(&dsn) else {
        log::warn!("OTEL telemetry: failed to parse SENTRY_DSN; using inert providers");
        return TelemetryGuard::default();
    };

    let (tracer_provider, logger_provider) =
        match build_providers(&config, &nixmac_env, &nixmac_version) {
            Ok(providers) => providers,
            Err(e) => {
                log::warn!("OTEL telemetry: failed to build providers: {e}; using inert providers");
                return TelemetryGuard::default();
            }
        };

    // Register the tracer provider globally so `opentelemetry::global::tracer`
    // (and spans reconstructed from forwarded WebView spans) export through it.
    opentelemetry::global::set_tracer_provider(tracer_provider.clone());
    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());

    // Bridge `tracing::` log events into the OTEL logger provider. The global
    // tracing subscriber is initialized earlier in `main()`, so this attachment
    // is best-effort: `try_init` returns `Err` when a subscriber is already
    // installed, in which case the bridge stays dormant but both providers
    // still export (traces via the global tracer, logs once the subscriber is
    // refactored to host this layer). The providers are flushed via the guard.
    {
        use tracing_subscriber::prelude::*;
        let log_bridge = OpenTelemetryTracingBridge::new(&logger_provider);
        if tracing_subscriber::registry()
            .with(log_bridge)
            .try_init()
            .is_err()
        {
            log::debug!("OTEL log bridge not attached: a tracing subscriber is already installed");
        }
    }

    log::info!(
        "OTEL telemetry initialized (env: {nixmac_env}, version: {nixmac_version}, traces: {})",
        config.traces_url
    );

    TelemetryGuard {
        tracer_provider: Some(tracer_provider),
        logger_provider: Some(logger_provider),
    }
}
