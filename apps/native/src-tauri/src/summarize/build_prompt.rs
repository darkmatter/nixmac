// Prompt builders for whole-diff summarization.

/// Join a sequence of prompt sections into a single String.
pub fn join_sections(sections: &[String]) -> String {
    sections.join("")
}

pub fn list_changes(changes: &[&crate::sqlite_types::Change]) -> String {
    // Use the short_hash format.
    changes
        .iter()
        .map(|c| {
            format!(
                "hash: {}\nfile: {}\nlines: {}\ndiff:\n{}\n\n",
                crate::utils::short_hash(&c.hash),
                c.filename,
                c.line_count,
                c.diff
            )
        })
        .collect()
}

/// Builds a prompt that summarizes all changes as one or more conventional
/// commit messages, each covering a subset of the changed files.
pub fn whole_diff(changes: &[&crate::sqlite_types::Change]) -> String {
    join_sections(&[
        "Group the following changes into one or more conventional commit messages. \
         Each group must share a coherent purpose (a single logical change). \
         Return one object per group.\n\n"
            .to_string(),
        list_changes(changes),
        "\nFor each group, return a JSON object with:\n".to_string(),
        "  - \"summary\": a conventional commit message in the form \
           <type>(<scope>): <description>\n".to_string(),
        "  - \"files\": an array of the file paths included in that group\n".to_string(),
        "Allowed types: feat, fix, chore, refactor, docs, style, test, perf\n".to_string(),
        "Rules:\n".to_string(),
        "- Base every summary only on the visible changes.\n".to_string(),
        "- Do not invent intent that is not visible in the diff.\n".to_string(),
        "- If the type is unclear, prefer \"chore\".\n".to_string(),
        "- Every changed file must appear in exactly one group.\n".to_string(),
        "- Prefer fewer groups; only split when changes are clearly unrelated.\n".to_string(),
        "Return ONLY a valid JSON array.\n".to_string(),
        "Example:\n".to_string(),
        "[\n".to_string(),
        "  {\"summary\":\"feat(darwin): enable dock auto-hide\",\"files\":[\"darwin/dock.nix\"]},\n".to_string(),
        "  {\"summary\":\"chore: bump flake inputs\",\"files\":[\"flake.lock\"]}\n".to_string(),
        "]\n\n".to_string(),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite_types::Change;

    #[test]
    fn whole_diff_requests_multi_item_array() {
        let change = Change {
            id: 1,
            hash: "deadbeef".into(),
            filename: "foo.nix".into(),
            diff: "+x".into(),
            line_count: 1,
            created_at: 0,
            own_summary_id: None,
        };
        let out = whole_diff(&[&change]);
        assert!(out.contains(&crate::utils::short_hash(&change.hash)));
        assert!(out.contains("one or more conventional commit messages"));
        assert!(out.contains("\"summary\""));
        assert!(out.contains("\"files\""));
        assert!(out.contains("Return ONLY a valid JSON array"));
        // Legacy single-message contract must be gone.
        assert!(!out.contains("\"message\""));
        assert!(!out.contains("single conventional commit message"));
    }
}
