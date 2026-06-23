//! HTTP client for the nixmac sync service.
//!
//! This is the typed transport layer: it knows the endpoints, the wire
//! shapes, and how to attach an HMAC `Authorization` header to authenticated
//! requests. It deliberately holds no app state — credentials are passed in by
//! the caller (`crate::sync`), which reads them from the keychain/store.
//!
//! The server itself is not part of this repository yet; these calls target a
//! configurable base URL and will function against any backend that implements
//! the documented endpoints.

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};

use super::signing::{SigningRequest, authorization_header};
use crate::shared_types::{
    AuthAccount, GithubConnectStart, GithubRepo, GithubStatus, SyncRemoteStatus,
};

/// Secret material needed to sign authenticated sync requests.
#[derive(Debug, Clone)]
pub struct SyncCredentials {
    pub account_id: String,
    pub key_id: String,
    pub secret: String,
}

/// Successful sign-in outcome: the account plus freshly issued credentials.
pub struct LoginOutcome {
    pub account: AuthAccount,
    pub credentials: SyncCredentials,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginRequest<'a> {
    email: &'a str,
    password: &'a str,
    device_name: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginResponse {
    account_id: String,
    email: String,
    key_id: String,
    secret: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PushRequest<'a> {
    head_commit_hash: &'a str,
    branch: Option<&'a str>,
    device_name: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeadResponse {
    head_commit_hash: Option<String>,
}

/// Thin async client bound to one sync server base URL.
pub struct SyncClient {
    base_url: String,
    http: reqwest::Client,
}

impl SyncClient {
    /// Builds a client for `base_url` (trailing slashes are trimmed).
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            http: reqwest::Client::new(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// Builds a request with a valid HMAC `Authorization` header over `body`.
    ///
    /// The exact `body` bytes are both signed and sent, so the server can
    /// recompute the signature over what it received.
    fn signed(
        &self,
        method: reqwest::Method,
        path: &str,
        creds: &SyncCredentials,
        body: Vec<u8>,
    ) -> reqwest::RequestBuilder {
        let timestamp = unix_now_secs();
        let header = authorization_header(
            &creds.key_id,
            &creds.secret,
            &SigningRequest {
                method: method.as_str(),
                path,
                timestamp,
                body: &body,
            },
        );
        let mut builder = self
            .http
            .request(method, self.url(path))
            .header(reqwest::header::AUTHORIZATION, header)
            .header("X-Nixmac-Account", &creds.account_id);
        if !body.is_empty() {
            builder = builder
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(body);
        }
        builder
    }

    /// Exchanges account credentials for a per-device HMAC secret.
    ///
    /// `POST /v1/auth/sessions` (unauthenticated).
    pub async fn login(
        &self,
        email: &str,
        password: &str,
        device_name: &str,
    ) -> Result<LoginOutcome> {
        let resp = self
            .http
            .post(self.url("/v1/auth/sessions"))
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&LoginRequest {
                email,
                password,
                device_name,
            })
            .send()
            .await
            .context("sign-in request failed")?;

        let resp = error_for_status(resp).await?;
        let body: LoginResponse = resp.json().await.context("invalid sign-in response")?;
        Ok(LoginOutcome {
            account: AuthAccount {
                id: body.account_id.clone(),
                email: body.email,
            },
            credentials: SyncCredentials {
                account_id: body.account_id,
                key_id: body.key_id,
                secret: body.secret,
            },
        })
    }

    /// Fetches the server's view of the account's stored configuration.
    ///
    /// `GET /v1/sync/status` (signed).
    pub async fn remote_status(&self, creds: &SyncCredentials) -> Result<SyncRemoteStatus> {
        let resp = self
            .signed(reqwest::Method::GET, "/v1/sync/status", creds, Vec::new())
            .send()
            .await
            .context("sync status request failed")?;
        let resp = error_for_status(resp).await?;
        resp.json().await.context("invalid sync status response")
    }

    /// Uploads a pointer to the latest local config snapshot.
    ///
    /// `POST /v1/sync/push` (signed). Returns the head commit hash the server
    /// now considers current. Streaming the full git bundle is a follow-up;
    /// this records the snapshot pointer and device metadata.
    pub async fn push(
        &self,
        creds: &SyncCredentials,
        head_commit_hash: &str,
        branch: Option<&str>,
        device_name: &str,
    ) -> Result<Option<String>> {
        let body = serde_json::to_vec(&PushRequest {
            head_commit_hash,
            branch,
            device_name,
        })
        .context("failed to encode push request")?;
        let resp = self
            .signed(reqwest::Method::POST, "/v1/sync/push", creds, body)
            .send()
            .await
            .context("sync push request failed")?;
        let resp = error_for_status(resp).await?;
        let body: HeadResponse = resp.json().await.context("invalid sync push response")?;
        Ok(body.head_commit_hash)
    }

    /// Fetches the head commit hash of the server's latest snapshot.
    ///
    /// `GET /v1/sync/pull` (signed). Downloading and applying the bundle is a
    /// follow-up; this returns the pointer so the UI can report drift.
    pub async fn pull(&self, creds: &SyncCredentials) -> Result<Option<String>> {
        let resp = self
            .signed(reqwest::Method::GET, "/v1/sync/pull", creds, Vec::new())
            .send()
            .await
            .context("sync pull request failed")?;
        let resp = error_for_status(resp).await?;
        let body: HeadResponse = resp.json().await.context("invalid sync pull response")?;
        Ok(body.head_commit_hash)
    }

    /// Starts the GitHub App connect flow. `POST /v1/github/connect/start` (signed).
    pub async fn github_connect_start(
        &self,
        creds: &SyncCredentials,
    ) -> Result<GithubConnectStart> {
        let resp = self
            .signed(
                reqwest::Method::POST,
                "/v1/github/connect/start",
                creds,
                Vec::new(),
            )
            .send()
            .await
            .context("github connect/start request failed")?;
        let resp = error_for_status(resp).await?;
        resp.json()
            .await
            .context("invalid github connect/start response")
    }

    /// Returns whether the account has a linked installation. `GET /v1/github/status` (signed).
    pub async fn github_status(&self, creds: &SyncCredentials) -> Result<GithubStatus> {
        let resp = self
            .signed(reqwest::Method::GET, "/v1/github/status", creds, Vec::new())
            .send()
            .await
            .context("github status request failed")?;
        let resp = error_for_status(resp).await?;
        resp.json().await.context("invalid github status response")
    }

    /// Lists installation-accessible repos. `GET /v1/github/repos` (signed).
    pub async fn github_list_repos(&self, creds: &SyncCredentials) -> Result<Vec<GithubRepo>> {
        let resp = self
            .signed(reqwest::Method::GET, "/v1/github/repos", creds, Vec::new())
            .send()
            .await
            .context("github repos request failed")?;
        let resp = error_for_status(resp).await?;
        let body: GithubReposResponse =
            resp.json().await.context("invalid github repos response")?;
        Ok(body.repos)
    }

    /// Mints a short-lived, repo-scoped clone token. `POST /v1/github/clone-token` (signed).
    pub async fn github_clone_token(
        &self,
        creds: &SyncCredentials,
        owner: &str,
        repo: &str,
    ) -> Result<GithubCloneToken> {
        let body = serde_json::to_vec(&GithubCloneTokenRequest { owner, repo })
            .context("failed to encode clone-token request")?;
        let resp = self
            .signed(reqwest::Method::POST, "/v1/github/clone-token", creds, body)
            .send()
            .await
            .context("github clone-token request failed")?;
        let resp = error_for_status(resp).await?;
        resp.json()
            .await
            .context("invalid github clone-token response")
    }

    /// Drops the account↔installation link. `POST /v1/github/disconnect` (signed).
    pub async fn github_disconnect(&self, creds: &SyncCredentials) -> Result<()> {
        let resp = self
            .signed(
                reqwest::Method::POST,
                "/v1/github/disconnect",
                creds,
                Vec::new(),
            )
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

fn unix_now_secs() -> u64 {
    crate::utils::unix_now().max(0) as u64
}

/// Converts a non-2xx response into a readable error, including the body when present.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_trims_trailing_slashes_from_base_url() {
        let client = SyncClient::new("https://sync.example.com/");
        assert_eq!(
            client.url("/v1/sync/status"),
            "https://sync.example.com/v1/sync/status"
        );
    }

    #[test]
    fn url_joins_base_and_path_without_double_slash() {
        let client = SyncClient::new("https://sync.example.com");
        assert_eq!(
            client.url("/v1/auth/sessions"),
            "https://sync.example.com/v1/auth/sessions"
        );
    }
}
