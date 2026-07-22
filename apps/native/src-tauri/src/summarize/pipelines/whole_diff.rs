//! Whole-diff pipeline — one model call on the full diff, producing one or
//! more group summaries (each covering a subset of the changed files).

use std::collections::HashMap;

use anyhow::Result;
use tauri::{AppHandle, Manager, Runtime};

use crate::db::DbPool;
use crate::sqlite_types::Change;
use crate::summarize::model_calls::ChangesetSummaryItem;
use crate::summarize::{build_prompt, sumlog as dbg};

const WHOLE_DIFF_SYSTEM_PROMPT: &str = r#"
You are a git commit message generator.

Rules:
- Group the provided changes into one or more conventional commit messages.
- Each group must share a coherent purpose (a single logical change).
- Base every summary only on the provided changes.
- Do not invent intent that is not visible in the diff.
- If the type is unclear, prefer "chore".
- Every changed file must appear in exactly one group.
- Prefer fewer groups; only split when changes are clearly unrelated.
- Always return valid JSON in this format:

[{"summary":"<commit message>","files":["<path>", ...]}, ...]
"#;

#[allow(clippy::too_many_arguments)]
pub async fn analyze<R: Runtime>(
    changes: Vec<Change>,
    app: &AppHandle<R>,
    commit_id: Option<i64>,
    base_commit_id: Option<i64>,
    base_ref: Option<&str>,
    commit_message: Option<&str>,
    evolution_id: Option<i64>,
) -> Result<Option<i64>> {
    dbg::new_log_changes(&changes);

    if changes.is_empty() {
        return Ok(None);
    }

    let config_dir = crate::storage::store::get_config_dir(app)?;
    let pool = app.state::<DbPool>();
    let Some(base_commit_id) =
        crate::db::commits::store_head_commit(&pool, &config_dir, base_commit_id)?
    else {
        return Ok(None);
    };

    let refs: Vec<&Change> = changes.iter().collect();
    let user_prompt = build_prompt::whole_diff(&refs);
    dbg::new_log_prompt(&user_prompt);

    let (items, _usage) = crate::summarize::model_calls::generate_changeset_summaries(
        WHOLE_DIFF_SYSTEM_PROMPT,
        &user_prompt,
        Some(app),
    )
    .await?;

    let groups = partition_changes(changes, &items);

    // The model may not reference every file. Build a single display string
    // from all returned summaries so `generated_commit_message` (consumed by
    // the commit-message pipeline) reflects the full changeset even when the
    // model split it into several groups.
    let generated_message = items
        .iter()
        .map(|item| item.summary.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    let change_set_id = crate::db::store_whole_diff_changeset::store(
        &pool,
        &groups,
        &generated_message,
        commit_id,
        base_commit_id,
        commit_message,
        evolution_id,
    )?;

    emit_update(app, &pool, base_ref)?;

    Ok(Some(change_set_id))
}

/// A change assigned to a group summary.
pub struct GroupedChange {
    pub change: Change,
    pub summary: String,
}

/// Matches model-returned file paths to change rows and groups them.
///
/// Files are matched by repository-relative basename (the model frequently
/// returns short paths or basenames). Any change the model did not assign to
/// a group is collected into a fallback group using the first summary, so no
/// file is left unsummarized (which would otherwise trigger re-summarization
/// loops in `group_existing`).
fn partition_changes(changes: Vec<Change>, items: &[ChangesetSummaryItem]) -> Vec<GroupedChange> {
    // Index model file paths by basename for tolerant matching. The model
    // often emits `"foo.nix"` even when the stored path is `"dir/foo.nix"`.
    let mut path_to_item: HashMap<String, usize> = HashMap::new();
    for (i, item) in items.iter().enumerate() {
        for file in &item.files {
            path_to_item.insert(file.clone(), i);
            if let Some(base) = std::path::Path::new(file)
                .file_name()
                .and_then(|n| n.to_str())
            {
                path_to_item.insert(base.to_string(), i);
            }
        }
    }

    let fallback_summary = items
        .first()
        .map(|i| i.summary.clone())
        .unwrap_or_else(|| "chore: summarize changes".to_string());

    let mut assigned = vec![false; changes.len()];
    let mut groups: Vec<GroupedChange> = Vec::new();

    for (idx, change) in changes.iter().enumerate() {
        let matched = path_to_item.get(&change.filename).copied().or_else(|| {
            std::path::Path::new(&change.filename)
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(|base| path_to_item.get(base).copied())
        });
        if let Some(i) = matched {
            assigned[idx] = true;
            groups.push(GroupedChange {
                change: change.clone(),
                summary: items[i].summary.clone(),
            });
        }
    }

    for (idx, change) in changes.into_iter().enumerate() {
        if !assigned[idx] {
            groups.push(GroupedChange {
                change,
                summary: fallback_summary.clone(),
            });
        }
    }

    groups
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
        let change_sets = crate::summarize::find_existing::for_current_state(pool, &config_dir)?;
        crate::summarize::group_existing::from_change_sets(change_sets)
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

    #[test]
    fn matched_files_are_grouped_by_summary() {
        let changes = vec![change("a.nix"), change("b.nix"), change("c.nix")];
        let items = vec![
            ChangesetSummaryItem {
                summary: "feat: a and b".into(),
                files: vec!["a.nix".into(), "b.nix".into()],
            },
            ChangesetSummaryItem {
                summary: "fix: c".into(),
                files: vec!["c.nix".into()],
            },
        ];
        let groups = partition_changes(changes, &items);
        assert_eq!(groups.len(), 3);
        assert_eq!(groups[0].summary, "feat: a and b");
        assert_eq!(groups[1].summary, "feat: a and b");
        assert_eq!(groups[2].summary, "fix: c");
    }

    #[test]
    fn unmatched_files_fall_back_to_first_summary() {
        let changes = vec![change("a.nix"), change("orphan.nix")];
        let items = vec![ChangesetSummaryItem {
            summary: "feat: a".into(),
            files: vec!["a.nix".into()],
        }];
        let groups = partition_changes(changes, &items);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].summary, "feat: a");
        // Orphan keeps the fallback so it isn't flagged unsummarized.
        assert_eq!(groups[1].summary, "feat: a");
        assert_eq!(groups[1].change.filename, "orphan.nix");
    }

    #[test]
    fn basename_matching_resolves_nested_paths() {
        let changes = vec![change("modules/darwin/dock.nix")];
        let items = vec![ChangesetSummaryItem {
            summary: "feat: dock".into(),
            files: vec!["dock.nix".into()],
        }];
        let groups = partition_changes(changes, &items);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].summary, "feat: dock");
    }
}
