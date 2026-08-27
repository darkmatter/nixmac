//! Lookup of existing summaries for a live set of changes.
//!
//! Summaries are content-addressed by change hash (no base commit). Given the
//! live changes, this reconstructs a [`SemanticChangeMap`] directly:
//!
//! 1. Load every stored group whose *entire* membership is present in the live
//!    set, then greedily select non-overlapping groups preferring larger ones.
//! 2. For changes not covered by a group, look up per-change (single) summaries.
//! 3. Changes with neither a group nor a single summary are unsummarized.
//! 4. Load the cached snapshot (by the content key of all live hashes) for the
//!    generated commit message.

use std::collections::{HashMap, HashSet};

use anyhow::Result;

use crate::db::DbPool;
use crate::shared_types::{ChangeWithSummary, SemanticChangeGroup, SemanticChangeMap};
use crate::sqlite_types::{Change, ChangeSummary};
use crate::summarize::sumlog as dbg;

/// Reconstructed summaries for a live set of changes, plus the cached snapshot
/// (id + generated commit message) for that exact set.
pub struct FoundSummaries {
    pub map: SemanticChangeMap,
    pub snapshot_id: Option<i64>,
    pub generated_commit_message: Option<String>,
}

impl FoundSummaries {
    /// True when a non-empty commit message is cached for this exact change set.
    pub fn has_generated_message(&self) -> bool {
        self.generated_commit_message
            .as_deref()
            .is_some_and(|m| !m.trim().is_empty())
    }
}

/// Reconstruct summaries for `changes` directly from content-addressed storage.
pub fn for_changes(pool: &DbPool, changes: &[Change]) -> Result<FoundSummaries> {
    let hashes: Vec<String> = changes.iter().map(|c| c.hash.clone()).collect();
    let change_by_hash: HashMap<&str, &Change> =
        changes.iter().map(|c| (c.hash.as_str(), c)).collect();

    // 1. Groups whose full membership is live, largest first, non-overlapping.
    let mut group_rows = crate::db::summaries::groups_within(pool, &hashes)?;
    group_rows.retain(|g| is_valid_status(&g.status));
    group_rows.sort_by_key(|b| std::cmp::Reverse(b.members.len()));

    let mut covered: HashSet<String> = HashSet::new();
    let mut groups: Vec<SemanticChangeGroup> = vec![];
    for g in group_rows {
        if g.members.iter().any(|h| covered.contains(h)) {
            continue;
        }
        let mut member_changes = Vec::with_capacity(g.members.len());
        for h in &g.members {
            if let Some(change) = change_by_hash.get(h.as_str()) {
                member_changes.push(to_change_with_summary(change, &g.title, &g.description));
                covered.insert(h.clone());
            }
        }
        if member_changes.is_empty() {
            continue;
        }
        groups.push(SemanticChangeGroup {
            summary: ChangeSummary {
                id: g.id,
                title: g.title,
                description: g.description,
                status: g.status,
                created_at: g.created_at,
            },
            changes: member_changes,
        });
    }

    // 2. Uncovered changes fall back to per-change summaries.
    let uncovered: Vec<String> = hashes
        .iter()
        .filter(|h| !covered.contains(*h))
        .cloned()
        .collect();
    let patches = crate::db::summaries::patches_for(pool, &uncovered)?;

    let mut singles: Vec<ChangeWithSummary> = vec![];
    let mut unsummarized_hashes: Vec<String> = vec![];
    for hash in &uncovered {
        match patches.get(hash) {
            Some(patch) if is_valid_status(&patch.status) => {
                if let Some(change) = change_by_hash.get(hash.as_str()) {
                    singles.push(to_change_with_summary(
                        change,
                        &patch.title,
                        &patch.description,
                    ));
                }
            }
            // 3. No usable summary → unsummarized.
            _ => unsummarized_hashes.push(hash.clone()),
        }
    }

    // 4. Cached snapshot (commit message) for the exact live set.
    let snapshot = crate::db::snapshots::get_by_key(pool, &crate::db::keys::snapshot_key(&hashes))?;
    let (snapshot_id, generated_commit_message) = match snapshot {
        Some(s) => (Some(s.id), s.generated_commit_message),
        None => (None, None),
    };

    let map = SemanticChangeMap {
        groups,
        singles,
        unsummarized_hashes,
    };
    dbg::group_log_result(&map);

    Ok(FoundSummaries {
        map,
        snapshot_id,
        generated_commit_message,
    })
}

