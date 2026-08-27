//! Whole-diff pipeline — one model call on the full diff, producing one or
//! more semantic group descriptions (each covering a subset of the individual
//! changes).

use std::collections::HashMap;

use anyhow::Result;
use diesel::Connection;
use tauri::{AppHandle, Manager, Runtime};

use crate::db::DbPool;
use crate::sqlite_types::Change;
use crate::summarize::model_calls::ChangesetSummaryItem;
use crate::summarize::{build_prompt, sumlog as dbg};

/// A summary and the hashes of the live changes it covers.
struct SummaryAssignment {
    summary: String,
    hashes: Vec<String>,
}

const WHOLE_DIFF_SYSTEM_PROMPT: &str = r#"
You are a git change reviewer.

Rules:
- Group the provided changes into one or more semantic changes.
- Each group must share a coherent purpose (a single logical change).
- Give each group a concise, factual, plain-language summary.
- Base every summary only on the provided changes.
- Do not invent intent that is not visible in the diff.
- Do not assign a conventional-commit type, scope, or prefix.
- Every supplied change hash must appear in exactly one group.
- Prefer fewer groups; only split when changes are clearly unrelated.
- Always return valid JSON in this format:

{"groups":[{"summary":"<plain-language description>","changes":["<hash>", ...]}, ...]}
"#;

/// Run the whole-diff model call for `changes`, persist the resulting group /
/// single summaries plus a cached snapshot, and return the snapshot id.
pub async fn analyze<R: Runtime>(
    changes: Vec<Change>,
    app: &AppHandle<R>,
    base_ref: Option<&str>,
    evolution_id: Option<i64>,
) -> Result<Option<i64>> {
    dbg::new_log_changes(&changes);

    if changes.is_empty() {
        return Ok(None);
    }

    let pool = app.state::<DbPool>();

    let refs: Vec<&Change> = changes.iter().collect();
    let user_prompt = build_prompt::whole_diff(&refs);
    dbg::new_log_prompt(&user_prompt);

    let (mut items, _usage) = crate::summarize::model_calls::generate_changeset_summaries(
        WHOLE_DIFF_SYSTEM_PROMPT,
        &user_prompt,
        Some(app),
    )
    .await?;

    // Keep the full-diff call focused on semantic grouping. Conventional type
    // selection happens only after it returns, using each short summary rather
    // than the entire diff that prompted the model's analysis.
    for item in &mut items {
        item.summary = conventionalize_summary(&item.summary);
    }

    // The model may not reference every change. Build a single display string
    // from all returned summaries so the snapshot's `generated_commit_message`
    // (consumed by the commit-message pipeline) reflects the full changeset even
    // when the model split it into several groups.
    let generated_message = items
        .iter()
        .map(|item| item.summary.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    let assignments = assign_summaries(&changes, &items);
    let now = crate::utils::unix_now();

    // Persist all assignments and the cached snapshot in one transaction so a
    // mid-loop failure leaves no partial rows committed (all-or-nothing).
    let mut conn = pool.get()?;
    let snapshot_id = conn.transaction::<_, anyhow::Error, _>(|conn| {
        // Persist each assignment: multi-member sets become first-class groups,
        // single-member sets become per-change (patch) summaries.
        for assignment in &assignments {
            let description = assignment.summary.trim();
            let title = description.lines().next().unwrap_or(description).trim();
            if assignment.hashes.len() >= 2 {
                crate::db::summaries::store_group_tx(
                    conn,
                    &assignment.hashes,
                    title,
                    description,
                    "DONE",
                    now,
                )?;
            } else if let Some(hash) = assignment.hashes.first() {
                crate::db::summaries::store_patch_tx(conn, hash, title, description, "DONE", now)?;
            }
        }

        // Cache the generated commit message for this exact set of change hashes.
        let hashes: Vec<String> = changes.iter().map(|c| c.hash.clone()).collect();
        crate::db::snapshots::upsert_tx(
            conn,
            &crate::db::keys::snapshot_key(&hashes),
            Some(&generated_message),
            evolution_id,
            now,
        )
    })?;

    emit_update(app, &pool, base_ref)?;

    Ok(Some(snapshot_id))
}

const CONVENTIONAL_TYPES: [&str; 8] = [
    "feat", "fix", "chore", "refactor", "docs", "style", "test", "perf",
];

/// Adds a conventional-commit type using only the model's already-generated
/// summary. This deliberately does not inspect the diff: the model has already
/// done the semantic work and this final pass should remain cheap and stable.
fn conventionalize_summary(summary: &str) -> String {
    let description = strip_conventional_prefix(summary);
    let description = description.trim().trim_end_matches('.').trim();
    let description = if description.is_empty() {
        summary.trim()
    } else {
        description
    };

    format!(
        "{}: {}",
        conventional_type_for_summary(description),
        description
    )
}

fn strip_conventional_prefix(summary: &str) -> &str {
    let trimmed = summary.trim();
    let Some((prefix, description)) = trimmed.split_once(':') else {
        return trimmed;
    };
    let prefix = prefix.trim();
    let is_conventional_type = CONVENTIONAL_TYPES.iter().any(|kind| {
        prefix == *kind
            || prefix
                .strip_prefix(kind)
                .is_some_and(|scope| scope.starts_with('(') && scope.ends_with(')'))
    });

    if is_conventional_type {
        description.trim()
    } else {
        trimmed
    }
}

fn conventional_type_for_summary(summary: &str) -> &'static str {
    let summary = summary.to_ascii_lowercase();
    // Match whole words only: substring matching mislabels ("fix" inside
    // "fixture", "test" inside "latest"). A keyword matches its exact word
    // or a common inflection of it; morphological stems anchor at word
    // start so they cannot hit unrelated words.
    let words: Vec<&str> = summary
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    let has_word = |keywords: &[&str]| {
        words.iter().any(|word| {
            keywords.iter().any(|keyword| {
                *word == *keyword
                    || *word == format!("{keyword}s")
                    || *word == format!("{keyword}es")
                    || *word == format!("{keyword}ed")
                    || *word == format!("{keyword}ing")
            })
        })
    };
    let has_stem = |stems: &[&str]| {
        words
            .iter()
            .any(|word| stems.iter().any(|stem| word.starts_with(stem)))
    };

    if has_word(&[
        "fix", "repair", "resolve", "correct", "prevent", "restore", "patch",
    ]) || has_stem(&["compatib"])
    {
        "fix"
    } else if has_word(&["performance", "faster"])
        || has_stem(&["optimiz"])
        || summary.contains("speed up")
    {
        "perf"
    } else if has_word(&["test", "coverage", "fixture", "assertion"]) {
        "test"
    } else if has_word(&["document", "documentation", "readme", "guide"]) {
        "docs"
    } else if has_stem(&["refactor", "restructur", "reorganiz", "simplif"])
        || has_word(&["extract"])
    {
        "refactor"
    } else if has_word(&["format", "styling", "style"]) {
        "style"
    } else if has_word(&[
        "add",
        "enable",
        "support",
        "introduce",
        "implement",
        "create",
        "allow",
    ]) {
        "feat"
    } else {
        "chore"
    }
}

