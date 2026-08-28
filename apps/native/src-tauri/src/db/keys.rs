//! Content-addressing helpers for summaries and snapshots.
//!
//! A "content key" is the sha256 hex digest of a set of change hashes: the
//! hashes are sorted and de-duplicated, then joined with a NUL separator before
//! hashing. This mirrors `git::hunk_hash` (also sha2/sha256) so identity is
//! stable and order-independent across summarization runs.

use sha2::{Digest, Sha256};

/// Compute the content key for a set of change hashes.
///
/// Sorting + dedup make the key a pure function of the *set* of members, so the
/// same group / snapshot is recognized regardless of the order the hashes were
/// discovered in.
pub fn content_key(hashes: &[String]) -> String {
    let mut sorted: Vec<&str> = hashes.iter().map(String::as_str).collect();
    sorted.sort_unstable();
    sorted.dedup();

    let mut hasher = Sha256::new();
    for (i, hash) in sorted.iter().enumerate() {
        if i > 0 {
            hasher.update(b"\0");
        }
        hasher.update(hash.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

/// Key identifying an exact set of change hashes for a cached snapshot.
pub fn snapshot_key(hashes: &[String]) -> String {
    content_key(hashes)
}

/// Key identifying the exact membership of a summary group.
pub fn group_key(hashes: &[String]) -> String {
    content_key(hashes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_key_is_order_independent() {
        let a = content_key(&["b".into(), "a".into(), "c".into()]);
        let b = content_key(&["c".into(), "b".into(), "a".into()]);
        assert_eq!(a, b);
    }

    #[test]
    fn content_key_ignores_duplicates() {
        let a = content_key(&["a".into(), "b".into()]);
        let b = content_key(&["a".into(), "b".into(), "a".into()]);
        assert_eq!(a, b);
    }

    #[test]
    fn content_key_differs_by_membership() {
        let a = content_key(&["a".into(), "b".into()]);
        let b = content_key(&["a".into(), "c".into()]);
        assert_ne!(a, b);
    }

    #[test]
    fn empty_set_has_a_stable_key() {
        assert_eq!(content_key(&[]), content_key(&[]));
    }
}
