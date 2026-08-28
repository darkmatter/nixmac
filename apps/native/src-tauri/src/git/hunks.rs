//! Hunk-level content surgery for per-change drift actions.
//!
//! Each drift row is a single unified-diff hunk (see `query::run_diff_engine`),
//! so per-change commit/discard transforms one hunk against file content
//! instead of operating on the whole file. Hunk text from the drift pipeline
//! always starts with an explicit-count `@@` header and contains only
//! ` `/`-`/`+` body lines — newline-at-EOF markers are dropped upstream, so
//! callers supply the trailing-newline state for regions that end the file.

use anyhow::{anyhow, bail};

/// A parsed unified-diff hunk: header start lines plus the old/new views of
/// the hunk body. Context lines appear in both sides.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedHunk {
    /// 1-based start line in the old (base) content; 0 when the old side is empty.
    pub old_start: usize,
    /// 1-based start line in the new (working-tree) content.
    pub new_start: usize,
    /// Context + removed lines, in hunk order (the old content's view).
    pub old_lines: Vec<String>,
    /// Context + added lines, in hunk order (the new content's view).
    pub new_lines: Vec<String>,
}

/// Which side of a hunk the content represents.
pub enum Direction {
    /// Content is the hunk's new side (the working tree); applying restores the
    /// hunk's old side (per-change discard).
    Reverse,
    /// Content is the hunk's old side (HEAD); applying records the hunk's
    /// change (per-change commit).
    Forward,
}

/// Result of applying a hunk to some content.
pub enum ApplyOutcome {
    /// The transformed file content.
    Content(String),
    /// The hunk consumed the content entirely — discarding a new file's hunk
    /// or committing a deleted-file hunk.
    Empty,
}

pub fn parse_hunk(hunk: &str) -> anyhow::Result<ParsedHunk> {
    let mut lines = hunk.lines();
    let header = lines.next().ok_or_else(|| anyhow!("hunk is empty"))?;
    let (old_start, new_start) = parse_header(header)?;

    let mut old_lines = Vec::new();
    let mut new_lines = Vec::new();
    for line in lines {
        let Some(prefix) = line.chars().next() else {
            bail!("hunk contains an unprefixed empty line");
        };
        let body = &line[1..];
        match prefix {
            ' ' => {
                old_lines.push(body.to_string());
                new_lines.push(body.to_string());
            }
            '-' => old_lines.push(body.to_string()),
            '+' => new_lines.push(body.to_string()),
            other => bail!("unsupported hunk line prefix `{other}`"),
        }
    }

    Ok(ParsedHunk {
        old_start,
        new_start,
        old_lines,
        new_lines,
    })
}

fn parse_header(header: &str) -> anyhow::Result<(usize, usize)> {
    let rest = header
        .strip_prefix("@@ ")
        .ok_or_else(|| anyhow!("hunk header does not start with `@@`: `{header}`"))?;
    let ranges = rest
        .split_once(" @@")
        .map(|(ranges, _)| ranges)
        .ok_or_else(|| anyhow!("hunk header missing closing `@@`: `{header}`"))?;

    let mut parts = ranges.split_whitespace();
    let old = parts
        .next()
        .ok_or_else(|| anyhow!("hunk header missing old range: `{header}`"))?;
    let new = parts
        .next()
        .ok_or_else(|| anyhow!("hunk header missing new range: `{header}`"))?;

    Ok((parse_range_start(old, '-')?, parse_range_start(new, '+')?))
}

fn parse_range_start(range: &str, sign: char) -> anyhow::Result<usize> {
    let start = range
        .strip_prefix(sign)
        .ok_or_else(|| anyhow!("hunk range `{range}` does not start with `{sign}`"))?
        .split(',')
        .next()
        .unwrap_or_default();
    start
        .parse::<usize>()
        .map_err(|_| anyhow!("hunk range `{range}` has a non-numeric start"))
}

