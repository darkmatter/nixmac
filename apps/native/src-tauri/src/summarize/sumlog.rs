//! Centralized debug logging for summarize pipelines.
//!
//! Toggle each pipeline independently. All output is JSON, wrapped in a
//! box-drawing header so it is easy to spot and grep in noisy logs.
//!
//!   TURN SWITCHES ON/OFF HERE ↓

// ── Per-pipeline verbosity switches ──────────────────────────────────────────
pub const FIND_EXISTING: bool = false;
pub const GROUP_EXISTING: bool = false;
pub const SIMPLIFY_GROUP: bool = false;
pub const FRESH_CHANGESET: bool = false;
pub const EVOLVED_CHANGESET: bool = false;

// ── Imports ───────────────────────────────────────────────────────────────────

use crate::shared_types::SemanticChangeMap;
use crate::sqlite_types::Change;
use crate::summarize::assignments::Assignments;
use crate::summarize::model_output_types::{RawHunkPlacement, RawNewMapEntry};

// ── Shared primitives ─────────────────────────────────────────────────────────

/// Logs a JSON-serializable value wrapped in a labelled box-drawing header.
/// `pipeline` — e.g. `"FIND_EXISTING"`, `step` — e.g. `"result"`.
fn emit_json(pipeline: &str, step: &str, value: &(impl serde::Serialize + ?Sized)) {
    let label = format!("{} — {}", pipeline, step);
    log::warn!("╔══ {} ══╗", label);
    match serde_json::to_string_pretty(value) {
        Ok(json) => log::info!("{}", json),
        Err(e) => log::warn!("  (serialization failed: {})", e),
    }
    log::warn!("╚══ {} ══╝", label);
}

/// Logs a raw text block (prompts, etc.) wrapped in a labelled header.
fn emit_text(pipeline: &str, step: &str, text: &str) {
    let label = format!("{} — {}", pipeline, step);
    log::warn!("╔══ {} ══╗", label);
    log::info!("{}", text);
    log::warn!("╚══ {} ══╝", label);
}

// ── find_existing ─────────────────────────────────────────────────────────────

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

/// Log the result of `find_existing::for_current_state`.
/// `entries` is an iterator of `(change_set_exists, changes_len, missed_hashes_len)`.
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

// ── group_existing ────────────────────────────────────────────────────────────

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

// ── simplify_grouped ──────────────────────────────────────────────────────────

pub fn simplify_log_result(map: &(impl serde::Serialize + ?Sized)) {
    if !SIMPLIFY_GROUP {
        return;
    }
    emit_json("SIMPLIFY_GROUP", "result", map);
}

// ── new_changeset pipeline ────────────────────────────────────────────────────

pub fn new_log_changes(changes: &[Change]) {
    if !FRESH_CHANGESET {
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
    emit_json("FRESH_CHANGESET", "input changes", &value);
}

pub fn new_log_prompt(prompt: &str) {
    if !FRESH_CHANGESET {
        return;
    }
    emit_text("FRESH_CHANGESET", "map prompt", prompt);
}

pub fn new_log_map_output(entries: &[RawNewMapEntry]) {
    if !FRESH_CHANGESET {
        return;
    }
    emit_json("FRESH_CHANGESET", "map output", entries);
}

pub fn new_log_assignments(assignments: &Assignments) {
    if !FRESH_CHANGESET {
        return;
    }
    emit_json("FRESH_CHANGESET", "assignments", assignments);
}

// ── grouped_changeset pipeline ────────────────────────────────────────────────

pub fn grouped_log_semantic_map(map: &SemanticChangeMap) {
    if !EVOLVED_CHANGESET {
        return;
    }
    // Omit diffs — they are large and redundant at this stage.
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
        "EVOLVED_CHANGESET",
        "semantic map",
        &serde_json::json!({
            "groups": groups,
            "singles": singles,
            "unsummarized_hashes": map.unsummarized_hashes,
        }),
    );
}

pub fn grouped_log_missed_changes(missed: &[Change]) {
    if !EVOLVED_CHANGESET {
        return;
    }
    let value = missed
        .iter()
        .map(|c| {
            serde_json::json!({
                "hash": c.hash,
                "filename": c.filename,
                "line_count": c.line_count,
            })
        })
        .collect::<Vec<_>>();
    emit_json("EVOLVED_CHANGESET", "missed changes", &value);
}

pub fn grouped_log_placement_prompt(prompt: &str) {
    if !EVOLVED_CHANGESET {
        return;
    }
    emit_text("EVOLVED_CHANGESET", "placement prompt", prompt);
}

pub fn grouped_log_placement_output(placements: &[RawHunkPlacement]) {
    if !EVOLVED_CHANGESET {
        return;
    }
    emit_json("EVOLVED_CHANGESET", "placement output", placements);
}

pub fn grouped_log_assignments(assignments: &Assignments) {
    if !EVOLVED_CHANGESET {
        return;
    }
    emit_json("EVOLVED_CHANGESET", "assignments", assignments);
}
