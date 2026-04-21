//! Orchestrates grouping of summarized changes into a SemanticChangeMap.

use std::collections::HashMap;

use crate::summarize::find_existing::FoundSetForCurrent;
use crate::summarize::sumlog as dbg;
use crate::shared_types::{
    ChangeWithSummary, SemanticChangeGroup, SemanticChangeMap,
};
use crate::sqlite_types::ChangeSummary;

pub fn from_change_sets(change_sets: Vec<FoundSetForCurrent>) -> SemanticChangeMap {
    let mut groups: HashMap<i64, (ChangeSummary, Vec<ChangeWithSummary>)> = HashMap::new();
    let mut singles: Vec<ChangeWithSummary> = vec![];
    let mut unsummarized_hashes: Vec<String> = vec![];
    // true = placed in a group, false = placed in singles
    let mut seen: HashMap<i64, bool> = HashMap::new();

    for cs in change_sets {
        unsummarized_hashes.extend(cs.missed_hashes);
        for sc in cs.changes {
            let change_id = sc.change.id;
            if sc.own_summary.is_none() {
                if let std::collections::hash_map::Entry::Vacant(e) = seen.entry(change_id) {
                    unsummarized_hashes.push(sc.change.hash.clone());
                    e.insert(false);
                }
                continue;
            }
            match seen.get(&change_id).copied() {
                Some(true) => continue, // already in a group, nothing better to do
                Some(false) => {
                    // check for valid group before deduping change currently single
                    if let Some(gs) = sc.group_summary {
                        singles.retain(|c| c.id != change_id);
                        let cws = to_change_with_summary(&sc.change, sc.own_summary.as_ref());
                        groups.entry(gs.id).or_insert_with(|| (gs, vec![])).1.push(cws);
                        seen.insert(change_id, true);
                    }
                }
                None => {
                    let cws = to_change_with_summary(&sc.change, sc.own_summary.as_ref());
                    match sc.group_summary {
                        Some(gs) => {
                            groups.entry(gs.id).or_insert_with(|| (gs, vec![])).1.push(cws);
                            seen.insert(change_id, true);
                        }
                        None => {
                            singles.push(cws);
                            seen.insert(change_id, false);
                        }
                    }
                }
            }
        }
    }

    let map = SemanticChangeMap {
        groups: groups
            .into_values()
            .map(|(summary, changes)| SemanticChangeGroup { summary, changes })
            .collect(),
        singles,
        unsummarized_hashes,
    };
    dbg::group_log_result(&map);
    map
}

// ── Lookup helpers ─────────────────────────────────────────────────────────────

pub fn hash_matches(stored: &str, query: &str) -> bool {
    if query.len() < stored.len() {
        stored.starts_with(query)
    } else {
        stored == query
    }
}

#[allow(dead_code)]
pub fn find_group_by_id(map: &SemanticChangeMap, id: i64) -> Option<&SemanticChangeGroup> {
    map.groups.iter().find(|g| g.summary.id == id)
}

#[allow(dead_code)]
pub fn find_in_group_by_hash<'a>(map: &'a SemanticChangeMap, hash: &str) -> Option<&'a SemanticChangeGroup> {
    map.groups.iter().find(|g| g.changes.iter().any(|c| hash_matches(&c.hash, hash)))
}

#[allow(dead_code)]
pub fn find_in_singles_by_hash<'a>(map: &'a SemanticChangeMap, hash: &str) -> Option<&'a ChangeWithSummary> {
    map.singles.iter().find(|c| hash_matches(&c.hash, hash))
}

fn to_change_with_summary(
    change: &crate::sqlite_types::Change,
    own_summary: Option<&ChangeSummary>,
) -> ChangeWithSummary {
    let (title, description) = own_summary
        .map(|s| (s.title.clone(), s.description.clone()))
        .unwrap_or_default();
    ChangeWithSummary {
        id: change.id,
        hash: change.hash.clone(),
        filename: change.filename.clone(),
        diff: change.diff.clone(),
        line_count: change.line_count,
        created_at: change.created_at,
        own_summary_id: change.own_summary_id,
        title,
        description,
    }
}
