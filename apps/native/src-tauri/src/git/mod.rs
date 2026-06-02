//! Git module: low-level subprocess wrappers and diff parsing.

pub mod changes_from_diff;
pub mod exec;
pub mod init;
pub mod query;

// Re-export the entire public surface of exec and query so callers keep using
// `crate::git::some_fn()` without change.
#[allow(unused_imports)]
pub use exec::{
    checkout_files_at_commit, commit_all, create_evolution_backup, delete_backup_branch,
    get_nix_diff, intent_add_untracked, log, restore_all, restore_from_branch_ref, stash,
    tag_commit, CommitInfo,
};

#[allow(unused_imports)]
pub use query::{current_branch, get_ref_sha, read_tags, status};

use crate::sqlite_types::Change;
use sha2::{Digest, Sha256};

/// Lines kept in `Change.diff` for display. The hash uses the full hunk.
const DIFF_EXCERPT_LINES: usize = 60;

pub struct FileDiff {
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub diff: String,
    pub line_count: i64,
}

pub fn is_sensitive_or_opaque(filename: &str, is_binary: bool) -> bool {
    if is_binary {
        return true;
    }

    let basename = filename.rsplit('/').next().unwrap_or(filename);

    // Lock files
    if filename.ends_with(".lock")
        || filename.ends_with(".lockb")
        || matches!(
            basename,
            "package-lock.json" | "pnpm-lock.yaml" | "npm-shrinkwrap.json"
        )
    {
        return true;
    }

    // Credentials / secrets
    if filename.ends_with(".token")
        || filename.ends_with(".age")
        || filename.starts_with("secrets/")
        || filename.contains("/secrets/")
    {
        return true;
    }

    // Source maps / minified artifacts
    if filename.ends_with(".js.map")
        || filename.ends_with(".ts.map")
        || filename.ends_with(".min.js")
        || filename.ends_with(".min.css")
    {
        return true;
    }

    // Raycast extensions
    if filename.contains("/raycast/extensions/") {
        return true;
    }

    false
}

fn is_sensitive_or_opaque_delta(delta: &git2::DiffDelta, filename: &str) -> bool {
    let is_binary = delta.flags().contains(git2::DiffFlags::BINARY);
    is_sensitive_or_opaque(filename, is_binary)
}

pub fn file_diff_to_change(diff: FileDiff, created_at: i64, should_truncate: bool) -> Change {
    let filename = diff
        .new_path
        .clone()
        .or(diff.old_path.clone())
        .unwrap_or_default();

    Change {
        id: 0, // db assigned
        hash: hunk_hash(&filename, &diff.diff),
        filename,
        diff: if should_truncate {
            truncate_excerpt(&diff.diff)
        } else {
            diff.diff
        },
        line_count: diff.line_count,
        created_at,
        own_summary_id: None,
    }
}

fn hunk_hash(filename: &str, hunk: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(filename.as_bytes());
    hasher.update(b"\0");
    hasher.update(hunk.trim_end().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn truncate_excerpt(hunk: &str) -> String {
    let mut lines = hunk.lines();
    let head: Vec<&str> = lines.by_ref().take(DIFF_EXCERPT_LINES).collect();
    if lines.next().is_some() {
        format!("{}\n... [truncated]", head.join("\n"))
    } else {
        head.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hunk_hash_is_deterministic() {
        let filename = "src/lib.rs";
        let hunk = "@@ -1,4 +1,4 @@\n- old line\n+ new line\n  unchanged line";

        let hash1 = hunk_hash(filename, hunk);
        let hash2 = hunk_hash(filename, hunk);

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn hunk_hash_is_sensitive_to_filename() {
        let hunk = "@@ -1,4 +1,4 @@\n- old line\n+ new line\n  unchanged line";

        let hash1 = hunk_hash("src/lib.rs", hunk);
        let hash2 = hunk_hash("src/main.rs", hunk);

        assert_ne!(hash1, hash2);
    }

    #[test]
    fn truncate_excerpt_short_is_identity() {
        let hunk = "@@ -1,2 +1,2 @@\n- old line\n+ new line";

        assert_eq!(truncate_excerpt(hunk), hunk);
    }

    #[test]
    fn truncate_excerpt_long_is_marked() {
        let mut hunk = String::new();

        for i in 0..(DIFF_EXCERPT_LINES + 10) {
            hunk.push_str(&format!("line {}\n", i));
        }

        let excerpt = truncate_excerpt(&hunk);

        assert!(excerpt.ends_with("... [truncated]"));
    }

    #[test]
    fn detects_lock_files() {
        assert!(is_sensitive_or_opaque("package-lock.json", false));
    }

    #[test]
    fn detects_secrets() {
        assert!(is_sensitive_or_opaque("secrets/api.token", false));
    }

    #[test]
    fn detects_binary() {
        assert!(is_sensitive_or_opaque("image.png", true));
    }

    #[test]
    fn allows_normal_files() {
        assert!(!is_sensitive_or_opaque("src/lib.rs", false));
    }
}
