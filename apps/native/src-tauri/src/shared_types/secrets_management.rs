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
    Unknown,
}

/// Public-key format used by a secret recipient.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum RecipientKeyType {
    Age,
    Ssh,
    Pgp,
    #[default]
    Unknown,
}

/// Where the recipient's key material originates.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum RecipientSource {
    SshHostKey,
    SshIdentity,
    AgeKeyFile,
    Pasted,
    Github,
    Yubikey,
    SecureEnclave,
    Repository,
    #[default]
    Unknown,
}

/// A repository configuration source that registers a recipient.
/// Keeping the backend alongside the path matters because the same public key
/// can be registered independently for SOPS and agenix.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecipientRegistration {
    pub backend: SecretBackend,
    pub file: String,
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
    pub key_type: RecipientKeyType,
    pub source: RecipientSource,

    // A recipient must be committed to the repo before it can decrypt secrets.
    pub in_use: bool,

    pub registrations: Vec<RecipientRegistration>,

    pub is_this_host: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SecretsVault {
    pub host_id: String,
    pub entries: Vec<SecretEntry>,
    pub recipients: Vec<SecretRecipient>,
}
