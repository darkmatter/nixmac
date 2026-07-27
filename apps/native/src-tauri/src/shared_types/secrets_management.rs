//! Contract types for the nixmac secrets management feature.
//!
use serde::{Deserialize, Serialize};
use specta::Type;

/// Secret backend used for managing secrets.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum SecretBackend {
    #[default]
    Sops,
    Agenix,
}

/// Kind of recipient used for managing secrets.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum RecipientKind {
    #[default]
    Host,
    User,
}

/// One encrypted secret entry managed in the nix config repo.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SecretEntry {
    pub id: String,
    pub name: String,
    pub backend: SecretBackend,
    pub file: String,
    pub recipient_ids: Vec<String>,
    pub sops_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SecretRecipient {
    pub id: String,
    pub label: String,
    pub kind: RecipientKind,
    pub device: String,
    pub fingerprint: String,
    pub public_key: String,

    // A recipient must be committed to the repo before it can decrypt secrets.
    pub in_use: bool,

    pub is_this_host: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SecretsVault {
    pub host_id: String,
    pub entries: Vec<SecretEntry>,
    pub recipients: Vec<SecretRecipient>,
}