/// Apply one hunk to `content` in the given direction.
///
/// `eof_trailing_newline` decides whether the result ends with a newline when
/// the hunk's replaced region reaches the end of the file (the hunk text
/// cannot express that itself). The caller knows the authoritative side: HEAD
/// blob content for Reverse, working-tree content for Forward.
pub fn apply_hunk(
    content: &str,
    hunk: &ParsedHunk,
    direction: Direction,
    eof_trailing_newline: bool,
) -> anyhow::Result<ApplyOutcome> {
    let (find_lines, find_start, replace_lines) = match direction {
        Direction::Reverse => (&hunk.new_lines, hunk.new_start, &hunk.old_lines),
        Direction::Forward => (&hunk.old_lines, hunk.old_start, &hunk.new_lines),
    };
    if find_lines.is_empty() && replace_lines.is_empty() {
        bail!("hunk has no content");
    }

    let raw_lines = split_raw_lines(content);
    if find_lines.is_empty() {
        // The content side of the hunk is empty (new-file hunk against empty
        // content, or restoring a deleted file): the result is the other side.
        if !raw_lines.is_empty() {
            bail!("hunk expects empty content but the file has lines");
        }
        return Ok(outcome_from(join_lines(
            replace_lines,
            eof_trailing_newline,
        )));
    }

    let expected = find_start.saturating_sub(1);
    let pos = match find_sequence(&raw_lines, find_lines, expected) {
        SequenceMatch::Unique(pos) => pos,
        SequenceMatch::Ambiguous => {
            bail!("this change matches more than one place in the file; refresh and try again")
        }
        SequenceMatch::Missing => {
            bail!("this change no longer matches the file's content; refresh and try again")
        }
    };

    let reaches_eof = pos + find_lines.len() == raw_lines.len();
    let mut result = String::new();
    for raw in &raw_lines[..pos] {
        result.push_str(raw);
    }
    for (index, line) in replace_lines.iter().enumerate() {
        result.push_str(line);
        let more_content = index + 1 < replace_lines.len() || !reaches_eof;
        if more_content || (reaches_eof && eof_trailing_newline) {
            result.push('\n');
        }
    }
    for raw in &raw_lines[pos + find_lines.len()..] {
        result.push_str(raw);
    }

    Ok(outcome_from(result))
}

fn outcome_from(content: String) -> ApplyOutcome {
    if content.is_empty() {
        ApplyOutcome::Empty
    } else {
        ApplyOutcome::Content(content)
    }
}

/// Split `content` into raw lines, each keeping its `\n` if present.
fn split_raw_lines(content: &str) -> Vec<&str> {
    if content.is_empty() {
        Vec::new()
    } else {
        content.split_inclusive('\n').collect()
    }
}

/// Join logical lines with `\n`, optionally ending with one.
fn join_lines(lines: &[String], trailing_newline: bool) -> String {
    if lines.is_empty() {
        return String::new();
    }
    let mut joined = lines.join("\n");
    if trailing_newline {
        joined.push('\n');
    }
    joined
}

fn matches_at(raw_lines: &[&str], lines: &[String], pos: usize) -> bool {
    raw_lines[pos..pos + lines.len()]
        .iter()
        .zip(lines)
        .all(|(raw, want)| raw.strip_suffix('\n').unwrap_or(raw) == want)
}

/// How far (in lines) a hunk may drift from its recorded position and still
/// match. Hunks are re-derived from a fresh diff right before they are
/// applied, so real drift is limited to races with concurrent edits; beyond
/// this window a similar-looking region counts as a stale match.
const MAX_DRIFT_LINES: usize = 25;

/// Where a hunk's find-side sequence occurs in the file near its recorded position.
enum SequenceMatch {
    /// Exactly one occurrence within the drift window.
    Unique(usize),
    /// More than one occurrence within the window — applying could hit the
    /// wrong one (context-only find sides of pure-deletion hunks match easily
    /// in repetitive configs).
    Ambiguous,
    /// No occurrence within the drift window.
    Missing,
}

