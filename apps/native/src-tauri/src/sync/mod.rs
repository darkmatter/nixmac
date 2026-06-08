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

pub mod client;
pub mod signing;

use anyhow::{anyhow, Result};
use tauri::{AppHandle, Runtime};

use crate::shared_types::{AuthAccount, AuthStatus, SyncRemoteStatus, SyncResult};
use crate::storage::store::{self, SyncAccountMeta};
use client::{SyncClient, SyncCredentials};

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

/// Builds the current [`AuthStatus`] snapshot for the frontend.
pub fn status<R: Runtime>(app: &AppHandle<R>) -> Result<AuthStatus> {
    let server_url = store::get_sync_server_url(app)?;
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

    Ok(AuthStatus {
        signed_in,
        account,
        key_id,
        server_url,
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

    status(app)
}

/// Clears the stored account and device secret.
pub fn sign_out<R: Runtime>(app: &AppHandle<R>) -> Result<AuthStatus> {
    // Delete the secret first so we never leave a usable secret without
    // matching metadata. Both deletes are idempotent.
    store::delete_sync_secret(app)?;
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
