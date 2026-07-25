//! nixmac web account + server-brokered GitHub / billing.
//!
//! Auth is a single plane: Better Auth mints a per-device API key (`nixmac_…`)
//! stored in the OS keychain. Web account metadata (id/email) is non-secret
//! display cache written atomically with that key. Callers authenticate with
//! `x-api-key`; there is no separate sync-HMAC credential.

pub mod account_client;
pub mod github_client;

use anyhow::{Result, anyhow};
use reqwest::header::ORIGIN;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Runtime};

use crate::shared_types::{
    AccountBilling, AuthAccount, AuthStatus, GithubBootstrapState, GithubBootstrapStatus,
    GithubConnectStart, GithubRepo, GithubStatus,
};
use crate::storage::store::{self, WebAccountMeta};
use account_client::AccountClient;
use github_client::{GithubBootstrapClient, GithubClient, GithubCloneToken};

/// Best-effort human-friendly device label sent to the server.
fn device_name<R: Runtime>(app: &AppHandle<R>) -> String {
    store::get_host_attr(app)
        .ok()
        .flatten()
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "nixmac-desktop".to_string())
}

/// Builds an authed request to a web `/api/billing/*` endpoint. Billing
/// procedures are served by oRPC's OpenAPI handler, so request and response
/// bodies are plain JSON (no `{ json }` RPC envelope).
fn billing_request<R: Runtime>(
    app: &AppHandle<R>,
    method: reqwest::Method,
    path: &str,
) -> Result<reqwest_middleware::RequestBuilder> {
    let api_key =
        store::get_device_api_key(app)?.ok_or_else(|| anyhow!("Sign in before using billing"))?;
    let base = store::get_web_server_url()?;
    let origin = account_client::web_origin(&base)?;
    let url = format!("{}/api/billing/{}", base.trim_end_matches('/'), path);
    Ok(crate::http_client::logged()
        .request(method, url)
        .header("x-api-key", api_key)
        .header(ORIGIN, origin)
        .header("accept", "application/json"))
}

/// Reads a plain-JSON billing response, surfacing the server's `message` field
/// (oRPC error shape) on non-2xx responses.
async fn read_billing_json<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
    context: &str,
) -> Result<T> {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body)
            && let Some(message) = payload.get("message").and_then(|value| value.as_str())
        {
            return Err(anyhow!("{context} failed ({status}): {message}"));
        }
        return Err(anyhow!("{context} failed ({status}): {body}"));
    }
    serde_json::from_str::<T>(&body)
        .map_err(|error| anyhow!("Failed to decode {context} response: {error}: {body}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckoutInput {
    product: String,
}

#[derive(Deserialize)]
struct CheckoutUrlResponse {
    url: String,
}

/// Fetches the signed-in account's billing snapshot via `/api/billing/state`.
pub async fn account_billing<R: Runtime>(app: &AppHandle<R>) -> Result<AccountBilling> {
    let response = billing_request(app, reqwest::Method::GET, "state")?
        .send()
        .await?;
    read_billing_json(response, "Account billing request").await
}

/// A billing product offered to customers, mirrored from `/api/billing/products`.
#[derive(Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BillingProductInfo {
    pub product: String,
    pub name: String,
    pub currency: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurring_interval: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum_amount_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum_amount_usd: Option<f64>,
}

#[derive(Deserialize)]
struct BillingProductsResponse {
    products: Vec<BillingProductInfo>,
}

/// Lists the available billing products (with pricing) from `/api/billing/products`.
/// This endpoint is public; the device api-key is forwarded when available but
/// not required.
pub async fn billing_products<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<BillingProductInfo>> {
    let base = store::get_web_server_url()?;
    let origin = account_client::web_origin(&base)?;
    let url = format!("{}/api/billing/products", base.trim_end_matches('/'));
    let mut request = crate::http_client::logged()
        .get(url)
        .header(ORIGIN, origin)
        .header("accept", "application/json");
    if let Ok(Some(api_key)) = store::get_device_api_key(app) {
        request = request.header("x-api-key", api_key);
    }
    let response = request.send().await?;
    let parsed: BillingProductsResponse =
        read_billing_json(response, "Billing products request").await?;
    Ok(parsed.products)
}

