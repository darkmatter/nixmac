use fancy_regex::Regex;
use log::{debug, warn};
use serde::Deserialize;
use serde_json::Value;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

use crate::commands::debug::TimerGuard;
use crate::system::re2_ascii::ascii_rewrite;

static SECRET_SCANNER: OnceLock<SecretScanner> = OnceLock::new();

#[derive(Deserialize)]
struct GitleaksConfig {
    rules: Vec<GitleaksRule>,
}

#[derive(Deserialize)]
struct GitleaksRule {
    id: String,
    regex: Option<String>,
    path: Option<String>,
}

pub struct SecretScanner {
    compiled_rules: Vec<(String, Regex)>,
    entropy_threshold: f64,
}

impl SecretScanner {
    /// Initialize the scanner singleton using the bundled Gitleaks file.
    pub fn global(app_handle: &AppHandle) -> &'static Self {
        SECRET_SCANNER.get_or_init(|| {
            let _timer = TimerGuard::new("SecretScanner::global");
            let resource_path = app_handle
                .path()
                .resource_dir()
                .or_else(|_| {
                    // Fallback: resolve from executable path
                    // Binary is at App.app/Contents/MacOS/nixmac
                    // Resources are at App.app/Contents/Resources/
                    std::env::current_exe()
                        .map_err(tauri::Error::Io)
                        .map(|exe| {
                            exe.parent()
                                .expect("binary has a parent directory (Contents/MacOS)")
                                .parent()
                                .expect("binary grandparent directory (Contents)")
                                .join("Resources")
                        })
                })
                .expect("Failed to get resource directory")
                .join("resources/gitleaks.toml");

            let toml_content = std::fs::read_to_string(resource_path)
                .expect("Could not read gitleaks.toml from bundle");

            log::info!("[secret_scanner] initialized secrets scanner");
            Self::from_toml(&toml_content)
        })
    }

    pub(crate) fn from_toml(toml_content: &str) -> Self {
        let config: GitleaksConfig = match toml::from_str(toml_content) {
            Ok(config) => config,
            Err(err) => {
                warn!("Failed to parse gitleaks config: {}", err);
                return Self {
                    compiled_rules: Vec::new(),
                    entropy_threshold: 4.5,
                };
            }
        };

        let compiled = config
            .rules
            .into_iter()
            .filter_map(|rule| {
                let regex = match rule.regex {
                    Some(regex) => regex,
                    None => {
                        // Path-only rules (e.g. pkcs12-file) match filenames, which
                        // doesn't apply to scanning JSON values.
                        if rule.path.is_none() {
                            warn!("Skipping gitleaks rule without regex: {}", rule.id);
                        }
                        return None;
                    }
                };

                // Startup fast path: skip the original compile attempt when we
                // know it fails — a failing NFA build takes ~0.3-1s per rule.
                // Purely advisory: a stale hint falls through to the normal path.
                if prefers_ascii_rewrite(&rule.id) {
                    if let Some(Ok(compiled)) = ascii_rewrite(&regex).map(|p| Regex::new(&p)) {
                        return Some((rule.id, compiled));
                    }
                }

                match Regex::new(&regex) {
                    Ok(compiled) => Some((rule.id, compiled)),
                    Err(err) => {
                        // Patterns with large bounded repetitions of `\w` blow past
                        // the regex crate's compiled-size limits. Gitleaks runs on
                        // Go's RE2 where `\w`/`\d`/`\s`/`\b` are ASCII-only, so the
                        // ASCII rewrite is exactly what gitleaks executes — and it
                        // compiles cheaply.
                        match ascii_rewrite(&regex).map(|p| Regex::new(&p)) {
                            Some(Ok(compiled)) => {
                                debug!(
                                    "Compiled ASCII rewrite for gitleaks rule: {} (original error: {})",
                                    rule.id, err
                                );
                                Some((rule.id, compiled))
                            }
                            Some(Err(rewrite_err)) => {
                                warn!(
                                    "Skipping gitleaks rule with invalid regex: {} (original: {}, ascii rewrite: {})",
                                    rule.id, err, rewrite_err
                                );
                                None
                            }
                            None => {
                                warn!(
                                    "Skipping gitleaks rule with invalid regex: {} ({})",
                                    rule.id, err
                                );
                                None
                            }
                        }
                    }
                }
            })
            .collect();

        Self {
            compiled_rules: compiled,
            entropy_threshold: 4.5,
        }
    }

    /// Recursively redacts secrets. Returns (ModifiedValue, WasChanged)
    pub fn redact_json(&self, val: Value) -> (Value, bool) {
        let mut modified_val = val;
        let mut changed = false;
        self.recursive_redact(&mut modified_val, &mut changed);
        (modified_val, changed)
    }

    fn recursive_redact(&self, val: &mut Value, changed: &mut bool) {
        match val {
            Value::String(s) => {
                let mut current_text = s.clone();
                let mut local_changed = false;

                // 1. Regex Pass using capture groups
                for (_, re) in &self.compiled_rules {
                    // While loop handles multiple secrets in a single string
                    while let Ok(Some(caps)) = re.captures(&current_text) {
                        // Gitleaks rules usually put the secret in Group 1
                        let mat = caps.get(1).or_else(|| caps.get(0)).unwrap();
                        current_text.replace_range(mat.range(), "[REDACTED]");
                        local_changed = true;
                    }
                }

                // 2. Entropy pass: scan for high-entropy tokens and redact just those spans.
                if !local_changed {
                    let (redacted, changed) = self.redact_high_entropy_tokens(&current_text);
                    if changed {
                        current_text = redacted;
                        local_changed = true;
                    }
                }

                if local_changed {
                    *s = current_text;
                    *changed = true;
                }
            }
            Value::Array(arr) => {
                for item in arr {
                    self.recursive_redact(item, changed);
                }
            }
            Value::Object(obj) => {
                // We scan and redact the VALUES of the object, not the KEYS
                for value in obj.values_mut() {
                    self.recursive_redact(value, changed);
                }
            }
            _ => (),
        }
    }

    /// Redacts a single string (like a log line).
    /// Returns (RedactedString, WasChanged)
    pub fn redact_string(&self, text: &str) -> (String, bool) {
        let mut current_text = text.to_string();
        let mut local_changed = false;

        // 1. Regex Pass using capture groups
        for (_id, re) in &self.compiled_rules {
            // Use a loop to catch multiple secrets in one line
            while let Ok(Some(caps)) = re.captures(&current_text) {
                // Gitleaks rules usually put the secret in Group 1
                let mat = caps.get(1).or_else(|| caps.get(0)).unwrap();

                // Ensure we don't get stuck in an infinite loop if the
                // replacement string also matches the regex
                let range = mat.range();
                if &current_text[range.clone()] == "[REDACTED]" {
                    break;
                }

                current_text.replace_range(range, "[REDACTED]");
                local_changed = true;
            }
        }

        // 2. Entropy pass: scan for high-entropy tokens and redact just those spans.
        if !local_changed {
            let (redacted, changed) = self.redact_high_entropy_tokens(&current_text);
            if changed {
                current_text = redacted;
                local_changed = true;
            }
        }

        (current_text, local_changed)
    }

    fn calculate_entropy(&self, s: &str) -> f64 {
        if s.is_empty() {
            return 0.0;
        }
        let mut counts = [0usize; 256];
        for &b in s.as_bytes() {
            counts[b as usize] += 1;
        }
        let len = s.len() as f64;
        counts
            .iter()
            .filter(|&&c| c > 0)
            .map(|&c| {
                let p = c as f64 / len;
                -p * p.log2()
            })
            .sum()
    }

    fn redact_high_entropy_tokens(&self, text: &str) -> (String, bool) {
        let mut output = String::with_capacity(text.len());
        let mut token_start: Option<usize> = None;
        let mut last_idx = 0;
        let mut changed = false;

        for (idx, ch) in text.char_indices() {
            if is_entropy_candidate_char(ch) {
                if token_start.is_none() {
                    token_start = Some(idx);
                }
                continue;
            }

            if let Some(start) = token_start.take() {
                output.push_str(&text[last_idx..start]);
                let token = &text[start..idx];
                if token.len() >= 16 && self.calculate_entropy(token) > self.entropy_threshold {
                    output.push_str("[REDACTED (High Entropy)]");
                    changed = true;
                } else {
                    output.push_str(token);
                }
                last_idx = idx;
            }
        }

        if let Some(start) = token_start.take() {
            output.push_str(&text[last_idx..start]);
            let token = &text[start..text.len()];
            if token.len() >= 16 && self.calculate_entropy(token) > self.entropy_threshold {
                output.push_str("[REDACTED (High Entropy)]");
                changed = true;
            } else {
                output.push_str(token);
            }
            last_idx = text.len();
        }

        if last_idx < text.len() {
            output.push_str(&text[last_idx..text.len()]);
        }

        if changed {
            (output, true)
        } else {
            (text.to_string(), false)
        }
    }
}

