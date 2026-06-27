//! nixmac account + non-GitHub sync.
//!
//! This module is the glue between the Tauri commands, the persistent
//! credential store, and the HTTP [`client`]. It owns the high-level flows
//! (sign in, sign out, push, pull, status) and keeps all keychain/store access
//! in one place so commands stay thin.
//!
//! Auth uses a per-device HMAC shared secret (see [`signing`]): the user signs
//! in once with their nixmac account, the server issues a `keyId`/`secret`
//! pair, the secret is stored in the OS keychain, and every subsequent request
//! is signed with HMAC-SHA256. The secret is never sent again after sign-in.

pub mod account_client;
pub mod client;
pub mod github_client;
pub mod signing;

use anyhow::{Result, anyhow};
use reqwest::header::ORIGIN;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::shared_types::{
    AuthAccount, AuthStatus, GithubBootstrapState, GithubBootstrapStatus, GithubConnectStart,
    GithubRepo, GithubStatus, SyncRemoteStatus, SyncResult,
};
use crate::storage::store::{self, SyncAccountMeta, WebAccountMeta};
use account_client::AccountClient;
use client::{SyncClient, SyncCredentials};
use github_client::{GithubBootstrapClient, GithubClient, GithubCloneToken};

/// Best-effort human-friendly device label sent to the server.
fn device_name<R: Runtime>(app: &AppHandle<R>) -> String {
    store::get_host_attr(app)
        .ok()
        .flatten()
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "nixmac-desktop".to_string())
}

/// Assembles signing credentials from the keychain secret + stored metadata.
/// Returns `Ok(None)` when the device is not signed in.
fn current_credentials<R: Runtime>(app: &AppHandle<R>) -> Result<Option<SyncCredentials>> {
    let Some(meta) = store::get_sync_account(app)? else {
        return Ok(None);
    };
    let Some(secret) = store::get_sync_secret(app)? else {
        return Ok(None);
    };
    Ok(Some(SyncCredentials {
        account_id: meta.account_id,
        key_id: meta.key_id,
        secret,
    }))
}

fn require_credentials<R: Runtime>(app: &AppHandle<R>) -> Result<SyncCredentials> {
    current_credentials(app)?.ok_or_else(|| anyhow!("Not signed in to a nixmac account"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PaygCheckoutRequest<'a> {
    amount_usd: f64,
    country: &'a str,
    postal_code: &'a str,
}

#[derive(Deserialize)]
struct PaygCheckoutResponse {
    url: String,
}

/// Builds the current [`AuthStatus`] snapshot for the frontend.
pub fn status<R: Runtime>(app: &AppHandle<R>) -> Result<AuthStatus> {
    let server_url = store::get_sync_server_url(app)?;
    let web_account = store::get_web_account(app)?.map(|meta| AuthAccount {
        id: meta.account_id,
        email: meta.email,
    });
    let has_device_api_key = store::get_device_api_key(app)?.is_some();

    if let Some(account) = web_account.clone().filter(|_| has_device_api_key) {
        return Ok(AuthStatus {
            signed_in: true,
            account: Some(account),
            key_id: None,
            server_url,
            github_ready: store::get_web_server_url().is_ok(),
            web_account,
        });
    }

    let meta = store::get_sync_account(app)?;
    let has_secret = store::get_sync_secret(app)?.is_some();
    let signed_in = meta.is_some() && has_secret;
    let (account, key_id) = match meta {
        Some(meta) if has_secret => (
            Some(AuthAccount {
                id: meta.account_id,
                email: meta.email,
            }),
            Some(meta.key_id),
        ),
        _ => (None, None),
    };

    let github_ready = store::github_ready(app)?;

    Ok(AuthStatus {
        signed_in,
        account,
        key_id,
        server_url,
        github_ready,
        web_account,
    })
}

/// Updates the configured sync server URL and returns the refreshed status.
pub fn set_server_url<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<AuthStatus> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Server URL cannot be empty"));
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(anyhow!("Server URL must start with http:// or https://"));
    }
    store::set_sync_server_url(app, trimmed)?;
    status(app)
}

/// Signs in with a nixmac account, stores the issued credentials, and returns
/// the refreshed status.
pub async fn sign_in<R: Runtime>(
    app: &AppHandle<R>,
    email: &str,
    password: &str,
) -> Result<AuthStatus> {
    let email = email.trim();
    if email.is_empty() || password.is_empty() {
        return Err(anyhow!("Email and password are required"));
    }

    let server_url = store::get_sync_server_url(app)?;
    let client = SyncClient::new(server_url);
    let outcome = client.login(email, password, &device_name(app)).await?;

    // Persist the secret first; if storing metadata fails we still want the
    // keychain and store to agree, so clean up the secret on metadata failure.
    store::set_sync_secret(app, &outcome.credentials.secret)?;
    let meta = SyncAccountMeta {
        account_id: outcome.credentials.account_id,
        email: outcome.account.email,
        key_id: outcome.credentials.key_id,
    };
    if let Err(err) = store::set_sync_account(app, &meta) {
        let _ = store::delete_sync_secret(app);
        return Err(err);
    }

    // Mint a per-device Better Auth API key against the web origin for
    // server-brokered GitHub access. Best-effort: a healthy sync sign-in must
    // not fail just because the web origin is unconfigured or unreachable —
    // GitHub features simply stay unavailable until the next successful mint.
    mint_device_api_key(app, email, password).await;

    status(app)
}

