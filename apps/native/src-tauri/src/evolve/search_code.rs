use super::utils::truncate_error;
use anyhow::{anyhow, Result};
use ignore::gitignore::Gitignore;
use log::info;
use serde_json::Value;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

// Maximum number of rg search results to return.
const MAX_SEARCH_RESULTS: usize = 50;

/// Execute a code search using ripgrep with a grep fallback.
pub fn execute_search_code(
    config_dir: &str,
    pattern: &str,
    file_pattern: Option<&str>,
    gitignore: Option<&Gitignore>,
) -> Result<String> {
    info!("Searching for pattern: {}", pattern);

    let mut cmd = Command::new("rg");
    cmd.args([
        "--json",
        "--color=never", // Disable color to simplify output parsing.
        "--text",        // Treat all files as text to avoid binary file issues.
        pattern,
    ]);
    // Do not pass --max-count here: that flag caps matches *per file*, so the
    // total output could still far exceed MAX_SEARCH_RESULTS across many files.
    // The global cap is enforced in format_rg_json_matches instead.

    // Exclude common ignored directories from ripgrep results by adding
    // negative glob patterns (e.g. `!.git/**/*`).
    for d in super::IGNORED_DIRS {
        cmd.arg("--glob").arg(format!("!{}/**/*", d));
    }

    if let Some(fp) = file_pattern {
        // Keep glob semantics for ripgrep while disallowing directory escapes.
        let fp_path = Path::new(fp);
        if fp_path.is_absolute() {
            return Err(anyhow!(
                "search_code: absolute paths are not allowed in file_pattern"
            ));
        }

        for component in fp_path.components() {
            if let Component::ParentDir = component {
                return Err(anyhow!(
                    "search_code: parent directory segments ('..') are not allowed in file_pattern"
                ));
            }
        }

        cmd.arg("--glob").arg(fp);
    }

    match cmd.current_dir(config_dir).output() {
        Ok(out) => {
            let status = out.status;
            if status.success() {
                let formatted = format_rg_json_matches(&out.stdout, gitignore);
                if formatted.is_empty() {
                    Ok("No matches found.".to_string())
                } else {
                    Ok(truncate_error(&formatted, 8000))
                }
            } else {
                match status.code() {
                    Some(1) => Ok("No matches found.".to_string()),
                    Some(code) => {
                        let stderr = String::from_utf8_lossy(&out.stderr);
                        let truncated = truncate_error(&stderr, 8000);
                        Err(anyhow!(
                            "rg exited with status code {}: {}",
                            code,
                            truncated
                        ))
                    }
                    None => {
                        let stderr = String::from_utf8_lossy(&out.stderr);
                        let truncated = truncate_error(&stderr, 8000);
                        Err(anyhow!("rg terminated by signal: {}", truncated))
                    }
                }
            }
        }
        Err(_) => {
            // Fallback to grep if rg is not available.
            let mut grep_cmd = Command::new("grep");
            grep_cmd.arg("-rn");
            grep_cmd
                .arg("--max-count")
                .arg(MAX_SEARCH_RESULTS.to_string());
            for d in super::IGNORED_DIRS {
                grep_cmd.arg(format!("--exclude-dir={}", d));
            }
            let output = grep_cmd
                .arg(pattern)
                .arg(".")
                .current_dir(config_dir)
                .output()?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            let filtered = filter_grep_matches(&stdout, gitignore);
            if filtered.trim().is_empty() {
                Ok("No matches found.".to_string())
            } else {
                Ok(truncate_error(&filtered, 8000))
            }
        }
    }
}

fn format_rg_json_matches(stdout: &[u8], gitignore: Option<&Gitignore>) -> String {
    let mut lines: Vec<String> = Vec::new();

    for json_line in String::from_utf8_lossy(stdout).lines() {
        // Enforce the global cap before processing further events.
        if lines.len() >= MAX_SEARCH_RESULTS {
            break;
        }

        let Ok(event) = serde_json::from_str::<Value>(json_line) else {
            continue;
        };

        if event["type"].as_str() != Some("match") {
            continue;
        }

        let data = &event["data"];
        let Some(path) = data["path"]["text"].as_str() else {
            continue;
        };

        if is_ignored_match(path, false, gitignore) {
            continue;
        }

        let line_number = data["line_number"].as_u64().unwrap_or(0);
        let match_text = data["lines"]["text"]
            .as_str()
            .unwrap_or_default()
            .trim_end_matches(['\n', '\r']);

        lines.push(format!("{}:{}:{}", path, line_number, match_text));
    }

    lines.join("\n")
}

