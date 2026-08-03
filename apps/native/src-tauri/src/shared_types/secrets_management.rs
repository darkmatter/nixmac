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

/// Whether decryption is available for this specific process or not via its private identity.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum DecryptionCapability {
    Available,
    Unavailable,
    #[default]
    Unknown,
}

/// Where a private decryption identity was discovered.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum DecryptionIdentityLocality {
    /// Declared by the evaluated nix-darwin configuration.
    Configuration,
    /// Supplied to the running nixmac process through its environment.
    Process,
    /// Found at a conventional path on this machine.
    Machine,
}

/// Private identity format. The identity material itself is never returned.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum DecryptionIdentityKind {
    AgeKeyFile,
    SshKeyPath,
}

/// A locally discoverable private identity source.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct DecryptionIdentity {
    pub kind: DecryptionIdentityKind,
    pub locality: DecryptionIdentityLocality,
    pub path: String,
    pub available: bool,
    /// Public recipient derived without returning private key material.
    pub public_keys: Vec<String>,
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
    pub public_recipients: Vec<String>,
    pub public_recipients_resolved: bool,
    pub recipient_ids: Vec<String>,
    pub decryption_capability: DecryptionCapability,
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

    // Whether this recipient is registered by repository configuration.
    pub in_use: bool,

    pub registrations: Vec<RecipientRegistration>,

    pub is_local_identity: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SecretsVault {
    pub primary_decryption_identity_id: Option<String>,
    pub entries: Vec<SecretEntry>,
    pub recipients: Vec<SecretRecipient>,
    pub decryption_identities: Vec<DecryptionIdentity>,
}
