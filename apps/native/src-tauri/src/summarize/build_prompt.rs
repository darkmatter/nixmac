// Prompt builders for whole-diff summarization.

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

/// Builds a prompt that summarizes all changes as one or more conventional
/// change descriptions, each covering a subset of the individual changes.
pub fn whole_diff(changes: &[&crate::sqlite_types::Change]) -> String {
    join_sections(&[
        "Group the following changes into one or more semantic changes. \
         Each group must share a coherent purpose (a single logical change). \
         Return the groups in the required JSON response object.\n\n"
            .to_string(),
        list_changes(changes),
        "\nFor each group, return a JSON object with:\n".to_string(),
        "  - \"summary\": a concise, factual plain-language summary of the change\n".to_string(),
        "  - \"changes\": an array of the exact change hashes included in that group\n".to_string(),
        "Rules:\n".to_string(),
        "- Base every summary only on the visible changes.\n".to_string(),
        "- Do not invent intent that is not visible in the diff.\n".to_string(),
        "- Do not assign a conventional-commit type, scope, or prefix.\n".to_string(),
        "- Every supplied change hash must appear in exactly one group.\n".to_string(),
        "- Prefer fewer groups; only split when changes are clearly unrelated.\n".to_string(),
        "Return ONLY a valid JSON object with a \"groups\" array.\n".to_string(),
        "Example:\n".to_string(),
        "{\n  \"groups\": [\n".to_string(),
        "    {\"summary\":\"Enable dock auto-hide\",\"changes\":[\"<hash>\"]},\n".to_string(),
        "    {\"summary\":\"Update flake inputs\",\"changes\":[\"<hash>\"]}\n".to_string(),
        "  ]\n}\n\n".to_string(),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite_types::Change;

    #[test]
    fn whole_diff_requests_free_form_semantic_summaries() {
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
        assert!(out.contains("plain-language summary"));
        assert!(out.contains("\"summary\""));
        assert!(out.contains("\"changes\""));
        assert!(out.contains("Return ONLY a valid JSON object with a \"groups\" array"));
        assert!(!out.contains("conventional commit"));
        assert!(!out.contains("Allowed types:"));
        assert!(!out.contains("feat, fix, chore"));
    }
}
