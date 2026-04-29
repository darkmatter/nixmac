// Constants, helpers and prompt builders for summarization calls.
// Change data is inserted into context and JSON template for AI to fill and return

// ── Base ───────────────────────────────────────────────────────────────────────────────────

pub const BASE_PREAMBLE: &str =
    "Your task is to write Title - Description pairs, summarizing new nix-darwin configuration changes.\n";

pub const BASE_CHANGES_INTRO: &str =
    "Below are the new changes you will write Title - Descriptions for. Hash is the key for each. Filename, lines and diff are sources of meaning.\n";

pub const BASE_TITLE_RULES: &str =
    "Titles should be 1-3 words max. Name the subject, filename is a clue. Good examples: Git Config, SSH Keys, Editor Theme. No vague/generic verbs like update/add/remove. No adjectives like new/another.\n";

pub const BASE_HUNK_DESCRIPTION_RULES: &str =
    "Description are short phrases understandable at a glance; include actual values (config keys, package names). Diff is the main clue\n";

pub const BASE_RESPONSE_INTRO: &str =
    "Respond with valid JSON like below. Only fill in ALL empty title and description fields.\n";

// ── New map ───────────────────────────────────────────────────────────────────────────────

pub const NEW_MAP_PREAMBLE: &str =
    "Your task is to group new nix-darwin configuration changes by semantic intent, what the user is actually trying to accomplish.\n";

pub const NEW_MAP_RULES: &str =
    "Below are the changes to group. Hash is the key for each. Filename, lines and diff are sources of meaning. One goal touching many files is one group. Artifacts and auto-generated files (lock files, backups, generated paths) belong to the group of the change that caused them. Keep track of groups and assign a number id to each one. It is possible there are few changes, and that they have no group relation. Whether a change even belongs to any group or none at all is for you to decide. At the end you will provide shared group_id integers and a one-sentence reason for why the change belongs in that group, or is standalone.  \n";

pub const NEW_MAP_RESPONSE_INTRO: &str =
    "Fill in the JSON below Leave group_id null for standalone changes. Fill in short one-sentence reason for either providing a group_id or for leaving it null. Respond with ONLY valid JSON and do not edit the structure only fill in values.\n";

// ── Placement ─────────────────────────────────────────────────────────────────────────────

pub const PLACEMENT_PREAMBLE: &str =
"Your task involves two steps. First you will analyze an existing set of nix-darwin configuration changes represented in JSON. Changes in groups share a topic or user intent. Singles are standalone. Second you will analyze a new set of changes, which may or may not be related to existing groups or singles. That is for you to decide. First please understand existing groups and changes: \n";

pub const PLACEMENT_CHANGES_INTRO: &str =
"Below are the new changes you will place into context. Hash is the key for each. Filename, lines and diff are sources of meaning. Keep in mind new changes may belong to a group, or form a new group with an existing single hash. We will not however, break up existing groups.\n";

pub const PLACEMENT_RESPONSE_INTRO: &str =
"Now complete placements in the JSON below. Rules: Only fill in reason, and either group_id OR pair_hash, leave the other on null. To designate a new single fill in reason and leave other fields on null. Group_id must match an existing groups integer id, never an invented value. pair_hash must match an existing single's hash or hash of a new change on a placement - never a hash from an existing group. The same pair_hash can be used on multiple placements to expand the new group. Respond ONLY with valid JSON, only filling in fields or leaving them null.\n";

// ── Evolve group  ─────────────────────────────────────────────────────────────────────────

pub const EVOLVE_GROUP_PREAMBLE: &str =
    "The changes belong in a group. Existing group-member changes already have Title - Descriptions. Read those first for context:\n";

pub const EVOLVE_GROUP_DESCRIPTION_RULES: &str =
    "Group title and description at the end should be equally short, but ideally cover both new changes added by you and existing ones specified at the top.\n";

// ── JSON templates ────────────────────────────────────────────────────────────────────────

pub const SINGLE_JSON: &str = r#"{ "title": "", "description": "" }"#;

const SINGLE_JSON_HASH: &str =
    r#"    { "hash": "{}", "title": "", "description": "" }"#;

const GROUP_JSON: &str =
    r#"  "group": { "title": "", "description": "" }"#;

const PLACEMENT_JSON_HASH: &str =
    r#"    { "hash": "{}", "group_id": null, "pair_hash": null, "reason": "" }"#;

const NEW_MAP_JSON_HASH: &str =
    r#"    { "hash": "{}", "group_id": null, "reason": "" }"#;

// ── JSON helpers ──────────────────────────────────────────────────────────────────────────

/// Wraps `content` as a named JSON array key: `"<title>": [\n<content>\n  ]`
pub fn group_title(title: &str, content: &str) -> String {
    format!("  \"{}\": [\n{}\n  ]", title, content)
}

/// Wraps `content` in a top-level JSON object.
pub fn groups_wrapper(content: &str) -> String {
    format!("{{\n{}\n}}", content)
}

// ── Prompt builders ───────────────────────────────────────────────────────────────────────

pub fn existing_summary(changes: &[crate::summarize::simplify_grouped::SimplifiedChange]) -> String {
    changes
        .iter()
        .map(|c| format!("{} - {}\n", c.title, c.description))
        .collect::<String>()
}