/// Builds the current [`AuthStatus`] snapshot for the frontend.
///
/// Signed-in means a device API key is present. Web account metadata is only
/// surfaced when that key exists, so the UI cannot show an email without a
/// usable credential.
pub fn status<R: Runtime>(app: &AppHandle<R>) -> Result<AuthStatus> {
    let has_device_api_key = store::get_device_api_key(app)?.is_some();
    if !has_device_api_key {
        // Drop orphaned display cache / retired HMAC leftovers so settings
        // never show an email without a usable credential.
        let _ = store::delete_web_account(app);
        let _ = store::wipe_legacy_sync_credentials(app);
    }
    let web_account = if has_device_api_key {
        store::get_web_account(app)?.map(|meta| AuthAccount {
            id: meta.account_id,
            email: meta.email,
        })
    } else {
        None
    };

    Ok(AuthStatus {
        signed_in: has_device_api_key,
        account: web_account.clone(),
        github_ready: store::github_ready(app)?,
        web_account,
    })
}

/// Signs in (or creates) a nixmac account on the **web origin** and stores the
/// per-device api-key used for server-brokered GitHub access.
pub async fn sign_in_web<R: Runtime>(
    app: &AppHandle<R>,
    email: &str,
    password: &str,
) -> Result<AuthStatus> {
    let email = email.trim();
    if email.is_empty() || password.is_empty() {
        return Err(anyhow!("Email and password are required"));
    }
    let base = store::get_web_server_url()?;
    let client = AccountClient::new(base)?;
    let device = device_name(app);
    let outcome = client
        .sign_in_and_mint_key(email, password, &device)
        .await?;
    persist_web_session(app, &outcome)?;
    status(app)
}

/// Creates a nixmac account on the web origin and stores the device api-key.
pub async fn sign_up_web<R: Runtime>(
    app: &AppHandle<R>,
    name: &str,
    email: &str,
    password: &str,
) -> Result<AuthStatus> {
    let name = name.trim();
    let email = email.trim();
    if name.is_empty() || email.is_empty() || password.is_empty() {
        return Err(anyhow!("Name, email, and password are required"));
    }
    if password.len() < 8 {
        return Err(anyhow!("Password must be at least 8 characters"));
    }
    let base = store::get_web_server_url()?;
    let client = AccountClient::new(base)?;
    let device = device_name(app);
    let outcome = client
        .sign_up_and_mint_key(name, email, password, &device)
        .await?;
    persist_web_session(app, &outcome)?;
    status(app)
}

/// Sends a Better Auth sign-in OTP for the web-origin nixmac account.
pub async fn send_web_sign_in_otp(email: &str) -> Result<()> {
    let email = email.trim();
    if email.is_empty() {
        return Err(anyhow!("Email is required"));
    }
    let base = store::get_web_server_url()?;
    let client = AccountClient::new(base)?;
    client.send_sign_in_otp(email).await
}

/// Verifies a Better Auth sign-in OTP, mints a device api-key, and stores it
/// for server-brokered GitHub access.
pub async fn verify_web_sign_in_otp<R: Runtime>(
    app: &AppHandle<R>,
    email: &str,
    otp: &str,
    name: &str,
) -> Result<AuthStatus> {
    let email = email.trim();
    let otp = otp.trim();
    let name = name.trim();
    if email.is_empty() || otp.is_empty() || name.is_empty() {
        return Err(anyhow!("Email, code, and name are required"));
    }
    let base = store::get_web_server_url()?;
    let client = AccountClient::new(base)?;
    let device = device_name(app);
    let outcome = client
        .sign_in_with_otp_and_mint_key(email, otp, name, &device)
        .await?;
    persist_web_session(app, &outcome)?;
    status(app)
}

/// Creates a Polar checkout for the signed-in account and returns the URL to
/// open. `product` is `pro` or `credits` (the PAYG metered subscription).
pub async fn create_checkout<R: Runtime>(app: &AppHandle<R>, product: &str) -> Result<String> {
    let product = product.trim();
    if product != "pro" && product != "credits" {
        return Err(anyhow!("Checkout product must be pro or credits"));
    }

    let response = billing_request(app, reqwest::Method::POST, "checkout")?
        .json(&CheckoutInput {
            product: product.to_string(),
        })
        .send()
        .await?;

    let checkout: CheckoutUrlResponse = read_billing_json(response, "Checkout request").await?;
    Ok(checkout.url)
}

