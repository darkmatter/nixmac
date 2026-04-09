//! History query: all commits from HEAD with DB metadata and change map.

use anyhow::Result;
use std::collections::HashMap;
use std::collections::HashSet;
use tauri::{AppHandle, Runtime};

pub async fn get_history<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<crate::shared_types::HistoryItem>> {
    let config_dir = crate::store::get_config_dir(app)?;
    let db_path = crate::db::get_db_path(app)?;

    let git_commits = crate::git::log(&config_dir, "HEAD", None)?;

    let last_built_sha = crate::git::get_last_built_commit_sha(&config_dir);

    let mut entries = Vec::with_capacity(git_commits.len());
    let mut origin_hashes: Vec<Option<String>> = Vec::with_capacity(git_commits.len());

    for (i, git_commit) in git_commits.iter().enumerate() {
        let db_commit =
            crate::db::commits::get_commit_by_hash(&db_path, &git_commit.hash).unwrap_or(None);

        let parent_db = git_commits.get(i + 1).and_then(|parent| {
            crate::db::commits::get_commit_by_hash(&db_path, &parent.hash)
                .ok()
                .flatten()
        });

        let change_map = db_commit.as_ref().zip(parent_db.as_ref()).and_then(|(commit, parent_db)| {
            crate::summarize::find_existing::by_commit_pair(&db_path, commit.id, parent_db.id)
                .ok()
                .flatten()
                .map(|cs| crate::summarize::group_existing::from_change_sets(vec![cs.into()]))
        });

        let origin_hash = if change_map.is_none() {
            crate::db::restore_commits::get_origin_hash(&db_path, &git_commit.hash)
                .ok()
                .flatten()
        } else {
            None
        };

        let raw_changes = git_commits.get(i + 1).and_then(|parent| {
            crate::git::commit_diff(&config_dir, &parent.hash, &git_commit.hash)
                .ok()
                .map(|diff| crate::changes_from_diff::changes_from_diff(&diff, git_commit.created_at, true))
        }).unwrap_or_default();

        let file_count = {
            let unique: HashSet<&str> = raw_changes.iter().map(|c| c.filename.as_str()).collect();
            unique.len()
        };

        let is_built = last_built_sha
            .as_deref()
            .map(|sha| sha == git_commit.hash)
            .unwrap_or(false);

        let tags = crate::git::read_tags(&config_dir, &git_commit.hash);
        let is_base = tags.iter().any(|t| t.starts_with("nixmac-base-"));
        let is_external = !tags.iter().any(|t| {
            t.starts_with("nixmac-commit-") || t.starts_with("nixmac-base-")
        });

        origin_hashes.push(origin_hash);
        entries.push(crate::shared_types::HistoryItem {
            hash: git_commit.hash.clone(),
            message: git_commit.message.clone(),
            created_at: git_commit.created_at,
            is_built,
            is_base,
            is_external,
            file_count,
            commit: db_commit,
            change_map,
            raw_changes,
            origin_message: None,
        });
    }

    populate_restore_history_items(&mut entries, origin_hashes);

    Ok(entries)
}

fn populate_restore_history_items(
    entries: &mut Vec<crate::shared_types::HistoryItem>,
    origin_hashes: Vec<Option<String>>,
) {
    let hash_to_idx: HashMap<&str, usize> =
        entries.iter().enumerate().map(|(i, e)| (e.hash.as_str(), i)).collect();

    let inherited: Vec<(usize, String, Option<String>, Option<crate::shared_types::SemanticChangeMap>)> =
        origin_hashes
            .iter()
            .enumerate()
            .filter_map(|(i, oh)| {
                oh.as_ref().and_then(|origin_hash| {
                    let ultimate_idx =
                        dig_for_origin(&origin_hashes, &hash_to_idx, origin_hash)?;
                    Some((
                        i,
                        origin_hash.clone(),
                        entries[ultimate_idx].message.clone(),
                        entries[ultimate_idx].change_map.clone(),
                    ))
                })
            })
            .collect();

    drop(hash_to_idx);

    for (i, origin_hash, origin_message, change_map) in inherited {
        let short_hash = &origin_hash[..origin_hash.len().min(8)];
        entries[i].message = Some(format!("Restore commit {short_hash}"));
        entries[i].origin_message = origin_message;
        entries[i].change_map = change_map;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Find the origin, or the origin's origin.
fn dig_for_origin(
    origin_hashes: &[Option<String>],
    hash_to_idx: &HashMap<&str, usize>,
    start: &str,
) -> Option<usize> {
    let mut current = start.to_owned();
    let mut seen = HashSet::new();
    loop {
        if !seen.insert(current.clone()) {
            return None;
        }
        let &idx = hash_to_idx.get(current.as_str())?;
        match &origin_hashes[idx] {
            Some(next) => current = next.clone(),
            None => return Some(idx),
        }
    }
}