/// Assigns each live change hash to the model summary that covers it, grouping
/// hashes by summary text.
///
/// Hashes identify individual hunks, so independent changes in one file can
/// receive distinct summaries. Any change the model did not assign is folded
/// into the first summary's bucket, so no change is left unsummarized (which
/// would otherwise trigger re-summarization loops in `find_existing`). Buckets
/// that share summary text are merged, matching the content-addressed group
/// identity used when reading summaries back.
fn assign_summaries(changes: &[Change], items: &[ChangesetSummaryItem]) -> Vec<SummaryAssignment> {
    let mut hash_to_item: HashMap<&str, usize> = HashMap::new();
    for (i, item) in items.iter().enumerate() {
        for hash in &item.changes {
            // Keep the first assignment if a model repeats a hash. One hunk
            // must have only one semantic owner.
            hash_to_item.entry(hash.as_str()).or_insert(i);
        }
    }

    let fallback_summary = items
        .first()
        .map(|i| i.summary.clone())
        .unwrap_or_else(|| "chore: summarize changes".to_string());

    // Preserve first-seen order of summaries while merging by text.
    let mut order: Vec<String> = Vec::new();
    let mut by_summary: HashMap<String, Vec<String>> = HashMap::new();

    for change in changes {
        let summary = match hash_to_item.get(change.hash.as_str()) {
            Some(&i) => items[i].summary.clone(),
            None => fallback_summary.clone(),
        };
        let bucket = by_summary.entry(summary.clone()).or_insert_with(|| {
            order.push(summary.clone());
            Vec::new()
        });
        bucket.push(change.hash.clone());
    }

    order
        .into_iter()
        .map(|summary| {
            let hashes = by_summary.remove(&summary).unwrap_or_default();
            SummaryAssignment { summary, hashes }
        })
        .collect()
}

