//! HTTP client for the server-brokered GitHub App endpoints.
//!
//! Unlike [`super::client::SyncClient`] (HMAC against the sync server), these
//! endpoints live on the nixmac **web origin** and authenticate with a
//! per-device Better Auth API key (`nixmac_…`) sent as `x-api-key`. The desktop
//! never holds the GitHub App key or a long-lived token; the server brokers the
//! install and mints short-lived, repo-scoped clone tokens.

use anyhow::{Context, Result, anyhow};
use reqwest::header::ORIGIN;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::shared_types::{
    AuthAccount, GithubBootstrapState, GithubBootstrapStatus, GithubConnectStart, GithubRepo,
    GithubStatus,
};

/// Public client for the GitHub-first bootstrap endpoints. These calls run
/// before the desktop has a per-device Better Auth API key.
pub struct GithubBootstrapClient {
    base_url: String,
    origin: String,
    http: reqwest_middleware::ClientWithMiddleware,
}

impl GithubBootstrapClient {
    pub fn new(base_url: impl Into<String>) -> Result<Self> {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        let origin = web_origin(&base_url)?;
        Ok(Self {
            base_url,
            origin,
            http: crate::http_client::logged(),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    fn with_origin(
        &self,
        builder: reqwest_middleware::RequestBuilder,
    ) -> reqwest_middleware::RequestBuilder {
        builder.header(ORIGIN, &self.origin)
    }

    /// `POST /api/auth/github/bootstrap/start` — starts GitHub OAuth/install
    /// before a Better Auth account exists on this device.
    pub async fn start(&self) -> Result<GithubConnectStart> {
        let resp = self
            .with_origin(self.http.post(self.url("/api/auth/github/bootstrap/start")))
            .send()
            .await
            .context("github bootstrap/start request failed")?;
        let resp = error_for_status(resp).await?;
        resp.json()
            .await
            .context("invalid github bootstrap/start response")
    }

    /// `GET /api/auth/github/bootstrap/status?state=…` — polls for account
    /// creation and returns a one-time device API key only to native code.
    pub async fn status(&self, state: &str) -> Result<GithubBootstrapPoll> {
        let resp = self
            .with_origin(
                self.http
                    .get(self.url("/api/auth/github/bootstrap/status"))
                    .query(&[("state", state)]),
            )
            .send()
            .await
            .context("github bootstrap/status request failed")?;
        let resp = error_for_status(resp).await?;
        let text = resp
            .text()
            .await
            .context("failed to read github bootstrap/status response")?;
        parse_bootstrap_status_body(&text)
    }
}

/// Native-only poll result. `api_key` must be persisted and never forwarded to
/// the frontend.
pub struct GithubBootstrapPoll {
    pub status: GithubBootstrapStatus,
    pub api_key: Option<String>,
}

/// Thin async client for `/api/auth/github/*`, bound to one web origin + device key.
pub struct GithubClient {
    base_url: String,
    origin: String,
    api_key: String,
    http: reqwest_middleware::ClientWithMiddleware,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthAccountWire {
    id: String,
    email: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubBootstrapStatusResponse {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    connected: bool,
    #[serde(default)]
    login: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_i64")]
    installation_id: Option<i64>,
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    account_id: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    account: Option<AuthAccountWire>,
    #[serde(default)]
    fallback_required: bool,
    #[serde(default)]
    fallback_reason: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    poll_interval_seconds: Option<u32>,
}

impl GithubBootstrapStatusResponse {
    fn into_poll(self) -> Result<GithubBootstrapPoll> {
        if let Some(error) = self.error.as_deref() {
            return Err(anyhow!("github bootstrap/status error: {error}"));
        }

        let wire_state = self.status.as_deref().or(self.state.as_deref());
        let state = if self.connected || self.api_key.is_some() || wire_state == Some("complete") {
            GithubBootstrapState::Complete
        } else if self.fallback_required {
            GithubBootstrapState::FallbackRequired
        } else {
            bootstrap_state_from_wire(wire_state)?
        };

        let account_id = self
            .account_id
            .or_else(|| self.account.as_ref().map(|account| account.id.clone()));
        let email = self
            .email
            .or_else(|| self.account.as_ref().map(|account| account.email.clone()));

        let account = match (account_id, email) {
            (Some(id), Some(email)) => Some(AuthAccount { id, email }),
            (None, None) => None,
            _ if state == GithubBootstrapState::Complete => {
                return Err(anyhow!(
                    "server completed github bootstrap without account id and email"
                ));
            }
            _ => None,
        };

        if state == GithubBootstrapState::Complete && self.api_key.is_none() && account.is_none() {
            return Err(anyhow!(
                "server completed github bootstrap without account metadata or device api key"
            ));
        }

        Ok(GithubBootstrapPoll {
            status: GithubBootstrapStatus {
                state,
                connected: self.connected || state == GithubBootstrapState::Complete,
                login: self.login,
                installation_id: self.installation_id,
                account,
                fallback_reason: self.fallback_reason,
                poll_interval_seconds: self.poll_interval_seconds,
            },
            api_key: self.api_key,
        })
    }
}

fn bootstrap_state_from_wire(value: Option<&str>) -> Result<GithubBootstrapState> {
    match value.unwrap_or("pending") {
        "pending" => Ok(GithubBootstrapState::Pending),
        "complete" => Ok(GithubBootstrapState::Complete),
        "fallbackRequired" => Ok(GithubBootstrapState::FallbackRequired),
        "expired" => Ok(GithubBootstrapState::Expired),
        // GitHub device flow can ask clients to slow down; the server may
        // choose to surface that as a transient status while keeping the flow alive.
        "slowDown" => Ok(GithubBootstrapState::Pending),
        other => Err(anyhow!("unexpected github bootstrap status: {other}")),
    }
}

impl GithubClient {
    /// Builds a client for `base_url` (trailing slashes trimmed) that sends the
    /// per-device API key on every request.
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Result<Self> {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        let origin = web_origin(&base_url)?;
        Ok(Self {
            base_url,
            origin,
            api_key: api_key.into(),
            http: crate::http_client::logged(),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    fn authed(
        &self,
        builder: reqwest_middleware::RequestBuilder,
    ) -> reqwest_middleware::RequestBuilder {
        builder
            .header("x-api-key", &self.api_key)
            .header(ORIGIN, &self.origin)
    }

    /// `POST /api/auth/github/connect/start` — returns the GitHub App install URL.
    pub async fn connect_start(&self) -> Result<GithubConnectStart> {
        let resp = self
            .authed(self.http.post(self.url("/api/auth/github/connect/start")))
            .send()
            .await
            .context("github connect/start request failed")?;
        let resp = error_for_status(resp).await?;
        resp.json()
            .await
            .context("invalid github connect/start response")
    }

    /// `GET /api/auth/github/status` — whether the account has a linked installation.
    pub async fn status(&self) -> Result<GithubStatus> {
        let resp = self
            .authed(self.http.get(self.url("/api/auth/github/status")))
            .send()
            .await
            .context("github status request failed")?;
        let resp = error_for_status(resp).await?;
        resp.json().await.context("invalid github status response")
    }

    /// `GET /api/auth/github/repos` — installation-accessible repositories.
    pub async fn list_repos(&self) -> Result<Vec<GithubRepo>> {
        let resp = self
            .authed(self.http.get(self.url("/api/auth/github/repos")))
            .send()
            .await
            .context("github repos request failed")?;
        let resp = error_for_status(resp).await?;
        let body: GithubReposResponse =
            resp.json().await.context("invalid github repos response")?;
        Ok(body.repos)
    }

    /// `POST /api/auth/github/clone-token` — short-lived, repo-scoped clone token.
    pub async fn clone_token(&self, owner: &str, repo: &str) -> Result<GithubCloneToken> {
        let resp = self
            .authed(
                self.http
                    .post(self.url("/api/auth/github/clone-token"))
                    .json(&GithubCloneTokenRequest { owner, repo }),
            )
            .send()
            .await
            .context("github clone-token request failed")?;
        let resp = error_for_status(resp).await?;
        resp.json()
            .await
            .context("invalid github clone-token response")
    }

    /// `POST /api/auth/github/disconnect` — drops the account↔installation link.
    pub async fn disconnect(&self) -> Result<()> {
        let resp = self
            .authed(self.http.post(self.url("/api/auth/github/disconnect")))
            .send()
            .await
            .context("github disconnect request failed")?;
        error_for_status(resp).await?;
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubCloneTokenRequest<'a> {
    owner: &'a str,
    repo: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubReposResponse {
    repos: Vec<GithubRepo>,
}

/// Short-lived, repo-scoped installation token for a single clone. Internal
/// wire type — the token never reaches the frontend.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubCloneToken {
    pub token: String,
    /// ISO-8601 expiry (informational; the token is used immediately).
    #[allow(dead_code)]
    pub expires_at: String,
    pub clone_url: String,
}

fn web_origin(base_url: &str) -> Result<String> {
    Ok(Url::parse(base_url)
        .with_context(|| format!("invalid web server URL: {base_url}"))?
        .origin()
        .ascii_serialization())
}

fn truncate_body(body: &str) -> String {
    const MAX_LEN: usize = 500;
    let trimmed = body.trim();
    if trimmed.len() <= MAX_LEN {
        trimmed.to_string()
    } else {
        format!("{}…", &trimmed[..MAX_LEN])
    }
}

fn redact_bootstrap_body(body: &str) -> String {
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(body) else {
        return truncate_body(body);
    };
    if let Some(obj) = value.as_object_mut()
        && obj.contains_key("apiKey")
    {
        obj.insert(
            "apiKey".to_string(),
            serde_json::Value::String("[redacted]".to_string()),
        );
    }
    truncate_body(&value.to_string())
}

fn deserialize_optional_i64<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum WireInt {
        Int(i64),
        Str(String),
    }

    match Option::<WireInt>::deserialize(deserializer)? {
        None => Ok(None),
        Some(WireInt::Int(value)) => Ok(Some(value)),
        Some(WireInt::Str(value)) => value
            .parse::<i64>()
            .map(Some)
            .map_err(serde::de::Error::custom),
    }
}

/// Converts a non-2xx response into a readable error, including the body.
async fn error_for_status(resp: reqwest::Response) -> Result<reqwest::Response> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let body = resp.text().await.unwrap_or_default();
    let detail = body.trim();
    if detail.is_empty() {
        Err(anyhow!("server returned {status}"))
    } else {
        Err(anyhow!("server returned {status}: {detail}"))
    }
}

fn parse_bootstrap_status_body(text: &str) -> Result<GithubBootstrapPoll> {
    let body: GithubBootstrapStatusResponse = serde_json::from_str(text).with_context(|| {
        format!(
            "invalid github bootstrap/status response: {}",
            redact_bootstrap_body(text)
        )
    })?;
    body.into_poll()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pending_bootstrap_status() {
        let poll = parse_bootstrap_status_body(
            r#"{"status":"pending","state":"pending","connected":false,"pollIntervalSeconds":5}"#,
        )
        .expect("pending response");
        assert_eq!(poll.status.state, GithubBootstrapState::Pending);
        assert!(!poll.status.connected);
        assert_eq!(poll.status.poll_interval_seconds, Some(5));
    }

    #[test]
    fn parses_complete_bootstrap_status_with_nested_account() {
        let poll = parse_bootstrap_status_body(
            r#"{
                "status":"complete",
                "state":"complete",
                "connected":true,
                "login":"octocat",
                "installationId":12345,
                "account":{"id":"user-1","email":"octocat@users.nixmac.dev"},
                "apiKey":"nixmac_test_key"
            }"#,
        )
        .expect("complete response");
        assert_eq!(poll.status.state, GithubBootstrapState::Complete);
        assert_eq!(poll.api_key.as_deref(), Some("nixmac_test_key"));
        assert_eq!(
            poll.status
                .account
                .as_ref()
                .map(|account| account.id.as_str()),
            Some("user-1")
        );
    }

    #[test]
    fn parses_replayed_complete_status_without_api_key() {
        let poll = parse_bootstrap_status_body(
            r#"{
                "status":"complete",
                "state":"complete",
                "connected":true,
                "login":"octocat",
                "installationId":12345,
                "account":{"id":"user-1","email":"octocat@users.nixmac.dev"}
            }"#,
        )
        .expect("replayed complete response");
        assert_eq!(poll.status.state, GithubBootstrapState::Complete);
        assert!(poll.api_key.is_none());
        assert!(poll.status.connected);
    }

    #[test]
    fn parses_production_complete_status_with_string_installation_id() {
        let poll = parse_bootstrap_status_body(
            r#"{
                "status":"complete",
                "state":"complete",
                "connected":true,
                "login":"czxtm",
                "installationId":"142858330",
                "accountId":"SLcSyLT1H4jSvuGpgCG2J8XrMI8a08KV",
                "email":"cooper@darkmatter.io",
                "account":{"id":"SLcSyLT1H4jSvuGpgCG2J8XrMI8a08KV","email":"cooper@darkmatter.io"},
                "apiKey":"nixmac_test_key"
            }"#,
        )
        .expect("production-shaped complete response");
        assert_eq!(poll.status.state, GithubBootstrapState::Complete);
        assert_eq!(poll.status.installation_id, Some(142_858_330));
    }
}
