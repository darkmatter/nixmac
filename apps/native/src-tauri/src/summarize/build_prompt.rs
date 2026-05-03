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

const SINGLE_JSON_HASH: &str = r#"    { "hash": "{}", "title": "", "description": "" }"#;

const GROUP_JSON: &str = r#"  "group": { "title": "", "description": "" }"#;

fn placement_entry_value(hash: &str) -> Value {
    json!({ "hash": hash, "group_id": Value::Null, "pair_hash": Value::Null, "reason": "" })
}

const NEW_MAP_JSON_HASH: &str = r#"    { "hash": "{}", "group_id": null, "reason": "" }"#;

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
    let mut prompt = String::new();
    prompt.push_str(BASE_PREAMBLE);
    prompt.push_str(BASE_CHANGES_INTRO);
    prompt.push_str(BASE_TITLE_RULES);
    prompt.push_str(BASE_HUNK_DESCRIPTION_RULES);
    prompt.push_str(&list_changes(resolved));
    prompt.push_str(EVOLVE_GROUP_DESCRIPTION_RULES);
    prompt.push_str(BASE_RESPONSE_INTRO);
    let entries = hashes
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
        prompt.push_str(&format!(
            "{} — {}\n",
            group.summary.title, group.summary.description
        ));
    }
    for single in &map.singles {
        lines.push(format!("{} — {}\n", single.title, single.description));
    }

    prompt.push('\n');
    prompt.push_str("Write a conventional commit message for these changes.\n");
    prompt.push_str("Use the format: <type>(<scope>): <description> — types: feat, fix, chore, refactor, docs, style, test, perf\n");
    prompt.push_str("Return JSON: {\"message\": \"<full commit message string>\"}\n");
    prompt
}