/// Creates a Polar customer portal session for self-service billing management
/// and returns the URL to open.
pub async fn create_billing_portal<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let response = billing_request(app, reqwest::Method::POST, "portal")?
        .send()
        .await?;
    let portal: CheckoutUrlResponse = read_billing_json(response, "Billing portal request").await?;
    Ok(portal.url)
}

fn persist_web_session<R: Runtime>(
    app: &AppHandle<R>,
    outcome: &account_client::WebAuthOutcome,
) -> Result<()> {
    // Key first: if metadata write fails, status still treats the device as
    // signed in (key present) rather than showing an email with no credential.
    store::set_device_api_key(app, &outcome.api_key)?;
    store::set_web_account(
        app,
        &WebAccountMeta {
            account_id: outcome.account_id.clone(),
            email: outcome.email.clone(),
        },
    )
}

/// Clears the stored device API key and web account metadata.
pub fn sign_out<R: Runtime>(app: &AppHandle<R>) -> Result<AuthStatus> {
    // Delete the secret first so we never leave a usable key without matching
    // metadata intent. Also wipe retired HMAC sync credentials if present.
    store::delete_device_api_key(app)?;
    store::delete_web_account(app)?;
    store::wipe_legacy_sync_credentials(app)?;
    status(app)
}

/// Builds a [`GithubClient`] for the web origin from the stored per-device API
/// key. Errors when the device has no key yet (sign in to mint one).
fn require_github_client<R: Runtime>(app: &AppHandle<R>) -> Result<GithubClient> {
    let api_key = store::get_device_api_key(app)?.ok_or_else(|| {
        anyhow!("Create or sign in to your nixmac account below, then connect GitHub")
    })?;
    let base = store::get_web_server_url()?;
    GithubClient::new(base, api_key)
}

/// Starts the GitHub-first bootstrap flow before this device has a Better Auth
/// API key. The server creates/binds the Better Auth user during the callback.
pub async fn github_bootstrap_start() -> Result<GithubConnectStart> {
    let base = store::get_web_server_url()?;
    GithubBootstrapClient::new(base)?.start().await
}

/// Polls a GitHub-first bootstrap flow. When the server returns the one-time
/// device API key, persist it natively and only return non-secret status to JS.
pub async fn github_bootstrap_status<R: Runtime>(
    app: &AppHandle<R>,
    state: &str,
) -> Result<GithubBootstrapStatus> {
    let state = state.trim();
    if state.is_empty() {
        return Err(anyhow!("GitHub bootstrap state is required"));
    }

    let base = store::get_web_server_url()?;
    let poll = GithubBootstrapClient::new(base)?.status(state).await?;
    if poll.status.state == GithubBootstrapState::Complete {
        if let Some(api_key) = poll.api_key.as_deref() {
            let account =
                poll.status.account.as_ref().ok_or_else(|| {
                    anyhow!("GitHub bootstrap completed without account metadata")
                })?;
            persist_web_session(
                app,
                &account_client::WebAuthOutcome {
                    api_key: api_key.to_string(),
                    account_id: account.id.clone(),
                    email: account.email.clone(),
                },
            )?;
        } else if store::get_device_api_key(app)?.is_none() {
            return Err(anyhow!(
                "GitHub bootstrap completed without a persisted device api key"
            ));
        }
    }

    Ok(poll.status)
}

/// Starts the server-brokered GitHub App connect flow; returns the install URL.
pub async fn github_connect_start<R: Runtime>(app: &AppHandle<R>) -> Result<GithubConnectStart> {
    require_github_client(app)?.connect_start().await
}

/// Returns whether the account is linked to a GitHub App installation.
pub async fn github_status<R: Runtime>(app: &AppHandle<R>) -> Result<GithubStatus> {
    require_github_client(app)?.status().await
}

/// Lists the repositories the account's installation can access.
pub async fn github_list_repos<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<GithubRepo>> {
    require_github_client(app)?.list_repos().await
}

/// Mints a short-lived, repo-scoped clone token for `owner/repo`.
pub async fn github_clone_token<R: Runtime>(
    app: &AppHandle<R>,
    owner: &str,
    repo: &str,
) -> Result<GithubCloneToken> {
    require_github_client(app)?.clone_token(owner, repo).await
}

/// Drops the account↔installation link (the user revokes in GitHub settings).
pub async fn github_disconnect<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    require_github_client(app)?.disconnect().await
}
