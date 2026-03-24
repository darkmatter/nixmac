use super::utils::truncate_error;
use anyhow::{anyhow, Result};
use log::info;
use serde_json::Value;
use std::path::{Component, Path};
use std::process::Command;

// Maximum number of rg search results to return.
const MAX_SEARCH_RESULTS: usize = 50;

/// Execute a code search using ripgrep with a grep fallback.
pub fn execute_search_code(
    config_dir: &str,
    pattern: &str,
    file_pattern: Option<&str>,
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
                let formatted = format_rg_json_matches(&out.stdout);
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
            Ok(truncate_error(&stdout, 8000))
        }
    }
}

fn format_rg_json_matches(stdout: &[u8]) -> String {
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

        let line_number = data["line_number"].as_u64().unwrap_or(0);
        let match_text = data["lines"]["text"]
            .as_str()
            .unwrap_or_default()
            .trim_end_matches(['\n', '\r']);

        lines.push(format!("{}:{}:{}", path, line_number, match_text));
    }

    lines.join("\n")
}