/// Find `lines` in `raw_lines`, preferring the position nearest to the 0-based
/// `expected` offset (hunk line numbers drift when earlier content changed).
/// A match is trusted only when it is the sole occurrence within
/// [`MAX_DRIFT_LINES`] of `expected`.
fn find_sequence(raw_lines: &[&str], lines: &[String], expected: usize) -> SequenceMatch {
    let Some(max_start) = raw_lines.len().checked_sub(lines.len()) else {
        return SequenceMatch::Missing;
    };
    let mut first: Option<usize> = None;
    for offset in 0..=MAX_DRIFT_LINES {
        for pos in [expected.checked_sub(offset), expected.checked_add(offset)] {
            let Some(pos) = pos else { continue };
            if pos > max_start || !matches_at(raw_lines, lines, pos) {
                continue;
            }
            if first.is_some_and(|first| first != pos) {
                return SequenceMatch::Ambiguous;
            }
            first = Some(pos);
        }
    }
    match first {
        Some(pos) => SequenceMatch::Unique(pos),
        None => SequenceMatch::Missing,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EDITED: &str = "@@ -2,3 +2,4 @@\n b\n-c\n+new-a\n+new-b\n d";
    const OLD_CONTENT: &str = "a\nb\nc\nd\ne\n";
    const NEW_CONTENT: &str = "a\nb\nnew-a\nnew-b\nd\ne\n";

    #[test]
    fn parse_reads_header_ranges_and_sides() {
        let parsed = parse_hunk(EDITED).expect("parse edited hunk");

        assert_eq!(parsed.old_start, 2);
        assert_eq!(parsed.new_start, 2);
        assert_eq!(parsed.old_lines, ["b", "c", "d"]);
        assert_eq!(parsed.new_lines, ["b", "new-a", "new-b", "d"]);
    }

    #[test]
    fn parse_accepts_whole_file_hunks_and_section_headers() {
        let added = parse_hunk("@@ -0,0 +1,2 @@ section\n+a\n+b\n").expect("parse added hunk");
        assert_eq!(added.old_start, 0);
        assert_eq!(added.new_start, 1);
        assert!(added.old_lines.is_empty());
        assert_eq!(added.new_lines, ["a", "b"]);

        let removed = parse_hunk("@@ -1,2 +0,0 @@\n-a\n-b").expect("parse removed hunk");
        assert!(removed.new_lines.is_empty());
        assert_eq!(removed.old_lines, ["a", "b"]);
    }

    #[test]
    fn parse_rejects_malformed_hunks() {
        assert!(parse_hunk("").is_err());
        assert!(parse_hunk("not a hunk").is_err());
        assert!(parse_hunk("@@ -1 +1 @@\nline without prefix").is_err());
        assert!(parse_hunk("@@ x,y +1,2 @@\n a").is_err());
    }

    #[test]
    fn reverse_restores_the_old_side_in_place() {
        let parsed = parse_hunk(EDITED).expect("parse hunk");

        let outcome =
            apply_hunk(NEW_CONTENT, &parsed, Direction::Reverse, true).expect("reverse apply");
        assert_eq!(outcome_to_string(outcome), OLD_CONTENT);
    }

    #[test]
    fn forward_applies_the_change_to_the_base_content() {
        let parsed = parse_hunk(EDITED).expect("parse hunk");

        let outcome =
            apply_hunk(OLD_CONTENT, &parsed, Direction::Forward, true).expect("forward apply");
        assert_eq!(outcome_to_string(outcome), NEW_CONTENT);
    }

    #[test]
    fn reverse_of_a_new_file_hunk_empties_the_content() {
        let parsed = parse_hunk("@@ -0,0 +1,2 @@\n+a\n+b").expect("parse hunk");

        let outcome = apply_hunk("a\nb\n", &parsed, Direction::Reverse, true).expect("apply");
        assert!(matches!(outcome, ApplyOutcome::Empty));
    }

    #[test]
    fn reverse_of_a_deleted_file_hunk_restores_content_from_nothing() {
        let parsed = parse_hunk("@@ -1,2 +0,0 @@\n-a\n-b").expect("parse hunk");

        let outcome = apply_hunk("", &parsed, Direction::Reverse, true).expect("apply");
        assert_eq!(outcome_to_string(outcome), "a\nb\n");
    }

    #[test]
    fn forward_of_a_deleted_file_hunk_empties_the_content() {
        let parsed = parse_hunk("@@ -1,2 +0,0 @@\n-a\n-b").expect("parse hunk");

        let outcome = apply_hunk("a\nb\n", &parsed, Direction::Forward, true).expect("apply");
        assert!(matches!(outcome, ApplyOutcome::Empty));
    }

    #[test]
    fn reverse_preserves_sibling_hunks_in_the_same_file() {
        let parsed = parse_hunk("@@ -3,2 +3,2 @@\n c\n-d\n+D\n e").expect("parse hunk");
        let drifted = "a\nb\nc\nD\ne\nf\ng\n";

        let outcome = apply_hunk(drifted, &parsed, Direction::Reverse, true).expect("apply");
        assert_eq!(
            outcome_to_string(outcome),
            "a\nb\nc\nd\ne\nf\ng\n",
            "only this hunk's lines revert"
        );
    }

    #[test]
    fn reverse_matches_when_line_numbers_drift() {
        let parsed = parse_hunk("@@ -5,1 +5,1 @@\n-e\n+x").expect("parse hunk");
        // An extra line was inserted above after the hunk was captured,
        // shifting the hunk's region from line 5 to line 6.
        let drifted = "a\nb\nc\nd\nextra\nx\n";

        let outcome = apply_hunk(drifted, &parsed, Direction::Reverse, true).expect("apply");
        assert_eq!(outcome_to_string(outcome), "a\nb\nc\nd\nextra\ne\n");
    }

    #[test]
    fn reverse_errors_when_the_content_no_longer_matches() {
        let parsed = parse_hunk(EDITED).expect("parse hunk");

        let result = apply_hunk("totally\nchanged\n", &parsed, Direction::Reverse, true);
        assert!(result.is_err());
    }

    #[test]
    fn reverse_errors_when_the_match_is_ambiguous() {
        // A pure-deletion hunk's find side is context-only (`b` twice here),
        // which can occur in several places of a repetitive file.
        let parsed = parse_hunk("@@ -2,4 +2,1 @@\n b\n-c\n-d\n b").expect("parse hunk");
        let repetitive = "a\nb\nb\nx\nb\nb\nz\n";

        let result = apply_hunk(repetitive, &parsed, Direction::Reverse, true);
        assert!(
            result.is_err(),
            "an ambiguous match must not revert an arbitrary occurrence"
        );
    }

    #[test]
    fn reverse_errors_when_the_only_match_drifts_beyond_the_window() {
        let parsed = parse_hunk("@@ -2,1 +2,1 @@\n-b\n+B").expect("parse hunk");
        let far = format!("a\n{}B\n", "x\n".repeat(100));

        let result = apply_hunk(&far, &parsed, Direction::Reverse, true);
        assert!(
            result.is_err(),
            "a match far from the recorded position must not apply"
        );
    }

    #[test]
    fn reverse_applies_when_only_one_match_sits_within_the_drift_window() {
        let parsed = parse_hunk("@@ -2,1 +2,1 @@\n-b\n+B").expect("parse hunk");
        let distant_duplicate = format!("a\nB\n{}B\n", "x\n".repeat(100));

        let outcome =
            apply_hunk(&distant_duplicate, &parsed, Direction::Reverse, true).expect("apply");
        assert_eq!(
            outcome_to_string(outcome),
            format!("a\nb\n{}B\n", "x\n".repeat(100)),
            "a duplicate far outside the window does not poison the nearby match"
        );
    }

    #[test]
    fn trailing_newline_at_eof_follows_the_caller_hint() {
        let parsed = parse_hunk("@@ -1,1 +1,2 @@\n one\n+two").expect("parse hunk");

        let without = apply_hunk("one\ntwo", &parsed, Direction::Reverse, false).expect("apply");
        assert_eq!(outcome_to_string(without), "one");

        let with = apply_hunk("one\ntwo", &parsed, Direction::Reverse, true).expect("apply");
        assert_eq!(outcome_to_string(with), "one\n");
    }

    #[test]
    fn mid_file_removal_keeps_surrounding_lines() {
        let parsed = parse_hunk("@@ -2,3 +2,1 @@\n b\n-c\n-d\n e").expect("parse hunk");

        // The current content is the hunk's new side (c and d already gone);
        // reversing restores them without touching surrounding lines.
        let outcome = apply_hunk("a\nb\ne\n", &parsed, Direction::Reverse, true).expect("apply");
        assert_eq!(outcome_to_string(outcome), "a\nb\nc\nd\ne\n");
    }

    fn outcome_to_string(outcome: ApplyOutcome) -> String {
        match outcome {
            ApplyOutcome::Content(content) => content,
            ApplyOutcome::Empty => String::new(),
        }
    }
}