pub fn list_changes(changes: &[&crate::sqlite_types::Change]) -> String {
    changes
        .iter()
        .map(|c| format!(
            "hash: {}\nfile: {}\nlines: {}\ndiff:\n{}\n\n",
            c.hash, c.filename, c.line_count, c.diff
        ))
        .collect()
}

pub fn new_single(change: &crate::sqlite_types::Change) -> String {
    let mut prompt = String::new();
    prompt.push_str(BASE_PREAMBLE);
    prompt.push_str(BASE_CHANGES_INTRO);
    prompt.push_str(BASE_TITLE_RULES);
    prompt.push_str(BASE_HUNK_DESCRIPTION_RULES);
    prompt.push_str(&list_changes(&[change]));
    prompt.push_str(BASE_RESPONSE_INTRO);
    prompt.push_str(SINGLE_JSON);
    prompt
}

pub fn evolve_group(
    existing_changes: &[crate::summarize::simplify_grouped::SimplifiedChange],
    new_changes: &[&crate::sqlite_types::Change],
    new_hashes: &[String],
) -> String {
    let mut prompt = String::new();
    prompt.push_str(BASE_PREAMBLE);
    prompt.push_str(EVOLVE_GROUP_PREAMBLE);
    prompt.push_str(&existing_summary(existing_changes));
    prompt.push('\n');
    prompt.push_str(BASE_CHANGES_INTRO);
    prompt.push_str(BASE_TITLE_RULES);
    prompt.push_str(BASE_HUNK_DESCRIPTION_RULES);
    prompt.push_str(&list_changes(new_changes));
    prompt.push_str(EVOLVE_GROUP_DESCRIPTION_RULES);
    prompt.push_str(BASE_RESPONSE_INTRO);
    let entries = new_hashes
        .iter()
        .map(|h| SINGLE_JSON_HASH.replace("{}", h))
        .collect::<Vec<_>>()
        .join(",\n");
    prompt.push_str(&groups_wrapper(&format!(
        "{},\n{}",
        group_title("changes", &entries),
        GROUP_JSON
    )));
    prompt
}

pub fn new_group(
    hashes: &[String],
    resolved: &[&crate::sqlite_types::Change],
) -> String {
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
        .map(|h| SINGLE_JSON_HASH.replace("{}", h))
        .collect::<Vec<_>>()
        .join(",\n");
    prompt.push_str(&groups_wrapper(&format!(
        "{},\n{}",
        group_title("changes", &entries),
        GROUP_JSON
    )));
    prompt
}

pub fn placement(changes: &[&crate::sqlite_types::Change], simplified_json: &str) -> String {
    let entries = changes
        .iter()
        .map(|c| PLACEMENT_JSON_HASH.replace("{}", &c.hash))
        .collect::<Vec<_>>()
        .join(",\n");
    let mut prompt = String::new();
    prompt.push_str(PLACEMENT_PREAMBLE);
    prompt.push_str(simplified_json);
    prompt.push('\n');
    prompt.push_str(PLACEMENT_CHANGES_INTRO);
    prompt.push_str(&list_changes(changes));
    prompt.push_str(PLACEMENT_RESPONSE_INTRO);
    prompt.push_str(&groups_wrapper(&group_title("placements", &entries)));
    prompt
}

pub fn new_map(changes: &[&crate::sqlite_types::Change]) -> String {
    let entries = changes
        .iter()
        .map(|c| NEW_MAP_JSON_HASH.replace("{}", &c.hash))
        .collect::<Vec<_>>()
        .join(",\n");
    let mut prompt = String::new();
    prompt.push_str(NEW_MAP_PREAMBLE);
    prompt.push_str(&list_changes(changes));
    prompt.push_str(NEW_MAP_RULES);
    prompt.push_str(NEW_MAP_RESPONSE_INTRO);
    prompt.push_str(&groups_wrapper(&group_title("changes", &entries)));
    prompt
}

pub fn commit_message(map: &crate::shared_types::SemanticChangeMap) -> String {
    let mut prompt = String::new();

    for group in &map.groups {
        prompt.push_str(&format!("{} — {}\n", group.summary.title, group.summary.description));
    }
    for single in &map.singles {
        prompt.push_str(&format!("{} — {}\n", single.title, single.description));
    }

    prompt.push('\n');
    prompt.push_str("Write a conventional commit message for these changes.\n");
    prompt.push_str("Use the format: <type>(<scope>): <description> — types: feat, fix, chore, refactor, docs, style, test, perf\n");
    prompt.push_str("Return JSON: {\"message\": \"<full commit message string>\"}\n");
    prompt
}

pub fn commit_message_from_raw_changes(changes: &[&crate::sqlite_types::Change]) -> String {
    let mut prompt = String::new();
    prompt.push_str("Current uncommitted nix-darwin configuration changes:\n");
    prompt.push_str(&list_changes(changes));
    prompt.push('\n');
    prompt.push_str("Write a conventional commit message for these changes.\n");
    prompt.push_str("Use the format: <type>(<scope>): <description> — types: feat, fix, chore, refactor, docs, style, test, perf\n");
    prompt.push_str("Return JSON: {\"message\": \"<full commit message string>\"}\n");
    prompt
}
