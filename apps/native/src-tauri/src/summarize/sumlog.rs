//! Centralized debug logging for summarize pipelines.

pub const FIND_EXISTING: bool = false;
pub const GROUP_EXISTING: bool = false;
pub const WHOLE_DIFF: bool = false;

use crate::shared_types::SemanticChangeMap;
use crate::sqlite_types::Change;

fn emit_json(pipeline: &str, step: &str, value: &(impl serde::Serialize + ?Sized)) {
    let label = format!("{} — {}", pipeline, step);
    log::warn!("╔══ {} ══╗", label);
    match serde_json::to_string_pretty(value) {
        Ok(json) => log::info!("{}", json),
        Err(e) => log::warn!("  (serialization failed: {})", e),
    }
    log::warn!("╚══ {} ══╝", label);
}

fn emit_text(pipeline: &str, step: &str, text: &str) {
    let label = format!("{} — {}", pipeline, step);
    log::warn!("╔══ {} ══╗", label);
    log::info!("{}", text);
    log::warn!("╚══ {} ══╝", label);
}

pub struct FindPath<'a> {
    pub head_hash: &'a str,
    pub commit_id: i64,
    pub hashes: &'a [String],
}

pub fn find_log_path(path: &FindPath) {
    if !FIND_EXISTING {
        return;
    }
    emit_json(
        "FIND_EXISTING",
        "path",
        &serde_json::json!({
            "head_hash": path.head_hash,
            "commit_id": path.commit_id,
            "hashes": path.hashes,
        }),
    );
}

pub fn find_log_result(entries: impl Iterator<Item = (bool, usize, usize)> + Clone) {
    if !FIND_EXISTING {
        return;
    }
    let rows: Vec<_> = entries
        .clone()
        .map(|(has_cs, changes, missed)| {
            serde_json::json!({
                "has_change_set": has_cs,
                "changes": changes,
                "missed_hashes": missed,
            })
        })
        .collect();
    emit_json(
        "FIND_EXISTING",
        "result",
        &serde_json::json!({ "count": rows.len(), "entries": rows }),
    );
}

pub fn group_log_result(map: &SemanticChangeMap) {
    if !GROUP_EXISTING {
        return;
    }
    let groups = map
        .groups
        .iter()
        .map(|g| {
            serde_json::json!({
                "id": g.summary.id,
                "title": g.summary.title,
                "description": g.summary.description,
                "changes": g.changes.iter().map(|c| serde_json::json!({
                    "hash": &c.hash[..8.min(c.hash.len())],
                    "filename": c.filename,
                    "title": c.title,
                })).collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();
    let singles = map
        .singles
        .iter()
        .map(|c| {
            serde_json::json!({
                "hash": &c.hash[..8.min(c.hash.len())],
                "filename": c.filename,
                "title": c.title,
            })
        })
        .collect::<Vec<_>>();
    emit_json(
        "GROUP_EXISTING",
        "result",
        &serde_json::json!({
            "groups": groups,
            "singles": singles,
            "unsummarized_hashes": map.unsummarized_hashes,
        }),
    );
}

pub fn new_log_changes(changes: &[Change]) {
    if !WHOLE_DIFF {
        return;
    }
    let value = changes
        .iter()
        .map(|c| {
            serde_json::json!({
                "hash": &c.hash[..8.min(c.hash.len())],
                "filename": c.filename,
                "line_count": c.line_count,
            })
        })
        .collect::<Vec<_>>();
    emit_json("WHOLE_DIFF", "input changes", &value);
}

pub fn new_log_prompt(prompt: &str) {
    if !WHOLE_DIFF {
        return;
    }
    emit_text("WHOLE_DIFF", "prompt", prompt);
}
