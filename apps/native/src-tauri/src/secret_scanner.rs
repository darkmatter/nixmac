use fancy_regex::Regex;
use log::warn;
use serde::Deserialize;
use serde_json::Value;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

static SECRET_SCANNER: OnceLock<SecretScanner> = OnceLock::new();

#[derive(Deserialize)]
struct GitleaksConfig {
    rules: Vec<GitleaksRule>,
}

#[derive(Deserialize)]
struct GitleaksRule {
    id: String,
    regex: Option<String>,
}

pub struct SecretScanner {
    compiled_rules: Vec<(String, Regex)>,
    entropy_threshold: f64,
}

impl SecretScanner {
    /// Initialize the scanner singleton using the bundled Gitleaks file.
    pub fn global(app_handle: &AppHandle) -> &'static Self {
        SECRET_SCANNER.get_or_init(|| {
            let resource_path = app_handle
                .path()
                .resource_dir()
                .or_else(|_| {
                    // Fallback: resolve from executable path
                    // Binary is at App.app/Contents/MacOS/nixmac
                    // Resources are at App.app/Contents/Resources/
                    std::env::current_exe()
                        .map_err(tauri::Error::Io)
                        .map(|exe| exe.parent().unwrap().parent().unwrap().join("Resources"))
                })
                .expect("Failed to get resource directory")
                .join("resources/gitleaks.toml");

            let toml_content = std::fs::read_to_string(resource_path)
                .expect("Could not read gitleaks.toml from bundle");

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
                        warn!("Skipping gitleaks rule without regex: {}", rule.id);
                        return None;
                    }
                };

                match Regex::new(&regex) {
                    Ok(compiled) => Some((rule.id, compiled)),
                    Err(err) => {
                        if let Some(fallback) = fallback_regex_for(&rule.id) {
                            match Regex::new(fallback) {
                                Ok(compiled) => {
                                    warn!(
                                        "Using fallback regex for gitleaks rule: {} (original error: {})",
                                        rule.id, err
                                    );
                                    Some((rule.id, compiled))
                                }
                                Err(fallback_err) => {
                                    warn!(
                                        "Skipping gitleaks rule with invalid regex: {} (original: {}, fallback: {})",
                                        rule.id, err, fallback_err
                                    );
                                    None
                                }
                            }
                        } else {
                            warn!(
                                "Skipping gitleaks rule with invalid regex: {} ({})",
                                rule.id, err
                            );
                            None
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

fn fallback_regex_for(id: &str) -> Option<&'static str> {
    match id {
        // Broad, simpler fallback for generic API-style secrets since the ones in gitleaks have very complex regexes that can fail to compile in Rust.
        // This is a best-effort backup to catch obvious secrets without crashing the scanner.
        "generic-api-key" => Some(
            r#"(?i)(?:access|auth|api|credential|creds|key|password|secret|token)[\w .-]{0,20}[:=][ \t\"']{0,5}([A-Za-z0-9_\-]{12,})"#,
        ),
        "pypi-upload-token" => Some(r#"pypi-AgEIcHlwaS5vcmc[\w-]{50,}"#),
        "vault-batch-token" => Some(r#"\bhvb\.[A-Za-z0-9+/=]{20,}"#),
        _ => None,
    }
}
