// Constants, helpers and prompt builders for summarization calls.
// Change data is inserted into context and JSON template for AI to fill and return

// ── Base ───────────────────────────────────────────────────────────────────────────────────

pub const BASE_PREAMBLE: &str = include_str!("templates/base_preamble.md");
pub const BASE_CHANGES_INTRO: &str = include_str!("templates/base_changes_intro.md");
pub const BASE_TITLE_RULES: &str = include_str!("templates/base_title_rules.md");
pub const BASE_HUNK_DESCRIPTION_RULES: &str =
    include_str!("templates/base_hunk_description_rules.md");
pub const BASE_RESPONSE_INTRO: &str = include_str!("templates/base_response_intro.md");

// ── New map ───────────────────────────────────────────────────────────────────────────────

pub const NEW_MAP_PREAMBLE: &str = include_str!("templates/new_map_preamble.md");
pub const NEW_MAP_RULES: &str = include_str!("templates/new_map_rules.md");
pub const NEW_MAP_RESPONSE_INTRO: &str = include_str!("templates/new_map_response_intro.md");

// ── Placement ─────────────────────────────────────────────────────────────────────────────

pub const PLACEMENT_PREAMBLE: &str = include_str!("templates/placement_preamble.md");
pub const PLACEMENT_CHANGES_INTRO: &str = include_str!("templates/placement_changes_intro.md");
pub const PLACEMENT_RESPONSE_INTRO: &str = include_str!("templates/placement_response_intro.md");

// ── Evolve group  ─────────────────────────────────────────────────────────────────────────

pub const EVOLVE_GROUP_PREAMBLE: &str = include_str!("templates/evolve_group_preamble.md");
pub const EVOLVE_GROUP_DESCRIPTION_RULES: &str =
    include_str!("templates/evolve_group_description_rules.md");

// ── JSON builders ───────────────────────────────────────────────────────────────────────

use serde_json::{json, Value};

/// Returns a pretty-printed JSON string for a single title/description skeleton.
fn single_json_str() -> String {
    serde_json::to_string_pretty(&json!({ "title": "", "description": "" })).unwrap()
}

fn single_entry_value(hash: &str) -> Value {
    json!({ "hash": hash, "title": "", "description": "" })
}

fn placement_entry_value(hash: &str) -> Value {
    json!({ "hash": hash, "group_id": Value::Null, "pair_hash": Value::Null, "reason": "" })
}

fn new_map_entry_value(hash: &str) -> Value {
    json!({ "hash": hash, "group_id": Value::Null, "reason": "" })
}

fn changes_with_group_json(entries: Vec<Value>) -> String {
    let obj = json!({ "changes": entries, "group": { "title": "", "description": "" } });
    serde_json::to_string_pretty(&obj).unwrap()
}

fn placements_json(entries: Vec<Value>) -> String {
    let obj = json!({ "placements": entries });
    serde_json::to_string_pretty(&obj).unwrap()
}

fn changes_json(entries: Vec<Value>) -> String {
    let obj = json!({ "changes": entries });
    serde_json::to_string_pretty(&obj).unwrap()
}

// ── JSON helpers ──────────────────────────────────────────────────────────────────────────

/// Join a sequence of prompt sections into a single String.
pub fn join_sections(sections: &[String]) -> String {
    sections.join("")
}

// ── Prompt builders ───────────────────────────────────────────────────────────────────────

pub fn existing_summary(
    changes: &[crate::summarize::simplify_grouped::SimplifiedChange],
) -> String {
    changes
        .iter()
        .map(|c| format!("{} - {}\n", c.title, c.description))
        .collect::<String>()
}

pub fn list_changes(changes: &[&crate::sqlite_types::Change]) -> String {
    changes
        .iter()
        .map(|c| {
            format!(
                "hash: {}\nfile: {}\nlines: {}\ndiff:\n{}\n\n",
                c.hash, c.filename, c.line_count, c.diff
            )
        })
        .collect()
}

pub fn new_single(change: &crate::sqlite_types::Change) -> String {
    join_sections(&[
        BASE_PREAMBLE.to_string(),
        BASE_CHANGES_INTRO.to_string(),
        BASE_TITLE_RULES.to_string(),
        BASE_HUNK_DESCRIPTION_RULES.to_string(),
        list_changes(&[change]),
        BASE_RESPONSE_INTRO.to_string(),
        single_json_str(),
    ])
}