/// Signs in (or creates) a nixmac account on the **web origin** and stores the
/// per-device api-key used for server-brokered GitHub access. Does not touch the
/// legacy HMAC sync server — use this during onboarding before GitHub connect.
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

/// Creates a Polar-hosted PAYG checkout for the signed-in web-origin account.
pub async fn create_payg_checkout<R: Runtime>(
    app: &AppHandle<R>,
    amount_usd: f64,
    country: &str,
    postal_code: &str,
) -> Result<String> {
    let country = country.trim();
    let postal_code = postal_code.trim();
    if amount_usd <= 0.0 || country.is_empty() || postal_code.is_empty() {
        return Err(anyhow!("Amount, country, and ZIP code are required"));
    }

    let api_key = store::get_device_api_key(app)?
        .ok_or_else(|| anyhow!("Sign in before starting checkout"))?;
    let base = store::get_web_server_url()?;
    let origin = account_client::web_origin(&base)?;
    let url = format!("{}/api/billing/payg-checkout", base.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .post(url)
        .header("x-api-key", api_key)
        .header(ORIGIN, origin)
        .json(&PaygCheckoutRequest {
            amount_usd,
            country,
            postal_code,
        })
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!("Checkout request failed ({status}): {body}"));
    }

    let checkout: PaygCheckoutResponse = response.json().await?;
    Ok(checkout.url)
}

fn persist_web_session<R: Runtime>(
    app: &AppHandle<R>,
    outcome: &account_client::WebAuthOutcome,
) -> Result<()> {
    store::set_device_api_key(app, &outcome.api_key)?;
    store::set_web_account(
        app,
        &WebAccountMeta {
            account_id: outcome.account_id.clone(),
            email: outcome.email.clone(),
        },
    )
}

/// Signs in to the web origin's Better Auth and stores the resulting per-device
/// API key. Errors are logged, never propagated (see `sign_in`).
async fn mint_device_api_key<R: Runtime>(app: &AppHandle<R>, email: &str, password: &str) {
    let base = match store::get_web_server_url() {
        Ok(base) => base,
        Err(err) => {
            log::warn!("github: web origin not configured, skipping api-key mint: {err:#}");
            return;
        }
    };
    let client = match AccountClient::new(base) {
        Ok(client) => client,
        Err(err) => {
            log::warn!("github: failed to build account client: {err:#}");
            return;
        }
    };
    match client
        .sign_in_and_mint_key(email, password, &device_name(app))
        .await
    {
        Ok(outcome) => {
            if let Err(err) = persist_web_session(app, &outcome) {
                log::warn!("github: failed to store device api-key: {err:#}");
            }
        }
        Err(err) => log::warn!("github: failed to mint device api-key: {err:#}"),
    }
}

/// Clears the stored account and device secret.
pub fn sign_out<R: Runtime>(app: &AppHandle<R>) -> Result<AuthStatus> {
    // Delete the secret first so we never leave a usable secret without
    // matching metadata. All deletes are idempotent.
    store::delete_sync_secret(app)?;
    store::delete_device_api_key(app)?;
    store::delete_web_account(app)?;
    store::delete_sync_account(app)?;
    status(app)
}

/// Fetches the server-side sync status for the signed-in account.
pub async fn remote_status<R: Runtime>(app: &AppHandle<R>) -> Result<SyncRemoteStatus> {
    let creds = require_credentials(app)?;
    let client = SyncClient::new(store::get_sync_server_url(app)?);
    client.remote_status(&creds).await
}

/// Reads the local repo HEAD and pushes the snapshot pointer to the server.
pub async fn push<R: Runtime>(app: &AppHandle<R>) -> Result<SyncResult> {
    let creds = require_credentials(app)?;
    let dir = store::get_repo_root(app)?;
    let git_status = crate::git::status(&dir)?;
    let head = git_status
        .head_commit_hash
        .ok_or_else(|| anyhow!("Nothing to sync: the config repo has no commits yet"))?;

    let client = SyncClient::new(store::get_sync_server_url(app)?);
    let head_commit_hash = client
        .push(
            &creds,
            &head,
            git_status.branch.as_deref(),
            &device_name(app),
        )
        .await?;

    Ok(SyncResult {
        ok: true,
        head_commit_hash: head_commit_hash.or(Some(head)),
        message: "Pushed local configuration to nixmac sync".to_string(),
    })
}

/// Fetches the server's latest snapshot pointer.
pub async fn pull<R: Runtime>(app: &AppHandle<R>) -> Result<SyncResult> {
    let creds = require_credentials(app)?;
    let client = SyncClient::new(store::get_sync_server_url(app)?);
    let head_commit_hash = client.pull(&creds).await?;

    let message = match &head_commit_hash {
        Some(hash) => format!("Server has snapshot {}", short_hash(hash)),
        None => "No server snapshot found for this account yet".to_string(),
    };

    Ok(SyncResult {
        ok: true,
        head_commit_hash,
        message,
    })
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

fn short_hash(hash: &str) -> &str {
    &hash[..hash.len().min(8)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_hash_truncates_long_hashes() {
        assert_eq!(short_hash("0123456789abcdef"), "01234567");
    }

    #[test]
    fn short_hash_keeps_short_inputs() {
        assert_eq!(short_hash("abc"), "abc");
    }
}
