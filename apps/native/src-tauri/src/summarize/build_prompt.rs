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

/// Builds a prompt that summarizes all hunks in one conventional commit message.
pub fn whole_diff(changes: &[&crate::sqlite_types::Change]) -> String {
    join_sections(&[
        "Generate a single conventional commit message for the following changes.\n\n".to_string(),
        list_changes(changes),
        "\nFormat: <type>(<scope>): <description>\n".to_string(),
        "Allowed types: feat, fix, chore, refactor, docs, style, test, perf\n".to_string(),
        "Base the message only on the visible changes.\n".to_string(),
        "Return ONLY valid JSON.\n".to_string(),
        "Example:\n".to_string(),
        "{\"message\":\"feat(darwin): enable dock auto-hide\"}\n\n".to_string(),
        "JSON:\n".to_string(),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite_types::Change;

    #[test]
    fn whole_diff_does_not_request_per_hunk_json() {
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
        assert!(out.contains(&change.hash));
        assert!(out.contains("ALL of these changes together"));
        assert!(out.contains("\"message\""));
        assert!(!out.contains("\"changes\""));
        assert!(!out.contains("\"group\""));
        assert!(!out.contains("Title – Description"));
    }
}
