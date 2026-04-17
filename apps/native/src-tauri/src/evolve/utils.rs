//! Common utilities for the evolve module

use anyhow::{anyhow, Result};
use std::path::{Component, Path, PathBuf};

/// Truncate error output to a maximum length, keeping the most relevant parts
pub fn truncate_error(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        return s.to_string();
    }

    // Keep the beginning and end, which usually have the most relevant info
    let half = max_len / 2;
    let start = &s[..half];
    let end = &s[s.len() - half..];

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
    use super::normalize_relative_path;
    use std::path::{Path, PathBuf};

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
}
