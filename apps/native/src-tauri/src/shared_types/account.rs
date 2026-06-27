//! Contract types for the nixmac account + non-GitHub sync feature.
//!
//! These describe the desktop client's view of authentication and the sync
//! service. The wire types the client exchanges with the server live in
//! `crate::sync`; the structs here are what the frontend consumes.

use serde::{Deserialize, Serialize};
use specta::Type;

/// The signed-in nixmac account, minus any secret material.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthAccount {
    /// Stable account identifier assigned by the server.
    pub id: String,
    /// Account email address used to sign in.
    pub email: String,
}

/// Snapshot of the desktop client's authentication state, returned by
/// `account_status`. The HMAC secret is never included.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    /// Whether a usable account credential is stored on this device.
    pub signed_in: bool,
    /// The signed-in account, when `signed_in` is true.
    pub account: Option<AuthAccount>,
    /// Public credential/key identifier sent in the `Authorization` header.
    pub key_id: Option<String>,
    /// Base URL of the sync server this device is configured to talk to.
    pub server_url: String,
    /// Whether this device can call server-brokered GitHub endpoints (has a
    /// minted Better Auth api-key for the web origin).
    pub github_ready: bool,
    /// The web-origin account used for GitHub, when `github_ready` is true.
    pub web_account: Option<AuthAccount>,
}

/// Remote sync state for the current account, returned by `sync_status`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncRemoteStatus {
    /// Whether the server has a stored configuration snapshot for this account.
    pub configured: bool,
    /// Commit hash of the latest snapshot the server holds, if any.
    pub head_commit_hash: Option<String>,
    /// Unix timestamp (seconds) of the latest server-side snapshot, if any.
    pub updated_at: Option<i64>,
    /// Number of devices currently registered to the account.
    pub device_count: u32,
}

/// Result of a `sync_push` or `sync_pull` operation.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    /// Whether the operation succeeded end-to-end.
    pub ok: bool,
    /// Commit hash that is now current after the operation, when known.
    pub head_commit_hash: Option<String>,
    /// Human-readable status detail for display in the UI.
    pub message: String,
}

/// Hosted inference credit balance for the signed-in web account.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreditBalance {
    pub currency: String,
    pub remaining_usd: f64,
    pub spent_usd: f64,
    pub total_usd: f64,
}

/// Active Polar subscription mapped to a known nixmac product slug.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BillingSubscription {
    pub id: String,
    pub slug: String,
    pub product_id: String,
    pub status: String,
}

/// Billing snapshot returned by `/api/me` for onboarding and account UI.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AccountBilling {
    pub usage: CreditBalance,
    pub subscriptions: Vec<BillingSubscription>,
    pub has_payment_method: bool,
    pub can_use_hosted_inference: bool,
    pub can_use_device_sync: bool,
}
