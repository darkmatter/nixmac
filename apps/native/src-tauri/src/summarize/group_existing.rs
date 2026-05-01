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
            if sc.own_summary.as_ref().map_or(true, is_invalid) {
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
                        if !is_invalid(&gs) {
                            singles.retain(|c| c.id != change_id);
                            let cws = to_change_with_summary(&sc.change, sc.own_summary.as_ref());
                            groups.entry(gs.id).or_insert_with(|| (gs, vec![])).1.push(cws);
                            seen.insert(change_id, true);
                        }
                    }
                }
                None => {
                    let cws = to_change_with_summary(&sc.change, sc.own_summary.as_ref());
                    match sc.group_summary {
                        Some(gs) if !is_invalid(&gs) => {
                            groups.entry(gs.id).or_insert_with(|| (gs, vec![])).1.push(cws);
                            seen.insert(change_id, true);
                        }
                        _ => {
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

fn is_invalid(summary: &ChangeSummary) -> bool {
    matches!(summary.status.as_str(), "FAILED" | "CANCELLED")
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared_types::SummarizedChange;
    use crate::sqlite_types::{Change, ChangeSummary};
    use crate::summarize::find_existing::FoundSetForCurrent;

    fn make_change(hash: &str) -> Change {
        Change {
            id: 1,
            hash: hash.to_string(),
            filename: "file.nix".to_string(),
            diff: "diff".to_string(),
            line_count: 1,
            created_at: 0,
            own_summary_id: Some(1),
        }
    }

    fn make_summary(status: &str) -> ChangeSummary {
        ChangeSummary { id: 1, title: "t".to_string(), description: "d".to_string(), status: status.to_string(), created_at: 0 }
    }

    fn found(change: Change, own_summary: Option<ChangeSummary>) -> FoundSetForCurrent {
        found_grouped(change, own_summary, None)
    }

    fn found_grouped(change: Change, own_summary: Option<ChangeSummary>, group_summary: Option<ChangeSummary>) -> FoundSetForCurrent {
        FoundSetForCurrent {
            change_set: None,
            changes: vec![SummarizedChange { change, own_summary, group_summary }],
            missed_hashes: vec![],
        }
    }

    #[test]
    fn failed_own_summary_is_treated_as_unsummarized() {
        let change = make_change("abc123");
        let map = from_change_sets(vec![found(change, Some(make_summary("FAILED")))]);
        assert_eq!(map.unsummarized_hashes, vec!["abc123"]);
        assert!(map.singles.is_empty());
    }

    #[test]
    fn failed_group_summary_falls_through_to_singles() {
        let change = make_change("ghi789");
        let own = make_summary("DONE");
        let group = make_summary("FAILED");
        let map = from_change_sets(vec![found_grouped(change, Some(own), Some(group))]);
        assert!(map.unsummarized_hashes.is_empty());
        assert!(map.groups.is_empty());
        assert_eq!(map.singles.len(), 1);
        assert_eq!(map.singles[0].hash, "ghi789");
    }

    #[test]
    fn queued_own_summary_is_not_treated_as_unsummarized() {
        let change = make_change("def456");
        let map = from_change_sets(vec![found(change, Some(make_summary("QUEUED")))]);
        assert!(map.unsummarized_hashes.is_empty());
        assert_eq!(map.singles.len(), 1);
        assert_eq!(map.singles[0].hash, "def456");
    }
}
