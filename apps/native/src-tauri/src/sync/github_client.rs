//! HTTP client for the server-brokered GitHub App endpoints.
//!
//! Unlike [`super::client::SyncClient`] (HMAC against the sync server), these
//! endpoints live on the nixmac **web origin** and authenticate with a
//! per-device Better Auth API key (`nixmac_…`) sent as `x-api-key`. The desktop
//! never holds the GitHub App key or a long-lived token; the server brokers the
//! install and mints short-lived, repo-scoped clone tokens.

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};

use crate::shared_types::{GithubConnectStart, GithubRepo, GithubStatus};

/// Thin async client for `/github/*`, bound to one web origin + device key.
pub struct GithubClient {
    base_url: String,
    api_key: String,
    http: reqwest::Client,
}

impl GithubClient {
    /// Builds a client for `base_url` (trailing slashes trimmed) that sends the
    /// per-device API key on every request.
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.into(),
            http: reqwest::Client::new(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    fn authed(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        builder.header("x-api-key", &self.api_key)
    }

    /// `POST /github/connect/start` — returns the GitHub App install URL.
    pub async fn connect_start(&self) -> Result<GithubConnectStart> {
        let resp = self
            .authed(self.http.post(self.url("/github/connect/start")))
            .send()
            .await
            .context("github connect/start request failed")?;
        let resp = error_for_status(resp).await?;
        resp.json()
            .await
            .context("invalid github connect/start response")
    }

    /// `GET /github/status` — whether the account has a linked installation.
    pub async fn status(&self) -> Result<GithubStatus> {
        let resp = self
            .authed(self.http.get(self.url("/github/status")))
            .send()
            .await
            .context("github status request failed")?;
        let resp = error_for_status(resp).await?;
        resp.json().await.context("invalid github status response")
    }

    /// `GET /github/repos` — installation-accessible repositories.
    pub async fn list_repos(&self) -> Result<Vec<GithubRepo>> {
        let resp = self
            .authed(self.http.get(self.url("/github/repos")))
            .send()
            .await
            .context("github repos request failed")?;
        let resp = error_for_status(resp).await?;
        let body: GithubReposResponse =
            resp.json().await.context("invalid github repos response")?;
        Ok(body.repos)
    }

    /// `POST /github/clone-token` — short-lived, repo-scoped clone token.
    pub async fn clone_token(&self, owner: &str, repo: &str) -> Result<GithubCloneToken> {
        let resp = self
            .authed(
                self.http
                    .post(self.url("/github/clone-token"))
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

    /// `POST /github/disconnect` — drops the account↔installation link.
    pub async fn disconnect(&self) -> Result<()> {
        let resp = self
            .authed(self.http.post(self.url("/github/disconnect")))
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
