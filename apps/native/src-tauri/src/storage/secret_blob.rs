use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const BLOB_VERSION: u8 = 1;
const CIPHER_NAME: &str = "AES-256-GCM";
const DATA_KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

pub type SecretMap = BTreeMap<String, String>;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretBlobPayload {
    #[serde(default)]
    pub secrets: SecretMap,
    #[serde(default)]
    pub legacy_keychain_migration_complete: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum SecretBlobError {
    #[error("data key must be {DATA_KEY_LEN} bytes, got {0}")]
    InvalidDataKeyLength(usize),
    #[error("invalid data key encoding: {0}")]
    InvalidDataKeyEncoding(#[source] base64::DecodeError),
    #[error("invalid encrypted secrets blob JSON: {0}")]
    InvalidBlobJson(#[source] serde_json::Error),
    #[error("unsupported encrypted secrets blob version: {0}")]
    UnsupportedVersion(u8),
    #[error("unsupported encrypted secrets cipher: {0}")]
    UnsupportedCipher(String),
    #[error("invalid encrypted secrets nonce encoding: {0}")]
    InvalidNonceEncoding(#[source] base64::DecodeError),
    #[error("encrypted secrets nonce must be {NONCE_LEN} bytes, got {0}")]
    InvalidNonceLength(usize),
    #[error("invalid encrypted secrets ciphertext encoding: {0}")]
    InvalidCiphertextEncoding(#[source] base64::DecodeError),
    #[error("encrypted secrets blob encryption failed")]
    Encrypt,
    #[error("encrypted secrets blob decryption failed")]
    Decrypt,
    #[error("invalid decrypted secrets JSON: {0}")]
    InvalidPayloadJson(#[source] serde_json::Error),
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedSecretBlob {
    version: u8,
    cipher: String,
    nonce: String,
    ciphertext: String,
}

pub fn generate_encoded_data_key() -> String {
    let key = Aes256Gcm::generate_key(&mut OsRng);
    STANDARD.encode(key.as_slice())
}

pub fn decode_data_key(encoded: &str) -> Result<[u8; DATA_KEY_LEN], SecretBlobError> {
    let bytes = STANDARD
        .decode(encoded.trim())
        .map_err(SecretBlobError::InvalidDataKeyEncoding)?;
    bytes
        .try_into()
        .map_err(|bytes: Vec<u8>| SecretBlobError::InvalidDataKeyLength(bytes.len()))
}

pub fn encrypt_payload(
    payload: &SecretBlobPayload,
    data_key: &[u8; DATA_KEY_LEN],
) -> Result<String, SecretBlobError> {
    let cipher = Aes256Gcm::new_from_slice(data_key)
        .map_err(|_| SecretBlobError::InvalidDataKeyLength(data_key.len()))?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let plaintext = serde_json::to_vec(payload).map_err(SecretBlobError::InvalidPayloadJson)?;
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_ref())
        .map_err(|_| SecretBlobError::Encrypt)?;

    let blob = EncryptedSecretBlob {
        version: BLOB_VERSION,
        cipher: CIPHER_NAME.to_string(),
        nonce: STANDARD.encode(nonce.as_slice()),
        ciphertext: STANDARD.encode(ciphertext),
    };

    serde_json::to_string_pretty(&blob).map_err(SecretBlobError::InvalidBlobJson)
}

pub fn decrypt_payload(
    encrypted: &str,
    data_key: &[u8; DATA_KEY_LEN],
) -> Result<SecretBlobPayload, SecretBlobError> {
    let blob: EncryptedSecretBlob =
        serde_json::from_str(encrypted).map_err(SecretBlobError::InvalidBlobJson)?;
    if blob.version != BLOB_VERSION {
        return Err(SecretBlobError::UnsupportedVersion(blob.version));
    }
    if blob.cipher != CIPHER_NAME {
        return Err(SecretBlobError::UnsupportedCipher(blob.cipher));
    }

    let nonce_bytes = STANDARD
        .decode(blob.nonce)
        .map_err(SecretBlobError::InvalidNonceEncoding)?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err(SecretBlobError::InvalidNonceLength(nonce_bytes.len()));
    }
    let ciphertext = STANDARD
        .decode(blob.ciphertext)
        .map_err(SecretBlobError::InvalidCiphertextEncoding)?;

    let cipher = Aes256Gcm::new_from_slice(data_key)
        .map_err(|_| SecretBlobError::InvalidDataKeyLength(data_key.len()))?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| SecretBlobError::Decrypt)?;

    serde_json::from_slice(&plaintext).map_err(SecretBlobError::InvalidPayloadJson)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_payload_round_trips_secrets() {
        let encoded_key = generate_encoded_data_key();
        let data_key = decode_data_key(&encoded_key).unwrap();
        let mut payload = SecretBlobPayload {
            legacy_keychain_migration_complete: true,
            ..SecretBlobPayload::default()
        };
        payload
            .secrets
            .insert("openrouterApiKey".to_string(), "sk-or-secret".to_string());
        payload
            .secrets
            .insert("vllmApiKey".to_string(), "vllm-secret".to_string());

        let encrypted = encrypt_payload(&payload, &data_key).unwrap();

        assert!(!encrypted.contains("sk-or-secret"));
        assert!(!encrypted.contains("vllm-secret"));
        assert_eq!(decrypt_payload(&encrypted, &data_key).unwrap(), payload);
    }

    #[test]
    fn decrypt_rejects_wrong_data_key() {
        let data_key = decode_data_key(&generate_encoded_data_key()).unwrap();
        let wrong_key = decode_data_key(&generate_encoded_data_key()).unwrap();
        let payload = SecretBlobPayload::default();
        let encrypted = encrypt_payload(&payload, &data_key).unwrap();

        assert!(matches!(
            decrypt_payload(&encrypted, &wrong_key),
            Err(SecretBlobError::Decrypt)
        ));
    }

    #[test]
    fn decode_data_key_requires_32_bytes() {
        let encoded = STANDARD.encode([1_u8, 2, 3]);

        assert!(matches!(
            decode_data_key(&encoded),
            Err(SecretBlobError::InvalidDataKeyLength(3))
        ));
    }
}
