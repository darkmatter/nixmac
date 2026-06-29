//! Shared HTTP client factory with global request logging.
//!
//! All outbound HTTP traffic from the Rust side should go through [`logged()`]
//! (async) or [`logged_blocking()`] (sync). Both attach middleware that emits
//! `tracing` events for every request: method, URL (credentials stripped),
//! status, and elapsed milliseconds. The events flow into the same
//! `tracing_subscriber` sink initialized in `main.rs` (stderr and, when
//! `NIXMAC_LOGFILE` is set, the rotating file).
//!
//! `reqwest-tracing`'s [`TracingMiddleware`] is also attached so each request
//! opens an OpenTelemetry span — when telemetry is enabled in
//! `telemetry/init.rs`, those spans export to Sentry alongside the rest of the
//! app's traces.
//!
//! Sites that need a customized `reqwest::Client` (cookie jar, custom timeouts)
//! should call [`logged_with_builder()`] and pass their configured builder.
//!
//! `async-openai` clients cannot accept a `ClientWithMiddleware` directly, so
//! the two OpenAI provider paths keep their existing `log::info!` /
//! `completion_log` JSONL logging. Everything else is covered here.

use async_trait::async_trait;
use http::Extensions;
use reqwest::{Request, Response};
use reqwest_middleware::{ClientBuilder, Middleware, Next, Result};
use reqwest_tracing::TracingMiddleware;
use tracing::{info, warn};

/// Returns the standard async HTTP client with logging + tracing middleware.
///
/// Use this in place of `reqwest::Client::new()`.
pub fn logged() -> reqwest_middleware::ClientWithMiddleware {
    ClientBuilder::new(reqwest::Client::new())
        .with(TracingMiddleware::default())
        .with(LoggingMiddleware)
        .build()
}

/// Returns an async HTTP client backed by a customized `reqwest::Client`.
///
/// Pass a fully-configured `reqwest::ClientBuilder` (e.g. with `.cookie_store(true)`).
/// The builder is consumed and the resulting `reqwest::Client` is wrapped with
/// the same middleware stack as [`logged()`].
pub fn logged_with_builder(
    builder: reqwest::ClientBuilder,
) -> reqwest_middleware::ClientWithMiddleware {
    let client = builder.build().expect("failed to build logged HTTP client");
    ClientBuilder::new(client)
        .with(TracingMiddleware::default())
        .with(LoggingMiddleware)
        .build()
}

/// Returns a blocking HTTP client with request logging.
///
/// `reqwest-middleware` is async-only, so the blocking path wraps each call
/// manually. Use this in place of `reqwest::blocking::Client::new()`.
pub fn logged_blocking() -> LoggingBlockingClient {
    LoggingBlockingClient {
        inner: reqwest::blocking::Client::new(),
    }
}

/// Thin wrapper around `reqwest::blocking::Client` that logs each request.
///
/// Only the methods actually used by call sites are exposed; extend as needed.
pub struct LoggingBlockingClient {
    inner: reqwest::blocking::Client,
}

impl LoggingBlockingClient {
    /// Blocking GET with logging.
    pub fn get(&self, url: &str) -> reqwest::Result<reqwest::blocking::Response> {
        let start = std::time::Instant::now();
        info!("→ GET {url}");
        match self.inner.get(url).send() {
            Ok(resp) => {
                info!("← {} ({})", resp.status(), format_elapsed(start));
                Ok(resp)
            }
            Err(e) => {
                warn!("✗ GET {url} failed: {e}");
                Err(e)
            }
        }
    }
}

/// Middleware that logs every async HTTP request and its outcome.
///
/// Emits two `tracing::info!` events per request:
/// - `→ METHOD url` before the request is sent
/// - `← status (Xms)` on success, or `✗ error` on failure
///
/// URLs have credentials stripped before logging so API keys passed in the
/// URL never reach logs.
struct LoggingMiddleware;

#[async_trait]
impl Middleware for LoggingMiddleware {
    async fn handle(
        &self,
        req: Request,
        extensions: &mut Extensions,
        next: Next<'_>,
    ) -> Result<Response> {
        let method = req.method().clone();
        let url = remove_credentials(req.url());
        let start = std::time::Instant::now();

        info!("→ {method} {url}");

        match next.run(req, extensions).await {
            Ok(resp) => {
                info!("← {} ({})", resp.status(), format_elapsed(start));
                Ok(resp)
            }
            Err(e) => {
                warn!("✗ {method} {url} failed: {e}");
                Err(e)
            }
        }
    }
}

/// Strip `user:pass@` from a URL for safe logging.
fn remove_credentials(url: &reqwest::Url) -> String {
    let mut u = url.clone();
    u.set_password(None).ok();
    u.set_username("").ok();
    u.to_string()
}

fn format_elapsed(start: std::time::Instant) -> String {
    let ms = start.elapsed().as_millis();
    if ms < 1000 {
        format!("{ms}ms")
    } else {
        format!("{:.2}s", start.elapsed().as_secs_f64())
    }
}

#[cfg(test)]
mod tests {
    use super::remove_credentials;

    #[test]
    fn strips_password_from_url() {
        let url = reqwest::Url::parse("https://key:secret@example.com/path").unwrap();
        assert_eq!(remove_credentials(&url), "https://example.com/path");
    }

    #[test]
    fn leaves_url_without_credentials_unchanged() {
        let url = reqwest::Url::parse("https://example.com/path?q=1").unwrap();
        assert_eq!(remove_credentials(&url), "https://example.com/path?q=1");
    }
}