fn emit_update<R: Runtime>(
    app: &AppHandle<R>,
    pool: &DbPool,
    base_ref: Option<&str>,
) -> Result<()> {
    let semantic_map = if let Some(base_ref) = base_ref {
        crate::summarize::change_map_since(app, base_ref)?
    } else {
        let config_dir = crate::storage::store::get_config_dir(app)?;
        crate::summarize::find_existing::for_current_state(pool, &config_dir)?
    };
    // The cell write emits `change_map_changed`.
    crate::state::change_map::update(app, semantic_map);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change(filename: &str) -> Change {
        Change {
            id: 0,
            hash: format!("h-{filename}"),
            filename: filename.to_string(),
            diff: "+x".into(),
            line_count: 1,
            created_at: 0,
            own_summary_id: None,
        }
    }

    fn find<'a>(assignments: &'a [SummaryAssignment], summary: &str) -> &'a SummaryAssignment {
        assignments
            .iter()
            .find(|a| a.summary == summary)
            .expect("assignment for summary")
    }

    #[test]
    fn matched_changes_are_grouped_by_summary() {
        let changes = vec![change("a.nix"), change("b.nix"), change("c.nix")];
        let items = vec![
            ChangesetSummaryItem {
                summary: "feat: a and b".into(),
                changes: vec!["h-a.nix".into(), "h-b.nix".into()],
            },
            ChangesetSummaryItem {
                summary: "fix: c".into(),
                changes: vec!["h-c.nix".into()],
            },
        ];
        let assignments = assign_summaries(&changes, &items);
        assert_eq!(assignments.len(), 2);
        assert_eq!(find(&assignments, "feat: a and b").hashes.len(), 2);
        assert_eq!(find(&assignments, "fix: c").hashes, vec!["h-c.nix"]);
    }

    #[test]
    fn same_file_changes_can_belong_to_distinct_semantic_groups() {
        let mut first = change("configuration.nix");
        first.hash = "first-change".into();
        let mut second = change("configuration.nix");
        second.hash = "second-change".into();
        let items = vec![
            ChangesetSummaryItem {
                summary: "feat: add a service".into(),
                changes: vec!["first-change".into()],
            },
            ChangesetSummaryItem {
                summary: "fix: update a package".into(),
                changes: vec!["second-change".into()],
            },
        ];

        let assignments = assign_summaries(&[first, second], &items);

        assert_eq!(assignments.len(), 2);
        assert_eq!(
            find(&assignments, "feat: add a service").hashes,
            vec!["first-change"]
        );
        assert_eq!(
            find(&assignments, "fix: update a package").hashes,
            vec!["second-change"]
        );
    }

    #[test]
    fn unmatched_changes_fall_back_to_first_summary() {
        let changes = vec![change("a.nix"), change("orphan.nix")];
        let items = vec![ChangesetSummaryItem {
            summary: "feat: a".into(),
            changes: vec!["h-a.nix".into()],
        }];
        let assignments = assign_summaries(&changes, &items);
        // Orphan is folded into the first summary's bucket so it isn't unsummarized.
        assert_eq!(assignments.len(), 1);
        let bucket = find(&assignments, "feat: a");
        assert!(bucket.hashes.contains(&"h-a.nix".to_string()));
        assert!(bucket.hashes.contains(&"h-orphan.nix".to_string()));
    }

    #[test]
    fn complete_change_hashes_match_nested_paths() {
        let changes = vec![change("modules/darwin/dock.nix")];
        let items = vec![ChangesetSummaryItem {
            summary: "feat: dock".into(),
            changes: vec!["h-modules/darwin/dock.nix".into()],
        }];
        let assignments = assign_summaries(&changes, &items);
        assert_eq!(assignments.len(), 1);
        assert_eq!(find(&assignments, "feat: dock").hashes.len(), 1);
    }

    #[test]
    fn conventional_type_is_determined_from_the_completed_summary() {
        assert_eq!(
            conventionalize_summary("Apply daemon_pool compatibility patch."),
            "fix: Apply daemon_pool compatibility patch"
        );
        assert_eq!(
            conventionalize_summary("Enable Prelude theme support"),
            "feat: Enable Prelude theme support"
        );
        assert_eq!(
            conventionalize_summary("refactor(helix): reorganize config declarations"),
            "refactor: reorganize config declarations"
        );
    }

    #[test]
    fn conventional_type_matches_words_not_substrings() {
        // Substring matching mislabeled these: "fix" inside "fixture",
        // "test" inside "latest".
        assert_eq!(conventional_type_for_summary("Add test fixture"), "test");
        assert_eq!(
            conventional_type_for_summary("update to the latest revision"),
            "chore"
        );
    }

    #[test]
    fn conventional_type_accepts_common_inflections_and_stems() {
        assert_eq!(conventional_type_for_summary("fixes the loader"), "fix");
        assert_eq!(
            conventional_type_for_summary("testing the pipeline"),
            "test"
        );
        assert_eq!(
            conventional_type_for_summary("compatibility with sonoma"),
            "fix"
        );
        assert_eq!(conventional_type_for_summary("optimizes rebuilds"), "perf");
        assert_eq!(conventional_type_for_summary("speed up builds"), "perf");
        assert_eq!(
            conventional_type_for_summary("simplify the module"),
            "refactor"
        );
        assert_eq!(conventional_type_for_summary("adds a service"), "feat");
        assert_eq!(conventional_type_for_summary("tweak the prompt"), "chore");
    }

    #[test]
    fn whole_diff_system_prompt_requests_only_free_form_descriptions() {
        assert!(WHOLE_DIFF_SYSTEM_PROMPT.contains("plain-language summary"));
        assert!(!WHOLE_DIFF_SYSTEM_PROMPT.contains("conventional commit messages"));
        assert!(!WHOLE_DIFF_SYSTEM_PROMPT.contains("prefer \"chore\""));
    }
}
