// Prompt builders for whole-diff summarization.

pub const BASE_PREAMBLE: &str = include_str!("templates/base_preamble.md");
pub const BASE_CHANGES_INTRO: &str = include_str!("templates/base_changes_intro.md");

/// Join a sequence of prompt sections into a single String.
pub fn join_sections(sections: &[String]) -> String {
    sections.join("")
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

/// Builds a prompt that summarizes all hunks in one conventional commit message.
pub fn whole_diff(changes: &[&crate::sqlite_types::Change]) -> String {
    join_sections(&[
        BASE_PREAMBLE.to_string(),
        BASE_CHANGES_INTRO.to_string(),
        list_changes(changes),
        "\nWrite a conventional commit message summarizing ALL of these changes together.\n"
            .to_string(),
        "Use the format: <type>(<scope>): <description> — types: feat, fix, chore, refactor, docs, style, test, perf\n".to_string(),
        "Return JSON: {\"message\": \"<full commit message string>\"}\n".to_string(),
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
