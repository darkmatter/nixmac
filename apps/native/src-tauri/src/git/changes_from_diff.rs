//! Parses a unified diff into per-hunk [`Change`] structs.
//!
//! Each file × hunk pair becomes one [`Change`]. The hash is deterministic:
//! `SHA-256(filename \0 full_hunk_text)` computed before truncation, so
//! identical changes across commits are naturally deduplicated even when the
//! stored `diff` excerpt is the same for two distinct hunks.
//!
//! `Change.diff` is capped at [`DIFF_EXCERPT_LINES`] for storage/display.
//! `Change.line_count` preserves the full hunk size.

use crate::sqlite_types::Change;
/// Characters retained when hashes are shortened for model prompts.
pub const SHORT_HASH_LEN: usize = 6;

/// Returns a copy of `changes` with each hash truncated to [`SHORT_HASH_LEN`] characters.
/// Use this to build the model-facing version alongside the full-hash slice kept for DB lookups.
pub fn with_short_hashes(changes: &[Change]) -> Vec<Change> {
    changes
        .iter()
        .map(|c| Change {
            hash: c.hash[..SHORT_HASH_LEN].to_string(),
            ..c.clone()
        })
        .collect()
}

/// Returns `(found, unfound)` where `found` contains only changes whose hash is in `hashes`,
/// and `unfound` is `Some(vec)` of any hashes that had no matching change, or `None` if all matched.
/// Returns `(vec![], None)` if either argument is empty.
pub fn filter_by_hashes(
    changes: Vec<Change>,
    hashes: &[String],
) -> (Vec<Change>, Option<Vec<String>>) {
    if changes.is_empty() || hashes.is_empty() {
        return (vec![], None);
    }
    let set: std::collections::HashSet<&str> = hashes.iter().map(String::as_str).collect();
    let found: Vec<Change> = changes
        .into_iter()
        .filter(|c| set.contains(c.hash.as_str()))
        .collect();
    let found_set: std::collections::HashSet<&str> =
        found.iter().map(|c| c.hash.as_str()).collect();
    let unfound: Vec<String> = hashes
        .iter()
        .filter(|h| !found_set.contains(h.as_str()))
        .cloned()
        .collect();
    let unfound = if unfound.is_empty() {
        None
    } else {
        Some(unfound)
    };
    (found, unfound)
}