pub fn evolve_group(
    existing_changes: &[crate::summarize::simplify_grouped::SimplifiedChange],
    new_changes: &[&crate::sqlite_types::Change],
    new_hashes: &[String],
) -> String {
    let existing = existing_summary(existing_changes);
    let entries_vals = new_hashes
        .iter()
        .map(|h| single_entry_value(h))
        .collect::<Vec<_>>();
    let json_block = changes_with_group_json(entries_vals);
    join_sections(&[
        BASE_PREAMBLE.to_string(),
        EVOLVE_GROUP_PREAMBLE.to_string(),
        existing,
        "\n".to_string(),
        BASE_CHANGES_INTRO.to_string(),
        BASE_TITLE_RULES.to_string(),
        BASE_HUNK_DESCRIPTION_RULES.to_string(),
        list_changes(new_changes),
        EVOLVE_GROUP_DESCRIPTION_RULES.to_string(),
        BASE_RESPONSE_INTRO.to_string(),
        json_block,
    ])
}

pub fn new_group(hashes: &[String], resolved: &[&crate::sqlite_types::Change]) -> String {
    let entries_vals = hashes
        .iter()
        .map(|h| single_entry_value(h))
        .collect::<Vec<_>>();
    let json_block = changes_with_group_json(entries_vals);
    join_sections(&[
        BASE_PREAMBLE.to_string(),
        BASE_CHANGES_INTRO.to_string(),
        BASE_TITLE_RULES.to_string(),
        BASE_HUNK_DESCRIPTION_RULES.to_string(),
        list_changes(resolved),
        EVOLVE_GROUP_DESCRIPTION_RULES.to_string(),
        BASE_RESPONSE_INTRO.to_string(),
        json_block,
    ])
}

pub fn placement(changes: &[&crate::sqlite_types::Change], simplified_json: &str) -> String {
    let entries_vals = changes
        .iter()
        .map(|c| placement_entry_value(&c.hash))
        .collect::<Vec<_>>();
    let json_block = placements_json(entries_vals);
    join_sections(&[
        PLACEMENT_PREAMBLE.to_string(),
        simplified_json.to_string(),
        "\n".to_string(),
        PLACEMENT_CHANGES_INTRO.to_string(),
        list_changes(changes),
        PLACEMENT_RESPONSE_INTRO.to_string(),
        json_block,
    ])
}

pub fn new_map(changes: &[&crate::sqlite_types::Change]) -> String {
    let entries_vals = changes
        .iter()
        .map(|c| new_map_entry_value(&c.hash))
        .collect::<Vec<_>>();
    let json_block = changes_json(entries_vals);
    join_sections(&[
        NEW_MAP_PREAMBLE.to_string(),
        list_changes(changes),
        NEW_MAP_RULES.to_string(),
        NEW_MAP_RESPONSE_INTRO.to_string(),
        json_block,
    ])
}

