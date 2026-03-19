//! Parses a unified diff into per-hunk [`Change`] structs.
//!
//! Each file × hunk pair becomes one [`Change`]. The hash is deterministic:
//! `SHA-256(filename \0 full_hunk_text)` computed before truncation, so
//! identical changes across commits are naturally deduplicated even when the
//! stored `diff` excerpt is the same for two distinct hunks.
//!
//! `Change.diff` is capped at [`DIFF_EXCERPT_LINES`] for storage/display.
//! `Change.line_count` preserves the full hunk size.

use crate::sqlite_types::Change;
use sha2::{Digest, Sha256};

/// Lines kept in `Change.diff` for display. The hash uses the full hunk.
const DIFF_EXCERPT_LINES: usize = 60;

/// Parse a unified diff string into one [`Change`] per file-hunk.
///
/// `created_at` is a Unix timestamp (seconds) forwarded to every returned struct.
/// The `id` field is always `0`; callers assign real ids on DB insert.
pub fn changes_from_diff(diff: &str, created_at: i64, truncate_diffs: bool) -> Vec<Change> {
    let mut changes = Vec::new();
    let mut current_file: Option<String> = None;
    let mut current_hunk: Option<String> = None;

    for line in diff.lines() {
        if line.starts_with("diff --git ") {
            flush(&mut changes, &current_file, &mut current_hunk, created_at, truncate_diffs);
            // "diff --git is, always present with filenames for a/ and b/ paths.
            current_file = line.rfind(" b/").and_then(|i| line.get(i + 3..)).map(str::to_string);
        } else if let Some(path) = line.strip_prefix("+++ b/") {
            // Overrides the header value; more reliable for renames.
            current_file = Some(path.to_string());
        } else if line.starts_with("@@ ") {
            flush(&mut changes, &current_file, &mut current_hunk, created_at, truncate_diffs);
            current_hunk = Some(line.to_string());
        } else if let Some(ref mut hunk) = current_hunk {
            hunk.push('\n');
            hunk.push_str(line);
        }
    }
    flush(&mut changes, &current_file, &mut current_hunk, created_at, truncate_diffs);

    changes
}

fn flush(
    out: &mut Vec<Change>,
    filename: &Option<String>,
    hunk: &mut Option<String>,
    created_at: i64,
    truncate_diffs: bool,
) {
    if let (Some(f), Some(h)) = (filename.as_deref(), hunk.take()) {
        if !h.trim().is_empty() {
            let line_count = h.lines().count() as i64;
            let hash = hunk_hash(f, &h); // full diff before truncation
            let diff = if truncate_diffs { truncate_excerpt(&h) } else { h };
            out.push(Change {
                id: 0,
                hash,
                filename: f.to_string(),
                diff,
                line_count,
                created_at,
                group_summary_id: None,
                own_summary_id: None,
            });
        }
    }
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

/// Returns true for hunks that should be excluded from AI analysis.
///
/// Two categories:
/// - **Security**: credential files, secrets directories, SOPS-encrypted content,
///   PEM blocks — content that should not leave the local machine via a remote
///   provider, and that the model cannot meaningfully interpret anyway.
/// - **Model safety**: lock files, long opaque base64/hex blobs — content that
///   adds no semantic signal and can cause Ollama's JSON mode to latch onto
///   embedded structures and output them verbatim instead of the expected schema.
pub fn is_sensitive_or_opaque(change: &Change) -> bool {
    let fname = &change.filename;
    let basename = fname.rsplit('/').next().unwrap_or(fname);

    // Lock file extensions (.lock covers flake.lock, Cargo.lock, yarn.lock, etc.)
    if fname.ends_with(".lock") || fname.ends_with(".lockb") {
        return true;
    }
    // Lock files that don't use a .lock extension
    if matches!(
        basename,
        "package-lock.json" | "pnpm-lock.yaml" | "npm-shrinkwrap.json"
    ) {
        return true;
    }
    // Credential / secret files
    if fname.ends_with(".token") || fname.ends_with(".age") {
        return true;
    }
    // Secrets directories
    if fname.starts_with("secrets/") || fname.contains("/secrets/") {
        return true;
    }
    // SOPS encrypted values (any algorithm — ENC[ is the universal SOPS prefix)
    if change.diff.contains("ENC[") {
        return true;
    }
    // PEM / age encrypted blocks
    if change.diff.contains("-----BEGIN ") {
        return true;
    }
    // Source maps — never meaningful content
    if fname.ends_with(".js.map") || fname.ends_with(".ts.map") {
        return true;
    }
    // Minified JS/CSS
    if fname.ends_with(".min.js") || fname.ends_with(".min.css") {
        return true;
    }
    // Raycast extension bundles (files/config/raycast/extensions/<uuid>/...)
    if fname.contains("/raycast/extensions/") {
        return true;
    }
    // Any line that is a long opaque base64/hex blob (data URIs, raw binary, etc.).
    // Ollama's JSON mode can latch onto JSON containing these and output it verbatim,
    // exhausting the token budget mid-string.
    change.diff.lines().any(|line| {
        let stripped = line.trim_start_matches(['+', '-', ' ']);
        stripped.len() > 200
            && stripped
                .chars()
                .all(|c| matches!(c, 'A'..='Z' | 'a'..='z' | '0'..='9' | '+' | '/' | '=' | '\r'))
    })
}

fn hunk_hash(filename: &str, hunk: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(filename.as_bytes());
    hasher.update(b"\0");
    hasher.update(hunk.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"diff --git a/flake.nix b/flake.nix
index abc..def 100644
--- a/flake.nix
+++ b/flake.nix
@@ -1,3 +1,4 @@
 {
-  inputs = {};
+  inputs = { nixpkgs.url = "github:NixOS/nixpkgs"; };
+  # added
 }
@@ -10,2 +11,3 @@
 outputs = ...;
+# another hunk
diff --git a/home.nix b/home.nix
new file mode 100644
--- /dev/null
+++ b/home.nix
@@ -0,0 +1,2 @@
+{ pkgs, ... }:
+{ home.packages = []; }"#;

    #[test]
    fn parses_two_files_three_hunks() {
        let changes = changes_from_diff(SAMPLE, 0, true);
        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0].filename, "flake.nix");
        assert_eq!(changes[1].filename, "flake.nix");
        assert_eq!(changes[2].filename, "home.nix");
    }

    #[test]
    fn hash_is_deterministic() {
        let a = changes_from_diff(SAMPLE, 0, true);
        let b = changes_from_diff(SAMPLE, 99, true); // different timestamp, same hash
        for (x, y) in a.iter().zip(b.iter()) {
            assert_eq!(x.hash, y.hash);
            assert_eq!(x.line_count, y.line_count);
        }
    }

    #[test]
    fn hash_differs_across_hunks() {
        let changes = changes_from_diff(SAMPLE, 0, true);
        assert_ne!(changes[0].hash, changes[1].hash);
    }

}
