//! Assignment types and reconciliation for the iterative pipeline.

use crate::shared_types::{ChangeWithSummary, SemanticChangeMap};
use crate::sqlite_types::Change;
use crate::summarize::group_existing::{find_in_group_by_hash, find_in_singles_by_hash, hash_matches};
use crate::summarize::model_output_types::{RawHunkPlacement, RawNewMapEntry};
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct PendingChange {
    pub change: Change,
    pub own_summary_id: Option<i64>,
    pub change_id: Option<i64>,
}

#[derive(Serialize)]
pub struct NewSingleAssignment {
    pub pending: PendingChange,
    pub prompt: String,
}

#[derive(Serialize)]
pub struct NewGroupAssignment {
    pub changes: Vec<PendingChange>,
    pub group_summary_id: Option<i64>,
    pub change_ids: Vec<i64>,
    pub prompt: String,
}

/// Covers both `changing_groups` and grouns from exisitng singles.
#[derive(Serialize)]
pub struct EvolvedGroupAssignment {
    pub former_group_id: Option<i64>,
    pub existing_changes: Vec<ChangeWithSummary>,
    pub new_changes: Vec<PendingChange>,
    pub group_summary_id: Option<i64>,
    /// Pre-populated with existing change ids; new ids appended during the transaction.
    pub change_ids: Vec<i64>,
    pub prompt: String,
}

#[derive(Serialize)]
pub struct Assignments {
    pub evolved: Vec<EvolvedGroupAssignment>,
    pub new_groups: Vec<NewGroupAssignment>,
    pub new_singles: Vec<NewSingleAssignment>,
}

/// Reconciles AI placement output with the full semantic map and missed changes.
pub fn reconcile(
    placements: &[RawHunkPlacement],
    semantic_map: &SemanticChangeMap,
    missed_changes: &[Change],
) -> Assignments {
    let mut evolved: Vec<EvolvedGroupAssignment> = Vec::new();
    let mut new_singles: Vec<NewSingleAssignment> = Vec::new();
    let mut deferred: Vec<(String, String)> = Vec::new();

    // Phase 1: main placement loop
    for p in placements {
        if let Some(gid) = p.group_id {
            if let Some(change) = resolve_change(&p.hash, missed_changes) {
                push_to_changing(&mut evolved, semantic_map, gid, change);
            }
        } else if let Some(ref ph) = p.pair_hash {
            if let Some(group) = find_in_group_by_hash(semantic_map, ph) {
                if let Some(change) = resolve_change(&p.hash, missed_changes) {
                    push_to_changing(&mut evolved, semantic_map, group.summary.id, change);
                }
            } else if let Some(single) = find_in_singles_by_hash(semantic_map, ph) {
                if let Some(change) = resolve_change(&p.hash, missed_changes) {
                    push_to_was_single(&mut evolved, single.clone(), change);
                }
            } else if let Some(idx) = evolved.iter().position(|a| {
                a.former_group_id.is_none()
                    && a.existing_changes.iter().any(|c| hash_matches(&c.hash, ph))
            }) {
                if let Some(change) = resolve_change(&p.hash, missed_changes) {
                    evolved[idx].new_changes.push(pending(change));
                }
            } else {
                deferred.push((p.hash.clone(), ph.clone()));
            }
        } else if let Some(change) = resolve_change(&p.hash, missed_changes) {
            new_singles.push(NewSingleAssignment {
                pending: pending(change),
                prompt: String::new(),
            });
        }
    }

    // Phase 2: reconcile deferred pairs into new_groups
    let mut new_groups = reconcile_deferred(deferred, missed_changes);

    // Cleanup 1: remove new_singles whose hash landed in a new_group
    for group in &new_groups {
        new_singles.retain(|s| {
            !group
                .changes
                .iter()
                .any(|p| hash_matches(&p.change.hash, &s.pending.change.hash))
        });
    }

    // Cleanup 2: absorb new_groups into was_single evolved assignments where hashes overlap
    new_groups.retain(|group| {
        if let Some(idx) = evolved.iter().position(|a| {
            a.former_group_id.is_none()
                && group.changes.iter().any(|p| {
                    a.new_changes
                        .iter()
                        .any(|n| hash_matches(&n.change.hash, &p.change.hash))
                })
        }) {
            for p in &group.changes {
                let already = evolved[idx]
                    .new_changes
                    .iter()
                    .any(|n| hash_matches(&n.change.hash, &p.change.hash));
                if !already {
                    evolved[idx].new_changes.push(pending(p.change.clone()));
                }
            }
            false
        } else {
            true
        }
    });

    Assignments { evolved, new_groups, new_singles }
}

