//! Contract types for the nixmac account feature.
//!
//! These describe the desktop client's view of authentication. The wire types
//! the client exchanges with the server live in `crate::sync`; the structs here
//! are what the frontend consumes.

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
/// `account_status`. The device API key is never included.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    /// Whether a usable device API key is stored on this device.
    pub signed_in: bool,
    /// The signed-in account, when `signed_in` is true and metadata is present.
    pub account: Option<AuthAccount>,
    /// Whether this device can call server-brokered GitHub endpoints (has a
    /// minted Better Auth api-key for the web origin).
    pub github_ready: bool,
    /// The web-origin account used for GitHub, when `github_ready` is true.
    pub web_account: Option<AuthAccount>,
}

/// Hosted inference usage for the signed-in web account.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BillingUsage {
    pub currency: String,
    pub spent_usd: f64,
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

/// Billing snapshot returned by `/api/billing/state` for onboarding and account UI.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AccountBilling {
    pub usage: BillingUsage,
    pub subscriptions: Vec<BillingSubscription>,
    pub has_payment_method: bool,
    pub can_use_hosted_inference: bool,
    pub can_use_device_sync: bool,
}