fn filter_grep_matches(stdout: &str, gitignore: Option<&Gitignore>) -> String {
    let mut lines: Vec<String> = Vec::new();

    for line in stdout.lines() {
        if lines.len() >= MAX_SEARCH_RESULTS {
            break;
        }

        let mut parts = line.rsplitn(3, ':');
        let Some(_text) = parts.next() else {
            continue;
        };
        let Some(line_no) = parts.next() else {
            continue;
        };
        let Some(path) = parts.next() else {
            continue;
        };

        if line_no.parse::<u64>().is_err() {
            continue;
        }

        if is_ignored_match(path, false, gitignore) {
            continue;
        }

        lines.push(line.to_string());
    }

    lines.join("\n")
}

fn is_ignored_match(path: &str, is_dir: bool, gitignore: Option<&Gitignore>) -> bool {
    let rel = normalize_match_path(path);
    super::gitignore::is_ignored_by_matcher(gitignore, &rel, is_dir)
}

fn normalize_match_path(path: &str) -> PathBuf {
    let raw = Path::new(path);
    let rel = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        PathBuf::from(path.trim_start_matches("./"))
    };

    super::utils::normalize_relative_path(&rel).unwrap_or(rel)
}

#[cfg(test)]
mod tests {
    use super::{execute_search_code, filter_grep_matches};
    use crate::evolve::gitignore::load_gitignore_matcher;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn search_code_skips_files_ignored_by_base_gitignore() {
        let tmp = tempdir().expect("tempdir");
        fs::write(tmp.path().join(".gitignore"), "secret.txt\n").expect("write .gitignore");
        fs::write(tmp.path().join("visible.txt"), "NEEDLE").expect("write visible file");
        fs::write(tmp.path().join("secret.txt"), "NEEDLE").expect("write secret file");
        let gitignore_matcher = load_gitignore_matcher(tmp.path()).expect("load matcher");

        let output = execute_search_code(
            tmp.path().to_str().expect("utf-8 path"),
            "NEEDLE",
            None,
            gitignore_matcher.as_ref(),
        )
        .expect("search should succeed");

        assert!(output.contains("visible.txt"), "output: {output}");
        assert!(!output.contains("secret.txt"), "output: {output}");
    }

    #[test]
    fn search_code_respects_gitignore_even_with_file_pattern() {
        let tmp = tempdir().expect("tempdir");
        fs::write(tmp.path().join(".gitignore"), "secret.txt\n").expect("write .gitignore");
        fs::write(tmp.path().join("secret.txt"), "NEEDLE").expect("write secret file");
        let gitignore_matcher = load_gitignore_matcher(tmp.path()).expect("load matcher");

        let output = execute_search_code(
            tmp.path().to_str().expect("utf-8 path"),
            "NEEDLE",
            Some("secret.txt"),
            gitignore_matcher.as_ref(),
        )
        .expect("search should succeed");

        assert_eq!(output, "No matches found.");
    }

    #[test]
    fn search_code_skips_files_ignored_by_subdir_gitignore() {
        let tmp = tempdir().expect("tempdir");
        fs::create_dir_all(tmp.path().join("nested")).expect("make nested dir");
        fs::write(tmp.path().join("nested/.gitignore"), "secret.txt\n")
            .expect("write nested .gitignore");
        fs::write(tmp.path().join("nested/visible.txt"), "NEEDLE")
            .expect("write nested visible file");
        fs::write(tmp.path().join("nested/secret.txt"), "NEEDLE")
            .expect("write nested secret file");
        let gitignore_matcher = load_gitignore_matcher(tmp.path()).expect("load matcher");

        let output = execute_search_code(
            tmp.path().to_str().expect("utf-8 path"),
            "NEEDLE",
            None,
            gitignore_matcher.as_ref(),
        )
        .expect("search should succeed");

        assert!(output.contains("nested/visible.txt"), "output: {output}");
        assert!(!output.contains("nested/secret.txt"), "output: {output}");
    }

    #[test]
    fn grep_fallback_parser_handles_colons_in_filename() {
        let stdout = "dir:with:colon/file.txt:12:match text\ndir/file.txt:not-a-line:ignored\n";

        let output = filter_grep_matches(stdout, None);

        assert!(
            output.contains("dir:with:colon/file.txt:12:match text"),
            "output: {output}"
        );
        assert!(
            !output.contains("dir/file.txt:not-a-line:ignored"),
            "output: {output}"
        );
    }
}