/// Builds assignments for new_groups and new_singles
pub fn new(entries: &[RawNewMapEntry], changes: &[Change]) -> Assignments {
    let mut new_singles: Vec<NewSingleAssignment> = Vec::new();
    let mut new_groups: Vec<NewGroupAssignment> = Vec::new();
    let mut group_index: std::collections::HashMap<i64, usize> = std::collections::HashMap::new();

    for entry in entries {
        let Some(change) = resolve_change(&entry.hash, changes) else {
            continue;
        };

        if let Some(gid) = entry.group_id {
            if let Some(&idx) = group_index.get(&gid) {
                new_groups[idx].changes.push(pending(change));
            } else {
                let idx = new_groups.len();
                new_groups.push(NewGroupAssignment {
                    changes: vec![pending(change)],
                    group_summary_id: None,
                    change_ids: vec![],
                    prompt: String::new(),
                });
                group_index.insert(gid, idx);
            }
        } else {
            new_singles.push(NewSingleAssignment {
                pending: pending(change),
                prompt: String::new(),
            });
        }
    }

    // Unqique group id is still a single, sorry bud
    let (new_groups, solo): (Vec<_>, Vec<_>) = new_groups.into_iter().partition(|g| g.changes.len() > 1);
    new_singles.extend(solo.into_iter().map(|g| NewSingleAssignment {
        pending: g.changes.into_iter().next().unwrap(),
        prompt: String::new(),
    }));

    Assignments { evolved: vec![], new_groups, new_singles }
}

// ── Private helpers ────────────────────────────────────────────────────────────

fn reconcile_deferred(
    deferred: Vec<(String, String)>,
    changes: &[Change],
) -> Vec<NewGroupAssignment> {
    let mut new_groups: Vec<NewGroupAssignment> = Vec::new();

    for (hash, pair_hash) in &deferred {
        let gi = new_groups
            .iter()
            .position(|g| g.changes.iter().any(|p| hash_matches(&p.change.hash, hash)));
        let pi = new_groups
            .iter()
            .position(|g| g.changes.iter().any(|p| hash_matches(&p.change.hash, pair_hash)));

        match (gi, pi) {
            (Some(i), Some(j)) if i != j => {
                let other = new_groups.remove(j);
                let i = if i > j { i - 1 } else { i };
                new_groups[i].changes.extend(other.changes);
            }
            (Some(i), None) => {
                if let Some(c) = resolve_change(pair_hash, changes) {
                    new_groups[i].changes.push(pending(c));
                }
            }
            (None, Some(j)) => {
                if let Some(c) = resolve_change(hash, changes) {
                    new_groups[j].changes.push(pending(c));
                }
            }
            (None, None) => {
                let mut group_changes = Vec::new();
                if let Some(c) = resolve_change(hash, changes) {
                    group_changes.push(pending(c));
                }
                if let Some(c) = resolve_change(pair_hash, changes) {
                    group_changes.push(pending(c));
                }
                if !group_changes.is_empty() {
                    new_groups.push(NewGroupAssignment {
                        changes: group_changes,
                        group_summary_id: None,
                        change_ids: vec![],
                        prompt: String::new(),
                    });
                }
            }
            _ => {}
        }
    }

    new_groups
}

fn pending(change: Change) -> PendingChange {
    PendingChange { change, own_summary_id: None, change_id: None }
}

fn resolve_change(short_hash: &str, missed_changes: &[Change]) -> Option<Change> {
    missed_changes.iter().find(|c| hash_matches(&c.hash, short_hash)).cloned()
}

fn push_to_changing(
    evolved: &mut Vec<EvolvedGroupAssignment>,
    semantic_map: &SemanticChangeMap,
    gid: i64,
    change: Change,
) {
    if let Some(idx) = evolved.iter().position(|a| a.former_group_id == Some(gid)) {
        evolved[idx].new_changes.push(pending(change));
    } else if let Some(group) = semantic_map.groups.iter().find(|g| g.summary.id == gid) {
        evolved.push(EvolvedGroupAssignment {
            former_group_id: Some(gid),
            existing_changes: group.changes.clone(),
            new_changes: vec![pending(change)],
            group_summary_id: None,
            change_ids: group.changes.iter().map(|c| c.id).collect(),
            prompt: String::new(),
        });
    }
}

fn push_to_was_single(
    evolved: &mut Vec<EvolvedGroupAssignment>,
    single: ChangeWithSummary,
    change: Change,
) {
    if let Some(idx) = evolved
        .iter()
        .position(|a| a.former_group_id.is_none() && a.existing_changes.iter().any(|c| c.id == single.id))
    {
        evolved[idx].new_changes.push(pending(change));
    } else {
        evolved.push(EvolvedGroupAssignment {
            former_group_id: None,
            existing_changes: vec![single.clone()],
            new_changes: vec![pending(change)],
            group_summary_id: None,
            change_ids: vec![single.id],
            prompt: String::new(),
        });
    }
}