pub fn commit_message(map: &crate::shared_types::SemanticChangeMap) -> String {
    let mut lines = Vec::new();

    for group in &map.groups {
        lines.push(format!(
            "{} — {}\n",
            group.summary.title, group.summary.description
        ));
    }
    for single in &map.singles {
        lines.push(format!("{} — {}\n", single.title, single.description));
    }

    lines.push("\nWrite a conventional commit message for these changes.\n".to_string());
    lines.push("Use the format: <type>(<scope>): <description> — types: feat, fix, chore, refactor, docs, style, test, perf\n".to_string());
    lines.push("Return JSON: {\"message\": \"<full commit message string>\"}\n".to_string());

    lines.join("")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared_types::{ChangeWithSummary, SemanticChangeGroup, SemanticChangeMap};
    use crate::sqlite_types::Change;
    use crate::sqlite_types::ChangeSummary;
    use crate::summarize::simplify_grouped::SimplifiedChange;
    use serde_json::Value;

    fn extract_json_block(s: &str) -> Option<Value> {
        let mut results = Vec::new();
        let bytes = s.as_bytes();
        let len = bytes.len();
        let mut i = 0usize;
        while i < len {
            if bytes[i] == b'{' {
                let mut depth = 1usize;
                let mut j = i + 1;
                while j < len {
                    match bytes[j] as char {
                        '{' => depth += 1,
                        '}' => {
                            depth -= 1;
                            if depth == 0 {
                                // extract substring i..=j
                                if let Ok(candidate) = std::str::from_utf8(&bytes[i..=j]) {
                                    if let Ok(v) = serde_json::from_str::<Value>(candidate) {
                                        results.push(v);
                                    }
                                }
                                i = j; // advance
                                break;
                            }
                        }
                        _ => {}
                    }
                    j += 1;
                }
            }
            i += 1;
        }
        results.pop()
    }

    #[test]
    fn new_single_contains_hash_and_valid_json() {
        let change = Change {
            id: 1,
            hash: "deadbeef".into(),
            filename: "foo.nix".into(),
            diff: "+x".into(),
            line_count: 1,
            created_at: 0,
            own_summary_id: None,
        };
        let out = new_single(&change);
        // tolerate formatting changes in the markdown preamble; ensure Title/Description guidance exists
        assert!(out.to_lowercase().contains("title"));
        assert!(out.contains(&change.hash));
        let json = extract_json_block(&out).expect("should find JSON");
        assert!(json.get("title").is_some());
        assert!(json.get("description").is_some());
    }

    #[test]
    fn new_group_emits_valid_changes_and_group_json() {
        let hashes = vec!["abc123".to_string()];
        let change = Change {
            id: 2,
            hash: "abc123".into(),
            filename: "bar.nix".into(),
            diff: "-y".into(),
            line_count: 2,
            created_at: 0,
            own_summary_id: None,
        };
        let resolved = vec![&change];
        let out = new_group(&hashes, &resolved);
        let json = extract_json_block(&out).expect("should find JSON");
        assert!(json.get("changes").is_some());
        assert!(json.get("group").is_some());
    }

    #[test]
    fn evolve_group_includes_existing_summary_and_json() {
        let existing = vec![SimplifiedChange {
            hash: "h1".into(),
            filename: "f".into(),
            title: "T".into(),
            description: "D".into(),
        }];
        let change = Change {
            id: 3,
            hash: "h2".into(),
            filename: "f2".into(),
            diff: "z".into(),
            line_count: 1,
            created_at: 0,
            own_summary_id: None,
        };
        let new_changes = vec![&change];
        let new_hashes = vec!["h2".to_string()];
        let out = evolve_group(&existing, &new_changes, &new_hashes);
        assert!(out.contains("T - D"));
        let json = extract_json_block(&out).expect("should find JSON");
        assert!(json.get("changes").is_some());
        assert!(json.get("group").is_some());
    }

    #[test]
    fn placement_produces_placements_array() {
        let change = Change {
            id: 4,
            hash: "p1".into(),
            filename: "x".into(),
            diff: "a".into(),
            line_count: 1,
            created_at: 0,
            own_summary_id: None,
        };
        let changes = vec![&change];
        let simplified_json = "{ \"groups\": [] }";
        let out = placement(&changes, simplified_json);
        let json = extract_json_block(&out).expect("should find JSON");
        assert!(json.get("placements").is_some());
    }

    #[test]
    fn new_map_produces_changes_array() {
        let change = Change {
            id: 5,
            hash: "m1".into(),
            filename: "y".into(),
            diff: "b".into(),
            line_count: 1,
            created_at: 0,
            own_summary_id: None,
        };
        let changes = vec![&change];
        let out = new_map(&changes);
        let json = extract_json_block(&out).expect("should find JSON");
        assert!(json.get("changes").is_some());
    }

    #[test]
    fn commit_message_includes_titles_and_instruction() {
        let summary = ChangeSummary {
            id: 1,
            title: "GTitle".into(),
            description: "GDesc".into(),
            status: "DONE".into(),
            created_at: 0,
        };
        let group = SemanticChangeGroup {
            summary: summary.clone(),
            changes: vec![],
        };
        let single = ChangeWithSummary {
            id: 2,
            hash: "s1".into(),
            filename: "z".into(),
            diff: "c".into(),
            line_count: 1,
            created_at: 0,
            own_summary_id: None,
            title: "STitle".into(),
            description: "SDesc".into(),
        };
        let map = SemanticChangeMap {
            groups: vec![group],
            singles: vec![single],
            unsummarized_hashes: vec![],
        };
        let out = commit_message(&map);
        assert!(out.contains("GTitle"));
        assert!(out.contains("STitle"));
        assert!(out.contains("Write a conventional commit message"));
    }
}
