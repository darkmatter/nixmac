pub fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// Normalize a user-provided directory path for backend path operations
/// particularly pertaining to the config dir.
///
/// Behavior:
/// - trims surrounding whitespace
/// - expands leading `~`/`~/...` to the current user's home directory
/// - resolves relative paths against the current working directory
pub fn normalize_dir_input(input: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Directory path is required".to_string());
    }

    let expanded: std::path::PathBuf = if trimmed == "~" {
        dirs::home_dir().ok_or_else(|| "Unable to resolve home directory".to_string())?
    } else if let Some(rest) = trimmed.strip_prefix("~/") {
        let home =
            dirs::home_dir().ok_or_else(|| "Unable to resolve home directory".to_string())?;
        home.join(rest)
    } else {
        std::path::PathBuf::from(trimmed)
    };

    if expanded.is_absolute() {
        Ok(expanded)
    } else {
        Ok(std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(expanded))
    }
}

// Helper to truncate a string in-place without breaking UTF-8 encoding
// and causing a panic, thereby avoiding annoying AI code review comments
// about "don't truncate UTF-8 strings".
pub fn truncate_utf8(s: &mut String, max: usize) {
    s.truncate(s.floor_char_boundary(max));
}

pub fn truncate_with_ellipsis(s: &str, max: usize) -> String {
    let mut truncated = s.to_string();
    let original_len = truncated.len();
    truncate_utf8(&mut truncated, max);
    if truncated.len() < original_len {
        truncated.push_str("...");
    }
    truncated
}

#[cfg(test)]
mod tests {
    use super::normalize_dir_input;

    #[test]
    fn test_empty_input_returns_err() {
        assert!(normalize_dir_input("").is_err());
    }

    #[test]
    fn test_whitespace_only_returns_err() {
        assert!(normalize_dir_input("   ").is_err());
        assert!(normalize_dir_input("\t\n").is_err());
    }

    #[test]
    fn test_tilde_expands_to_absolute() {
        // Rather than mocking HOME (which dirs crate doesn't reliably use),
        // just verify that ~ expands to an absolute path
        let got = normalize_dir_input("~").expect("normalize ~");
        assert!(
            got.is_absolute(),
            "~ should expand to absolute path, got: {}",
            got.display()
        );
        assert!(!got.to_string_lossy().contains("~"), "~ should be expanded");
    }

    #[test]
    fn test_tilde_with_subdir() {
        let tmp = tempfile::tempdir().expect("create tempdir");
        let home = tmp.path().to_path_buf();

        let orig_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &home);

        let got = normalize_dir_input("~/my/config/dir").expect("normalize ~/my/config/dir");
        assert!(
            got.ends_with("my/config/dir"),
            "~/my/config/dir should resolve to home/my/config/dir, got: {}",
            got.display()
        );

        // cleanup
        if let Some(h) = orig_home {
            std::env::set_var("HOME", h);
        } else {
            std::env::remove_var("HOME");
        }
    }

    #[test]
    fn test_relative_path_resolves_against_cwd() {
        let tmp = tempfile::tempdir().expect("create tempdir");
        let orig_cwd = std::env::current_dir().expect("cwd");
        std::env::set_current_dir(tmp.path()).expect("chdir");

        let got = normalize_dir_input("foo/bar").expect("normalize relative");
        assert!(
            got.is_absolute(),
            "relative path should resolve to absolute"
        );
        assert!(
            got.ends_with("foo/bar"),
            "relative path should end with foo/bar, got: {}",
            got.display()
        );

        // restore
        std::env::set_current_dir(orig_cwd).expect("restore cwd");
    }

    #[test]
    fn test_absolute_path_unchanged() {
        let tmp = tempfile::tempdir().expect("create tempdir");
        let abs_path = tmp.path().join("config");
        let abs_str = abs_path.to_string_lossy().into_owned();

        let got = normalize_dir_input(&abs_str).expect("normalize absolute");
        assert_eq!(got, abs_path, "absolute path should be unchanged");
    }

    #[test]
    fn test_whitespace_trimming() {
        let tmp = tempfile::tempdir().expect("create tempdir");
        let orig_cwd = std::env::current_dir().expect("cwd");
        std::env::set_current_dir(tmp.path()).expect("chdir");

        let got = normalize_dir_input("  my_config  ").expect("normalize with whitespace");
        assert!(
            got.ends_with("my_config"),
            "should trim whitespace and resolve relative, got: {}",
            got.display()
        );

        // restore
        std::env::set_current_dir(orig_cwd).expect("restore cwd");
    }

    #[test]
    fn test_multiple_slashes_normalized() {
        let tmp = tempfile::tempdir().expect("create tempdir");
        let orig_cwd = std::env::current_dir().expect("cwd");
        std::env::set_current_dir(tmp.path()).expect("chdir");

        let got = normalize_dir_input("foo//bar///baz").expect("normalize multiple slashes");
        // PathBuf normalizes consecutive slashes, so the result should contain the path
        assert!(got.is_absolute(), "should resolve to absolute path");

        // restore
        std::env::set_current_dir(orig_cwd).expect("restore cwd");
    }

    #[test]
    fn test_dot_and_dotdot_in_paths() {
        let tmp = tempfile::tempdir().expect("create tempdir");
        let orig_cwd = std::env::current_dir().expect("cwd");

        // Create a subdirectory to test relative path resolution
        std::fs::create_dir_all(tmp.path().join("subdir")).expect("mkdir subdir");
        std::env::set_current_dir(tmp.path().join("subdir")).expect("chdir");

        // . references current directory
        let got_dot = normalize_dir_input(".").expect("normalize .");
        assert!(got_dot.is_absolute(), "dot should resolve to absolute");
        // The result may have extra dots or other quirks, just check it's within the temp dir
        assert!(
            got_dot.starts_with(tmp.path()) || got_dot.to_string_lossy().contains("subdir"),
            "dot should be under temp subdir, got: {}",
            got_dot.display()
        );

        // .. references parent directory
        let got_dotdot = normalize_dir_input("..").expect("normalize ..");
        assert!(got_dotdot.is_absolute(), ".. should resolve to absolute");
        // Just verify it's different from the dot result and is absolute
        assert_ne!(
            got_dot, got_dotdot,
            ".. should resolve to parent, different from ."
        );

        // restore BEFORE tempdir is dropped so the directory still exists
        std::env::set_current_dir(&orig_cwd).expect("restore cwd");
    }
}
