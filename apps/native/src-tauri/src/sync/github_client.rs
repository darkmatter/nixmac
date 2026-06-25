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
    http: reqwest::Client,
}

impl GithubBootstrapClient {
    pub fn new(base_url: impl Into<String>) -> Result<Self> {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        let origin = web_origin(&base_url)?;
        Ok(Self {
            base_url,
            origin,
            http: reqwest::Client::new(),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    fn with_origin(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
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
        let body: GithubBootstrapStatusResponse = resp
            .json()
            .await
            .context("invalid github bootstrap/status response")?;
        body.into_poll()
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
    http: reqwest::Client,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubBootstrapStatusResponse {
    #[serde(default)]
    status: Option<GithubBootstrapState>,
    #[serde(default)]
    connected: bool,
    #[serde(default)]
    login: Option<String>,
    #[serde(default)]
    installation_id: Option<i64>,
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    account_id: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    fallback_required: bool,
    #[serde(default)]
    fallback_reason: Option<String>,
}

impl GithubBootstrapStatusResponse {
    fn into_poll(self) -> Result<GithubBootstrapPoll> {
        let state = if self.connected || self.api_key.is_some() {
            GithubBootstrapState::Complete
        } else if self.fallback_required {
            GithubBootstrapState::FallbackRequired
        } else {
            self.status.unwrap_or(GithubBootstrapState::Pending)
        };

        let account = match (self.account_id, self.email) {
            (Some(id), Some(email)) => Some(AuthAccount { id, email }),
            (None, None) => None,
            _ if state == GithubBootstrapState::Complete => {
                return Err(anyhow!(
                    "server completed github bootstrap without account id and email"
                ));
            }
            _ => None,
        };

        if state == GithubBootstrapState::Complete && self.api_key.is_none() {
            return Err(anyhow!(
                "server completed github bootstrap without a device api key"
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
            },
            api_key: self.api_key,
        })
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
            http: reqwest::Client::new(),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    fn authed(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
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
