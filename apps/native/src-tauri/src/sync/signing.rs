//! HMAC-SHA256 request signing for the nixmac sync service.
//!
//! Every authenticated request to the nixmac sync server carries an
//! `Authorization` header proving the client holds the per-account shared
//! secret without ever transmitting it. The construction is a canonical
//! request string signed with HMAC-SHA256:
//!
//! ```text
//! canonical = METHOD \n PATH \n TIMESTAMP \n SHA256_HEX(body)
//! signature = HEX(HMAC_SHA256(secret, canonical))
//! header    = "NIXMAC-HMAC keyId=<keyId>,ts=<ts>,sig=<signature>"
//! ```
//!
//! The timestamp (Unix seconds) is folded into the signature so a captured
//! header cannot be replayed outside a short window the server enforces.

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

/// HTTP `Authorization` scheme name used by the nixmac sync protocol.
pub const AUTH_SCHEME: &str = "NIXMAC-HMAC";

type HmacSha256 = Hmac<Sha256>;

/// Inputs required to sign a single request.
pub struct SigningRequest<'a> {
    /// Uppercase HTTP method, e.g. `GET` or `POST`.
    pub method: &'a str,
    /// Request path beginning with `/`, e.g. `/v1/sync/push`.
    pub path: &'a str,
    /// Unix timestamp (seconds) when the request is being signed.
    pub timestamp: u64,
    /// Raw request body bytes (empty slice for bodyless requests).
    pub body: &'a [u8],
}

/// Builds the canonical string that gets fed into HMAC.
///
/// Kept separate from [`sign`] so it can be unit-tested directly and so the
/// server side can reproduce the exact same bytes.
pub fn canonical_string(req: &SigningRequest<'_>) -> String {
    format!(
        "{}\n{}\n{}\n{}",
        req.method,
        req.path,
        req.timestamp,
        hex::encode(Sha256::digest(req.body))
    )
}

/// Computes the lowercase hex HMAC-SHA256 signature for `req` using `secret`.
pub fn sign(secret: &str, req: &SigningRequest<'_>) -> String {
    let canonical = canonical_string(req);
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any length");
    mac.update(canonical.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Builds the full `Authorization` header value for an authenticated request.
pub fn authorization_header(key_id: &str, secret: &str, req: &SigningRequest<'_>) -> String {
    let sig = sign(secret, req);
    format!(
        "{AUTH_SCHEME} keyId={key_id},ts={ts},sig={sig}",
        ts = req.timestamp
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req<'a>(method: &'a str, path: &'a str, ts: u64, body: &'a [u8]) -> SigningRequest<'a> {
        SigningRequest {
            method,
            path,
            timestamp: ts,
            body,
        }
    }

    #[test]
    fn canonical_string_includes_body_hash() {
        let c = canonical_string(&req("POST", "/v1/sync/push", 1717000000, b"{}"));
        let body_hash = hex::encode(Sha256::digest(b"{}"));
        assert_eq!(c, format!("POST\n/v1/sync/push\n1717000000\n{body_hash}"));
    }

    #[test]
    fn empty_body_hashes_to_sha256_of_empty() {
        let c = canonical_string(&req("GET", "/v1/sync/status", 42, b""));
        // SHA-256 of the empty input is a well-known constant.
        assert!(c.ends_with("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
    }

    #[test]
    fn signature_is_deterministic() {
        let r = req("GET", "/v1/sync/status", 100, b"");
        assert_eq!(sign("topsecret", &r), sign("topsecret", &r));
    }

    #[test]
    fn signature_changes_with_secret() {
        let r = req("GET", "/v1/sync/status", 100, b"");
        assert_ne!(sign("secret-a", &r), sign("secret-b", &r));
    }

    #[test]
    fn signature_changes_with_timestamp() {
        assert_ne!(
            sign("s", &req("GET", "/p", 1, b"")),
            sign("s", &req("GET", "/p", 2, b"")),
        );
    }

    #[test]
    fn signature_changes_with_body() {
        assert_ne!(
            sign("s", &req("POST", "/p", 1, b"a")),
            sign("s", &req("POST", "/p", 1, b"b")),
        );
    }

    #[test]
    fn authorization_header_has_expected_shape() {
        let header = authorization_header("key-123", "s", &req("GET", "/p", 7, b""));
        assert!(header.starts_with("NIXMAC-HMAC keyId=key-123,ts=7,sig="));
        // The signature segment is 64 hex chars (SHA-256 output).
        let sig = header.rsplit("sig=").next().unwrap();
        assert_eq!(sig.len(), 64);
        assert!(sig.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn signature_matches_known_vector() {
        // Locks the wire format: if the canonical construction ever changes,
        // this vector breaks and forces a deliberate protocol-version bump.
        // Reference value computed independently with Python's hmac module.
        let r = req("POST", "/v1/sync/push", 1717000000, b"{\"head\":\"abc\"}");
        assert_eq!(
            sign("shared-secret", &r),
            "e1ec1dfd5fa71112a360d7822650e5b0f10627e791c72015a36b5283e23b521d",
        );
    }
}
