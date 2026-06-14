//! Commit message pipeline — returns the stored whole-diff summary when available.

use crate::summarize::find_existing::FoundSetForCurrent;
use anyhow::Result;
use tauri::{AppHandle, Runtime};

pub async fn generate<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    let base_ref = crate::summarize::active_summary_base_ref(app);
    let change_sets = crate::summarize::found_change_sets_since(app, &base_ref)?;

    Ok(stored_generated_commit_message(&change_sets))
}

fn stored_generated_commit_message(change_sets: &[FoundSetForCurrent]) -> Option<String> {
    change_sets
        .iter()
        .find_map(|entry| {
            entry
                .change_set
                .as_ref()
                .and_then(|cs| cs.generated_commit_message.as_deref())
                .filter(|message| !message.trim().is_empty())
        })
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite_types::ChangeSet;

    fn found_with_message(generated_commit_message: Option<&str>) -> FoundSetForCurrent {
        FoundSetForCurrent {
            change_set: Some(ChangeSet {
                id: 1,
                commit_id: None,
                base_commit_id: 1,
                commit_message: None,
                generated_commit_message: generated_commit_message.map(str::to_string),
                created_at: 0,
                evolution_id: None,
            }),
            changes: vec![],
            missed_hashes: vec![],
        }
    }

    #[test]
    fn missing_generated_commit_message_is_expected_absence() {
        let change_sets = vec![found_with_message(None), found_with_message(Some("   "))];

        assert_eq!(stored_generated_commit_message(&change_sets), None);
    }

    #[test]
    fn returns_first_non_empty_generated_commit_message() {
        let change_sets = vec![
            found_with_message(None),
            found_with_message(Some("feat(nix): update shell packages")),
        ];

        assert_eq!(
            stored_generated_commit_message(&change_sets).as_deref(),
            Some("feat(nix): update shell packages"),
        );
    }
}