/// Reconstruct the change map for the working tree's current changes.
pub fn for_current_state(pool: &DbPool, dir: &str) -> Result<SemanticChangeMap> {
    let status = crate::git::status(dir)?;
    Ok(for_changes(pool, &status.changes)?.map)
}

fn is_valid_status(status: &str) -> bool {
    !matches!(status, "FAILED" | "CANCELLED" | "QUEUED")
}

fn to_change_with_summary(change: &Change, title: &str, description: &str) -> ChangeWithSummary {
    ChangeWithSummary {
        id: change.id,
        hash: change.hash.clone(),
        filename: change.filename.clone(),
        diff: change.diff.clone(),
        line_count: change.line_count,
        created_at: change.created_at,
        own_summary_id: None,
        title: title.to_string(),
        description: description.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::file_diff_to_change;
    use crate::sqlite_types::Change;

    fn change(filename: &str, diff: &str) -> Change {
        file_diff_to_change(
            crate::git::FileDiff {
                old_path: None,
                new_path: Some(filename.to_string()),
                diff: diff.to_string(),
                line_count: 1,
            },
            0,
            false,
        )
    }

    #[tokio::test]
    async fn group_covers_members_and_singles_fill_the_rest() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("nixmac.db");
        let pool = crate::db::init_pool_at_path(&db_path).await.unwrap();

        let a = change("a.nix", "+a");
        let b = change("b.nix", "+b");
        let c = change("c.nix", "+c");

        crate::db::summaries::store_group(
            &pool,
            &[a.hash.clone(), b.hash.clone()],
            "feat: a and b",
            "feat: a and b",
            "DONE",
            0,
        )
        .unwrap();
        crate::db::summaries::store_patch(&pool, &c.hash, "fix: c", "fix: c", "DONE", 0).unwrap();

        let found = for_changes(&pool, &[a.clone(), b.clone(), c.clone()]).unwrap();
        assert_eq!(found.map.groups.len(), 1);
        assert_eq!(found.map.groups[0].changes.len(), 2);
        assert_eq!(found.map.singles.len(), 1);
        assert_eq!(found.map.singles[0].hash, c.hash);
        assert!(found.map.unsummarized_hashes.is_empty());
    }

    #[tokio::test]
    async fn unsummarized_when_no_summary_exists() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("nixmac.db");
        let pool = crate::db::init_pool_at_path(&db_path).await.unwrap();

        let a = change("a.nix", "+a");
        let found = for_changes(&pool, std::slice::from_ref(&a)).unwrap();
        assert_eq!(found.map.unsummarized_hashes, vec![a.hash]);
        assert!(found.map.groups.is_empty());
        assert!(found.map.singles.is_empty());
    }

    #[tokio::test]
    async fn larger_group_is_preferred_over_overlapping_smaller_group() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("nixmac.db");
        let pool = crate::db::init_pool_at_path(&db_path).await.unwrap();

        let a = change("a.nix", "+a");
        let b = change("b.nix", "+b");

        crate::db::summaries::store_group(
            &pool,
            &[a.hash.clone(), b.hash.clone()],
            "big",
            "big",
            "DONE",
            0,
        )
        .unwrap();
        crate::db::summaries::store_group(
            &pool,
            std::slice::from_ref(&a.hash),
            "small",
            "small",
            "DONE",
            0,
        )
        .unwrap();

        let found = for_changes(&pool, &[a.clone(), b.clone()]).unwrap();
        assert_eq!(found.map.groups.len(), 1);
        assert_eq!(found.map.groups[0].summary.title, "big");
        assert_eq!(found.map.groups[0].changes.len(), 2);
    }
}
