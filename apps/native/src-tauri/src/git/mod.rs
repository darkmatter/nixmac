//! Git module: low-level subprocess wrappers and diff parsing.

pub mod auth;
pub mod auto_update;
pub mod exec;
pub mod init;
pub mod query;
mod repo_files;

// Re-export the entire public surface of exec and query so callers keep using
// `crate::git::some_fn()` without change.
#[allow(unused_imports)]
pub use exec::{
    CommitInfo, checkout_files_at_commit, commit_all, commit_file, create_evolution_backup,
    intent_add_untracked, restore_all, restore_file, restore_from_branch_ref, tag_commit,
};

#[allow(unused_imports)]
pub use query::{backup_anchor_commit, current_branch, get_ref_sha, read_tags, status};

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

/// Heuristic to determine if a file diff is sensitive or opaque, and thus should be hidden from summaries and diff displays.
/// This is not perfect but aims to catch common cases like lockfiles, secrets, large binary blobs, and minified files.
///
/// Specific things to look for:
/// - Filenames that suggest secrets (e.g. containing "secret" or ending with .token)
/// - Filenames that suggest lockfiles (e.g. ending with .lock or specific known lockfile names)
/// - Filenames that suggest minified files (e.g. ending with .min.js or .js.map)
/// - Diffs that contain PEM blocks (e.g. "-----BEGIN RSA PRIVATE KEY-----")
/// - Diffs that contain SOPS encrypted values (e.g. "ENC[")
/// - Diffs that are very long and look like base64-encoded blobs
pub fn is_sensitive_or_opaque(filename: &str, diff: &str, is_binary: bool) -> bool {
    if is_binary {
        return true;
    }

    let basename = filename.rsplit('/').next().unwrap_or(filename);

    // locks
    if filename.ends_with(".lock")
        || filename.ends_with(".lockb")
        || matches!(
            basename,
            "package-lock.json" | "pnpm-lock.yaml" | "npm-shrinkwrap.json"
        )
    {
        return true;
    }

    // secrets
    if filename.ends_with(".token")
        || filename.ends_with(".age")
        || filename.starts_with("secrets/")
        || filename.contains("/secrets/")
    {
        return true;
    }

    // maps / minified
    if filename.ends_with(".js.map")
        || filename.ends_with(".ts.map")
        || filename.ends_with(".min.js")
        || filename.ends_with(".min.css")
    {
        return true;
    }

    // raycast
    if filename.contains("/raycast/extensions/") {
        return true;
    }

    // PEM / keys
    if diff.contains("-----BEGIN ") {
        return true;
    }

    // SOPS
    if diff.contains("ENC[") {
        return true;
    }

    // opaque blobs
    diff.lines().any(|line| {
        let stripped = line.trim_start_matches(['+', '-', ' ']);
        stripped.len() > 200
            && stripped.chars().all(|c| {
                matches!(c,
                    'A'..='Z' | 'a'..='z' | '0'..='9' | '+' | '/' | '=' | '\r'
                )
            })
    })
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
        assert!(is_sensitive_or_opaque("package-lock.json", "", false));
    }

    #[test]
    fn detects_secrets() {
        assert!(is_sensitive_or_opaque("secrets/api.token", "", false));
    }

    #[test]
    fn detects_binary() {
        assert!(is_sensitive_or_opaque("image.png", "", true));
    }

    #[test]
    fn allows_normal_files() {
        assert!(!is_sensitive_or_opaque("src/lib.rs", "", false));
    }

    #[test]
    fn detects_pem() {
        let diff = "diff --git a/secret.pem b/secret.pem\nindex e3b0c4..d1e8f7 100644\n--- a/secret.pem\n+++ b/secret.pem\n@@ -0,0 +1,5 @@\n+-----BEGIN RSA PRIVATE KEY-----\n+MIIEogIBAAKCAQEA...\n+-----END RSA PRIVATE KEY-----";
        assert!(is_sensitive_or_opaque("secret.pem", diff, false));
    }

    #[test]
    fn detects_sops() {
        let diff = "diff --git a/config.enc.yaml b/config.enc.yaml\nindex e3b0c4..d1e8f7 100644\n--- a/config.enc.yaml\n+++ b/config.enc.yaml\n@@ -0,0 +1,5 @@\n+apiVersion: v1\n+kind: Secret\n+metadata:\n+  name: mysecret\n+data:\n+  config.yaml: ENC[AES256_GCM,data:...]";
        assert!(is_sensitive_or_opaque("config.enc.yaml", diff, false));
    }

    #[test]
    fn detects_long_base64_blob() {
        let blob = "A".repeat(250);
        let diff = format!("+{}", blob);

        assert!(is_sensitive_or_opaque("foo.txt", &diff, false));
    }
}
