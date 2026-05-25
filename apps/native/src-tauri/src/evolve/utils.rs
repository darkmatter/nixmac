//! Common utilities for the evolve module

use anyhow::{anyhow, Result};
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};

/// Escape special characters in the user query to prevent them from being interpreted as markup in the system prompt.
pub fn escape_user_query(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Return short hex prefix for correlation of error messages without risking sensitive content exposure.
pub fn short_hash(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    hex::encode(h.finalize())[..8].to_string()
}

/// Format a duration in seconds as a human-readable string (e.g. "1m 23s", "45s").
pub fn format_duration_secs(secs: i64) -> String {
    let secs = secs.max(0);
    if secs < 60 {
        format!("{}s", secs)
    } else if secs < 3600 {
        format!("{}m {}s", secs / 60, secs % 60)
    } else {
        format!("{}h {}m {}s", secs / 3600, (secs % 3600) / 60, secs % 60)
    }
}

/// Truncate error output to a maximum length, keeping the most relevant parts
pub fn truncate_error(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        return s.to_string();
    }

    // Keep the beginning and end, which usually have the most relevant info
    let half = max_len / 2;
    let mut start = s.to_string();
    crate::utils::truncate_utf8(&mut start, half);

    let tail_budget = max_len.saturating_sub(start.len());
    let end_start = s.floor_char_boundary(s.len().saturating_sub(tail_budget));
    let end = &s[end_start..];

    format!(
        "{}\n\n... [truncated {} bytes] ...\n\n{}",
        start,
        s.len() - max_len,
        end
    )
}

/// Normalize a relative path by collapsing `.` and resolving internal `..` components.
///
/// Rejects absolute/prefixed paths and parent traversals that escape the root.
pub(crate) fn normalize_relative_path(path: &Path) -> Result<PathBuf> {
    if path.is_absolute() {
        return Err(anyhow!("Absolute paths are not allowed"));
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(seg) => normalized.push(seg),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(anyhow!("Path escapes the config directory"));
                }
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(anyhow!(
                    "Path prefixes or root components are not allowed in relative paths"
                ));
            }
        }
    }

    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::{normalize_relative_path, truncate_error};
    use std::path::{Path, PathBuf};

    #[test]
    fn truncate_error_returns_original_when_short_enough() {
        let s = "small error";
        assert_eq!(truncate_error(s, s.len()), s);
        assert_eq!(truncate_error(s, s.len() + 10), s);
    }

    #[test]
    fn truncate_error_handles_utf8_boundaries_without_panicking() {
        let s = "hello😅world";
        let truncated = truncate_error(s, 9);

        assert!(truncated.contains("[truncated"));
        assert!(truncated.contains("hell"));
        assert!(truncated.contains("world"));
        assert!(!truncated.contains('�'));
    }

    #[test]
    fn truncate_error_keeps_expected_ascii_edges() {
        let s = "abcdefghijklmnopqrstuvwxyz";
        let truncated = truncate_error(s, 10);

        assert!(truncated.contains("abcde"));
        assert!(truncated.contains("vwxyz"));
        assert!(truncated.contains("[truncated 16 bytes]"));
    }

    #[test]
    fn normalizes_simple_relative_path() {
        let got = normalize_relative_path(Path::new("modules/darwin/default.nix"))
            .expect("normalize should succeed");
        assert_eq!(got, PathBuf::from("modules/darwin/default.nix"));
    }

    #[test]
    fn normalizes_dots_and_internal_parents() {
        let got = normalize_relative_path(Path::new("./modules/./darwin/../home.nix"))
            .expect("normalize should succeed");
        assert_eq!(got, PathBuf::from("modules/home.nix"));
    }

    #[test]
    fn rejects_escape_outside_root() {
        let err = normalize_relative_path(Path::new("../secrets.nix"))
            .expect_err("normalize should reject escaping path");
        assert!(
            err.to_string().contains("escapes the config directory"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn rejects_absolute_path() {
        let err = normalize_relative_path(Path::new("/etc/passwd"))
            .expect_err("normalize should reject absolute path");
        assert!(
            err.to_string().contains("Absolute paths are not allowed"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn test_format_duration_secs() {
        assert_eq!(super::format_duration_secs(45), "45s");
        assert_eq!(super::format_duration_secs(75), "1m 15s");
        assert_eq!(super::format_duration_secs(3600), "1h 0m 0s");
        assert_eq!(super::format_duration_secs(3665), "1h 1m 5s");
    }
}