fn is_entropy_candidate_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '+' | '/' | '=' | '-' | '_')
}

/// Rules whose patterns are known to exceed the regex crate's NFA size limits
/// (as of the currently bundled gitleaks.toml), so compilation goes straight
/// to the ASCII rewrite. Kept exact by the `hint_list_is_exact` test; a stale
/// entry only affects startup speed, never redaction.
fn prefers_ascii_rewrite(id: &str) -> bool {
    matches!(
        id,
        "generic-api-key" | "pypi-upload-token" | "vault-batch-token"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled_scanner() -> &'static SecretScanner {
        static SCANNER: OnceLock<SecretScanner> = OnceLock::new();
        SCANNER
            .get_or_init(|| SecretScanner::from_toml(include_str!("../../resources/gitleaks.toml")))
    }

    fn bundled_config() -> GitleaksConfig {
        toml::from_str(include_str!("../../resources/gitleaks.toml")).unwrap()
    }

    #[test]
    fn no_bundled_rule_is_silently_lost() {
        let scanner = bundled_scanner();
        let ids: Vec<&str> = scanner
            .compiled_rules
            .iter()
            .map(|(id, _)| id.as_str())
            .collect();

        // Every rule with a regex must compile, via the original or the
        // ASCII rewrite. Catches gitleaks.toml bumps that introduce patterns
        // neither path can handle.
        for rule in bundled_config().rules {
            if rule.regex.is_some() {
                assert!(ids.contains(&rule.id.as_str()), "rule {} was lost", rule.id);
            } else {
                assert!(
                    !ids.contains(&rule.id.as_str()),
                    "regex-less rule {} unexpectedly compiled",
                    rule.id
                );
            }
        }
    }

    #[test]
    fn hint_list_is_exact() {
        // The fast-path hint must match reality in both directions: a hinted
        // rule whose original now compiles means the hint is removable; an
        // unhinted rule whose original fails means boot pays a slow failing
        // compile attempt and the hint list should grow. Either way, update
        // prefers_ascii_rewrite when this fails after a gitleaks.toml bump.
        for rule in bundled_config().rules {
            let Some(regex) = rule.regex else { continue };
            let original_compiles = Regex::new(&regex).is_ok();
            assert_eq!(
                original_compiles,
                !prefers_ascii_rewrite(&rule.id),
                "hint list is stale for rule {}",
                rule.id
            );
        }
    }

    #[test]
    fn redacts_previously_failing_rules() {
        let scanner = bundled_scanner();

        let pypi = format!("pypi-AgEIcHlwaS5vcmc{}", "Ab1-".repeat(15));
        let vault = format!("hvb.{}", "Ab1-".repeat(36));
        let generic = r#"api_key = "zaCELgL0imfnc8mVLWwsAawjYr4Rx""#.to_string();

        for (input, id) in [
            (format!("token: {pypi} end"), "pypi-upload-token"),
            (format!("token: {vault} end"), "vault-batch-token"),
            (generic, "generic-api-key"),
        ] {
            let (redacted, changed) = scanner.redact_string(&input);
            assert!(changed, "{id}: expected redaction in {input:?}");
            assert!(
                redacted.contains("[REDACTED]"),
                "{id}: no [REDACTED] in {redacted:?}"
            );
        }
    }
}
