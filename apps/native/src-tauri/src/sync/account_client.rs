//! Better Auth client for minting a per-device API key against the nixmac web
//! origin.
//!
//! The server-brokered GitHub App endpoints (`/api/auth/github/*`) authenticate
//! with a Better Auth **api-key plugin** credential (`nixmac_…`), not the HMAC
//! sync secret. To obtain one headlessly we:
//!
//! 1. `POST /api/auth/sign-in/email-otp` (or the legacy email/password
//!    endpoints below) — establishes a Better Auth session (the cookie is held
//!    by this client's cookie jar).
//! 2. `POST /api/auth/api-key/create` — mints a device-scoped key; the
//!    plaintext `key` is returned exactly once and stored in the OS keychain.
//!
//! The session cookie never leaves this client; only the resulting api key is
//! persisted.

use anyhow::{Context, Result, anyhow};
use reqwest::header::ORIGIN;
use serde::{Deserialize, Serialize};
use url::Url;

/// Outcome of a web-origin sign-in/sign-up + api-key mint.
pub struct WebAuthOutcome {
    pub api_key: String,
    pub account_id: String,
    pub email: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignInRequest<'a> {
    email: &'a str,
    password: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignUpRequest<'a> {
    name: &'a str,
    email: &'a str,
    password: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SendOtpRequest<'a> {
    email: &'a str,
    #[serde(rename = "type")]
    otp_type: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignInOtpRequest<'a> {
    email: &'a str,
    otp: &'a str,
    name: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateApiKeyRequest<'a> {
    name: &'a str,
}

#[derive(Deserialize)]
struct AuthUser {
    id: String,
    email: String,
}

#[derive(Deserialize)]
struct SignInResponse {
    user: AuthUser,
}

#[derive(Deserialize)]
struct CreateApiKeyResponse {
    key: String,
}

/// Headless Better Auth client bound to one web/API origin.
pub struct AccountClient {
    base_url: String,
    origin: String,
    http: reqwest::Client,
}

impl AccountClient {
    /// Builds a client for `base_url` (trailing slashes trimmed) with a cookie
    /// jar so the sign-in session carries into the api-key creation call.
    pub fn new(base_url: impl Into<String>) -> Result<Self> {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        let origin = web_origin(&base_url)?;
        let http = reqwest::Client::builder()
            .cookie_store(true)
            .build()
            .context("failed to build account HTTP client")?;
        Ok(Self {
            base_url,
            origin,
            http,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    fn with_origin(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        builder.header(ORIGIN, &self.origin)
    }

    /// Signs in with an existing nixmac account and mints a per-device API key.
    pub async fn sign_in_and_mint_key(
        &self,
        email: &str,
        password: &str,
        device_name: &str,
    ) -> Result<WebAuthOutcome> {
        let sign_in = self.sign_in(email, password).await?;
        let api_key = self.mint_api_key(device_name).await?;
        Ok(WebAuthOutcome {
            api_key,
            account_id: sign_in.user.id,
            email: sign_in.user.email,
        })
    }

    /// Creates a nixmac account and mints a per-device API key.
    pub async fn sign_up_and_mint_key(
        &self,
        name: &str,
        email: &str,
        password: &str,
        device_name: &str,
    ) -> Result<WebAuthOutcome> {
        let sign_up = self.sign_up(name, email, password).await?;
        let api_key = self.mint_api_key(device_name).await?;
        Ok(WebAuthOutcome {
            api_key,
            account_id: sign_up.user.id,
            email: sign_up.user.email,
        })
    }

    /// Sends a sign-in OTP to an email address. Better Auth will use the same
    /// follow-up endpoint for existing users and first-time auto-registration.
    pub async fn send_sign_in_otp(&self, email: &str) -> Result<()> {
        let resp = self
            .with_origin(
                self.http
                    .post(self.url("/api/auth/email-otp/send-verification-otp")),
            )
            .json(&SendOtpRequest {
                email,
                otp_type: "sign-in",
            })
            .send()
            .await
            .context("send OTP request failed")?;
        error_for_status(resp).await?;
        Ok(())
    }

    /// Signs in with an email OTP and mints a per-device API key.
    pub async fn sign_in_with_otp_and_mint_key(
        &self,
        email: &str,
        otp: &str,
        name: &str,
        device_name: &str,
    ) -> Result<WebAuthOutcome> {
        let sign_in = self.sign_in_with_otp(email, otp, name).await?;
        let api_key = self.mint_api_key(device_name).await?;
        Ok(WebAuthOutcome {
            api_key,
            account_id: sign_in.user.id,
            email: sign_in.user.email,
        })
    }

    async fn sign_in(&self, email: &str, password: &str) -> Result<SignInResponse> {
        let resp = self
            .with_origin(self.http.post(self.url("/api/auth/sign-in/email")))
            .json(&SignInRequest { email, password })
            .send()
            .await
            .context("sign-in request failed")?;
        let resp = error_for_status(resp).await?;
        resp.json().await.context("invalid sign-in response")
    }

    async fn sign_up(&self, name: &str, email: &str, password: &str) -> Result<SignInResponse> {
        let resp = self
            .with_origin(self.http.post(self.url("/api/auth/sign-up/email")))
            .json(&SignUpRequest {
                name,
                email,
                password,
            })
            .send()
            .await
            .context("sign-up request failed")?;
        let resp = error_for_status(resp).await?;
        resp.json().await.context("invalid sign-up response")
    }

    async fn sign_in_with_otp(&self, email: &str, otp: &str, name: &str) -> Result<SignInResponse> {
        let resp = self
            .with_origin(self.http.post(self.url("/api/auth/sign-in/email-otp")))
            .json(&SignInOtpRequest { email, otp, name })
            .send()
            .await
            .context("OTP sign-in request failed")?;
        let resp = error_for_status(resp).await?;
        resp.json().await.context("invalid OTP sign-in response")
    }

    async fn mint_api_key(&self, device_name: &str) -> Result<String> {
        let resp = self
            .with_origin(self.http.post(self.url("/api/auth/api-key/create")))
            .json(&CreateApiKeyRequest { name: device_name })
            .send()
            .await
            .context("api-key create request failed")?;
        let resp = error_for_status(resp).await?;
        let created: CreateApiKeyResponse = resp
            .json()
            .await
            .context("invalid api-key create response")?;
        Ok(created.key)
    }
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
