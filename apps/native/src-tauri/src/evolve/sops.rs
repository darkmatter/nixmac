use anyhow::{anyhow, Context, Result};
use crate::evolve::file_ops::resolve_path_in_dir_allow_create;
use serde_yaml::{Mapping, Sequence, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

const DEFAULT_SOPS_CONFIG_FILENAME: &str = ".sops.yaml";
const FALLBACK_SOPS_CONFIG_FILENAME: &str = "sops.yaml";

/// The path_regex value used in the nixmac-managed creation rule.
const MANAGED_PATH_REGEX: &str = r"secrets/.*\.yaml";

/// Ensure a SOPS config exists in the config root and contains the managed creation rule.
///
/// If the config already exists, the managed `secrets/.*\.yaml` rule is merged in
/// without clobbering other rules, recipients, or key groups.
pub fn ensure_sops_config(base: &Path, public_key: &str) -> Result<PathBuf> {
    let config_path = resolve_sops_config_path(base);

    let content = if config_path.exists() {
        let existing = std::fs::read_to_string(&config_path).with_context(|| {
            format!(
                "Failed to read existing SOPS config at {}",
                config_path.display()
            )
        })?;
        merge_sops_config(&existing, public_key)?
    } else {
        render_sops_config(public_key)
    };

    std::fs::write(&config_path, &content).with_context(|| {
        format!(
            "Failed to write SOPS config at {}",
            config_path.to_string_lossy()
        )
    })?;

    Ok(config_path)
}

fn resolve_sops_config_path(base: &Path) -> PathBuf {
    if base.join(DEFAULT_SOPS_CONFIG_FILENAME).exists() {
        base.join(DEFAULT_SOPS_CONFIG_FILENAME)
    } else if base.join(FALLBACK_SOPS_CONFIG_FILENAME).exists() {
        base.join(FALLBACK_SOPS_CONFIG_FILENAME)
    } else {
        base.join(DEFAULT_SOPS_CONFIG_FILENAME)
    }
}

/// Merge `public_key` into the managed `secrets/.*\.yaml` creation rule.
///
/// Uses YAML parsing so updates are structure-aware and do not replace unrelated
/// recipients, key groups, or other rules. Preserves comments by attempting simple
/// placeholder replacement first before re-serialization.
///
/// # Cases handled
/// * Key already present in the managed rule → no-op, original returned as-is.
/// * Managed rule exists but key is missing → key added to the rule's `age:` list.
/// * No managed rule, `creation_rules:` exists → managed rule appended to the list.
/// * No `creation_rules:` at all → section + rule appended to the file.
fn merge_sops_config(existing: &str, public_key: &str) -> Result<String> {
    // Attempt a simple string replacement for the placeholder. This preserves comments
    // and structure for the common case of merging into a template.
    if existing.contains("AGE_PUBLIC_KEY_PLACEHOLDER") {
        if let Ok(result) = try_simple_placeholder_replacement(existing, public_key) {
            return Ok(result);
        }
    }

    let mut doc = parse_sops_document(existing)?;
    let rules = ensure_creation_rules_sequence(&mut doc)?;

    let changed = if let Some(rule) = find_managed_rule_mut(rules) {
        ensure_age_recipient(rule, public_key)?
    } else {
        rules.push(build_managed_rule(public_key));
        true
    };

    // Preserve the file verbatim if the managed rule already contained this key.
    if !changed {
        return Ok(existing.to_string());
    }

    let mut rendered = serde_yaml::to_string(&doc).context("Failed to serialize SOPS config")?;
    if existing.ends_with('\n') && !rendered.ends_with('\n') {
        rendered.push('\n');
    }
    if !existing.ends_with('\n') && rendered.ends_with('\n') {
        rendered.pop();
    }
    Ok(rendered)
}

/// Attempt to replace `AGE_PUBLIC_KEY_PLACEHOLDER` via simple string replacement.
/// This preserves comments and file structure for the common case of template initialization.
/// Returns Ok only if exactly one replacement was made; otherwise returns Err to fall back to YAML parsing.
fn try_simple_placeholder_replacement(existing: &str, public_key: &str) -> Result<String> {
    let placeholder_count = existing.matches("AGE_PUBLIC_KEY_PLACEHOLDER").count();

    // Only use simple replacement if there's exactly one placeholder.
    if placeholder_count != 1 {
        return Err(anyhow!(
            "Expected exactly one placeholder, found {}",
            placeholder_count
        ));
    }

    Ok(existing.replace("AGE_PUBLIC_KEY_PLACEHOLDER", public_key))
}

fn parse_sops_document(existing: &str) -> Result<Value> {
    if existing.trim().is_empty() {
        return Ok(Value::Mapping(Mapping::new()));
    }

    let doc: Value = serde_yaml::from_str(existing).context("Failed to parse SOPS config YAML")?;
    match doc {
        Value::Mapping(_) | Value::Null => Ok(doc),
        _ => Err(anyhow!("SOPS config root must be a YAML mapping object")),
    }
}

fn ensure_creation_rules_sequence(doc: &mut Value) -> Result<&mut Sequence> {
    if doc.is_null() {
        *doc = Value::Mapping(Mapping::new());
    }

    let root = doc
        .as_mapping_mut()
        .ok_or_else(|| anyhow!("SOPS config root must be a YAML mapping object"))?;

    let key = Value::String("creation_rules".to_string());
    if !root.contains_key(&key) {
        root.insert(key.clone(), Value::Sequence(Sequence::new()));
    }

    let entry = root
        .get_mut(&key)
        .ok_or_else(|| anyhow!("Failed to access `creation_rules` in SOPS config"))?;
    if entry.is_null() {
        *entry = Value::Sequence(Sequence::new());
    }

    entry
        .as_sequence_mut()
        .ok_or_else(|| anyhow!("`creation_rules` must be a YAML sequence"))
}

fn find_managed_rule_mut(rules: &mut Sequence) -> Option<&mut Mapping> {
    let key = Value::String("path_regex".to_string());
    for rule in rules.iter_mut() {
        if let Some(map) = rule.as_mapping_mut() {
            if let Some(path_regex) = map.get(&key).and_then(|v| v.as_str()) {
                if path_regex == MANAGED_PATH_REGEX {
                    return Some(map);
                }
            }
        }
    }
    None
}

fn ensure_age_recipient(rule: &mut Mapping, public_key: &str) -> Result<bool> {
    let key = Value::String("age".to_string());
    if !rule.contains_key(&key) {
        rule.insert(
            key,
            Value::Sequence(vec![Value::String(public_key.to_string())]),
        );
        return Ok(true);
    }

    let age = rule
        .get_mut(&Value::String("age".to_string()))
        .ok_or_else(|| anyhow!("Failed to access `age` in managed SOPS creation rule"))?;

    match age {
        Value::Sequence(recipients) => {
            // If the sequence contains the placeholder, replace it entirely.
            if recipients
                .iter()
                .any(|v| matches!(v, Value::String(s) if s == "AGE_PUBLIC_KEY_PLACEHOLDER"))
            {
                *recipients = vec![Value::String(public_key.to_string())];
                return Ok(true);
            }

            // If the key already exists, no change needed.
            if recipients
                .iter()
                .any(|v| matches!(v, Value::String(s) if s == public_key))
            {
                Ok(false)
            } else {
                // Key is missing, append it.
                recipients.push(Value::String(public_key.to_string()));
                Ok(true)
            }
        }
        Value::String(existing) => {
            // If it's a placeholder, replace it.
            if existing == "AGE_PUBLIC_KEY_PLACEHOLDER" {
                *age = Value::String(public_key.to_string());
                Ok(true)
            } else if existing == public_key {
                Ok(false)
            } else {
                let prior = existing.clone();
                *age = Value::Sequence(vec![
                    Value::String(prior),
                    Value::String(public_key.to_string()),
                ]);
                Ok(true)
            }
        }
        Value::Null => {
            *age = Value::Sequence(vec![Value::String(public_key.to_string())]);
            Ok(true)
        }
        _ => Err(anyhow!(
            "Managed SOPS rule has unsupported `age` type; expected sequence or string"
        )),
    }
}

fn build_managed_rule(public_key: &str) -> Value {
    let mut rule = Mapping::new();
    rule.insert(
        Value::String("path_regex".to_string()),
        Value::String(MANAGED_PATH_REGEX.to_string()),
    );
    rule.insert(
        Value::String("age".to_string()),
        Value::Sequence(vec![Value::String(public_key.to_string())]),
    );
    Value::Mapping(rule)
}

/// Ensure the encrypted secret file exists at secrets/<name>.yaml.
pub fn ensure_secret_file(
    base: &Path,
    secret_relative_path: &str,
    initial_content: Option<&str>,
) -> Result<PathBuf> {
    let full_path = resolve_path_in_dir_allow_create(base, secret_relative_path)
        .with_context(|| format!("Invalid secret path '{}'", secret_relative_path))?;

    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed to create secret directory {}",
                parent.to_string_lossy()
            )
        })?;
    }

    if !full_path.exists() {
        let initial = initial_content.unwrap_or("value: \"\"\n");
        std::fs::write(&full_path, initial).with_context(|| {
            format!(
                "Failed to create initial secret file at {}",
                full_path.to_string_lossy()
            )
        })?;
    }

    Ok(full_path)
}

/// Force the file into valid encrypted state using SOPS.
pub fn encrypt_in_place(
    base: &Path,
    secret_relative_path: &str,
    age_key_file: &Path,
) -> Result<()> {
    let output = Command::new("sops")
        .arg("--encrypt")
        .arg("--in-place")
        .arg(secret_relative_path)
        .env("SOPS_AGE_KEY_FILE", age_key_file)
        .current_dir(base)
        .output()
        .context("Failed to run sops --encrypt --in-place. Ensure sops is installed")?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(anyhow!(
        "sops --encrypt --in-place failed for {} (SOPS_AGE_KEY_FILE={}): {}",
        secret_relative_path,
        age_key_file.display(),
        stderr.trim()
    ))
}

/// Open a blocking SOPS editor session. SOPS handles decrypt/edit/re-encrypt.
pub fn edit_secret_blocking(
    base: &Path,
    secret_relative_path: &str,
    age_key_file: &Path,
) -> Result<()> {
    let status = Command::new("sops")
        .arg(secret_relative_path)
        .env("SOPS_AGE_KEY_FILE", age_key_file)
        .current_dir(base)
        .status()
        .context("Failed to run sops editor session")?;

    if status.success() {
        return Ok(());
    }

    Err(anyhow!(
        "sops editor session failed for {} (SOPS_AGE_KEY_FILE={})",
        secret_relative_path,
        age_key_file.display()
    ))
}

fn render_sops_config(public_key: &str) -> String {
    format!(
        "creation_rules:\n  - path_regex: {}\n    age:\n      - {}\n",
        MANAGED_PATH_REGEX, public_key
    )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::TempDir;

    const KEY_A: &str = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq0lkg3";
    const KEY_B: &str = "age1rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr0lkg4";

    // merge_sops_config — key already present
    #[test]
    fn noop_when_key_already_present() {
        let existing = format!(
            "creation_rules:\n  - path_regex: {MANAGED_PATH_REGEX}\n    age:\n      - {KEY_A}\n"
        );
        let result = merge_sops_config(&existing, KEY_A).unwrap();
        assert_eq!(result, existing);
    }

    // merge_sops_config — key missing from existing managed rule
    #[test]
    fn adds_key_to_existing_age_list() {
        let existing = format!(
            "creation_rules:\n  - path_regex: {MANAGED_PATH_REGEX}\n    age:\n      - {KEY_A}\n"
        );
        let result = merge_sops_config(&existing, KEY_B).unwrap();
        // Both keys must be present.
        assert!(result.contains(KEY_A), "existing key should be preserved");
        assert!(result.contains(KEY_B), "new key should be added");
        // The managed rule must still exist.
        assert!(result.contains(MANAGED_PATH_REGEX));
    }

    #[test]
    fn adds_key_when_rule_has_no_age_section() {
        let existing = format!("creation_rules:\n  - path_regex: {MANAGED_PATH_REGEX}\n");
        let result = merge_sops_config(&existing, KEY_A).unwrap();
        assert!(result.contains("age:"));
        assert!(result.contains(KEY_A));
        assert!(result.contains(MANAGED_PATH_REGEX));
    }

    // merge_sops_config — no managed rule in file
    #[test]
    fn appends_managed_rule_when_absent() {
        let existing = format!(
            "creation_rules:\n  - path_regex: other/.*\\.yaml\n    age:\n      - {KEY_A}\n"
        );
        let result = merge_sops_config(&existing, KEY_B).unwrap();
        // Original rule must be preserved.
        assert!(
            result.contains("other/.*\\.yaml"),
            "other rule should be preserved"
        );
        assert!(
            result.contains(KEY_A),
            "other rule's key should be preserved"
        );
        // Managed rule must be appended.
        assert!(result.contains(MANAGED_PATH_REGEX));
        assert!(result.contains(KEY_B));
    }

    #[test]
    fn creates_creation_rules_section_when_absent() {
        let existing = "keys:\n  - age1xxx\n";
        let result = merge_sops_config(existing, KEY_A).unwrap();
        assert!(result.contains("creation_rules:"));
        assert!(result.contains(MANAGED_PATH_REGEX));
        assert!(result.contains(KEY_A));
        assert!(result.contains("keys:"));
    }

    // merge_sops_config — preserves other rules untouched
    #[test]
    fn preserves_other_rules_and_keys_verbatim() {
        let existing = [
            "creation_rules:",
            "  - path_regex: infrastructure/.*\\.yaml",
            "    key_groups:",
            "      - age:",
            &format!("          - {KEY_A}"),
            "        pgp:",
            "          - fingerprint123",
            &format!("  - path_regex: {MANAGED_PATH_REGEX}"),
            "    age:",
            &format!("      - {KEY_A}"),
            "",
        ]
        .join("\n");

        let result = merge_sops_config(&existing, KEY_B).unwrap();

        // Other rule must be verbatim.
        assert!(result.contains("infrastructure/.*\\.yaml"));
        assert!(result.contains("key_groups:"));
        assert!(result.contains("fingerprint123"));
        // Managed rule must now also include KEY_B.
        assert!(result.contains(KEY_B));
        // KEY_A must still be present (both as other rule recipient and managed rule).
        assert_eq!(result.matches(KEY_A).count(), 2);
    }

    #[test]
    fn preserves_trailing_newline() {
        let existing = format!(
            "creation_rules:\n  - path_regex: {MANAGED_PATH_REGEX}\n    age:\n      - {KEY_A}\n"
        );
        let result = merge_sops_config(&existing, KEY_B).unwrap();
        assert!(result.ends_with('\n'));
    }

    #[test]
    fn preserves_no_trailing_newline() {
        let existing = format!(
            "creation_rules:\n  - path_regex: {MANAGED_PATH_REGEX}\n    age:\n      - {KEY_A}"
        );
        let result = merge_sops_config(&existing, KEY_B).unwrap();
        assert!(!result.ends_with('\n'));
    }

    // ensure_sops_config — filesystem integration
    #[test]
    fn creates_fresh_config_when_missing() -> Result<()> {
        let dir = TempDir::new()?;
        let path = ensure_sops_config(dir.path(), KEY_A)?;
        let content = std::fs::read_to_string(&path)?;
        assert!(content.contains(KEY_A));
        assert!(content.contains(MANAGED_PATH_REGEX));
        Ok(())
    }

    #[test]
    fn does_not_clobber_existing_config() -> Result<()> {
        let dir = TempDir::new()?;
        // Write a config that already has an extra rule and a comment.
        let initial = format!(
            "# managed by nixmac\ncreation_rules:\n  - path_regex: other/.*\\.yaml\n    age:\n      - {KEY_B}\n  - path_regex: {MANAGED_PATH_REGEX}\n    age:\n      - {KEY_A}\n"
        );
        let config_path = dir.path().join(".sops.yaml");
        std::fs::write(&config_path, &initial)?;

        // ensure_sops_config with the same key — should be a no-op.
        ensure_sops_config(dir.path(), KEY_A)?;
        let after = std::fs::read_to_string(&config_path)?;
        assert_eq!(after, initial, "file should be unchanged");
        Ok(())
    }

    #[test]
    fn merges_new_key_into_existing_config() -> Result<()> {
        let dir = TempDir::new()?;
        let initial = format!(
            "creation_rules:\n  - path_regex: {MANAGED_PATH_REGEX}\n    age:\n      - {KEY_A}\n"
        );
        let config_path = dir.path().join(".sops.yaml");
        std::fs::write(&config_path, &initial)?;

        ensure_sops_config(dir.path(), KEY_B)?;
        let after = std::fs::read_to_string(&config_path)?;
        assert!(after.contains(KEY_A), "original key must be preserved");
        assert!(after.contains(KEY_B), "new key must be added");
        Ok(())
    }

    #[test]
    fn prefers_dot_sops_yaml_over_sops_yaml() -> Result<()> {
        let dir = TempDir::new()?;
        // Create both files.
        std::fs::write(dir.path().join(".sops.yaml"), "creation_rules:\n")?;
        std::fs::write(dir.path().join("sops.yaml"), "creation_rules:\n")?;

        let path = ensure_sops_config(dir.path(), KEY_A)?;
        assert_eq!(path.file_name().unwrap(), ".sops.yaml");
        Ok(())
    }

    #[test]
    fn replaces_placeholder_in_managed_rule() {
        let existing = format!(
            "creation_rules:\n  - path_regex: {MANAGED_PATH_REGEX}\n    age:\n      - AGE_PUBLIC_KEY_PLACEHOLDER\n"
        );
        let result = merge_sops_config(&existing, KEY_A).unwrap();
        assert!(result.contains(KEY_A), "placeholder should be replaced with actual key");
        assert!(
            !result.contains("AGE_PUBLIC_KEY_PLACEHOLDER"),
            "placeholder should be completely removed"
        );
    }

    #[test]
    fn replaces_placeholder_when_age_is_string() {
        let existing = format!(
            "creation_rules:\n  - path_regex: {MANAGED_PATH_REGEX}\n    age: AGE_PUBLIC_KEY_PLACEHOLDER\n"
        );
        let result = merge_sops_config(&existing, KEY_A).unwrap();
        assert!(result.contains(KEY_A), "placeholder string should be replaced with actual key");
        assert!(
            !result.contains("AGE_PUBLIC_KEY_PLACEHOLDER"),
            "placeholder should be completely removed"
        );
    }

    #[test]
    fn matches_template_regex_format() -> Result<()> {
        let dir = TempDir::new()?;
        // Simulate the template format with anchors (old style)
        let template_with_anchors = format!(
            "creation_rules:\n  - path_regex: ^secrets/.*\\.yaml$\n    age:\n      - AGE_PUBLIC_KEY_PLACEHOLDER\n"
        );
        let config_path = dir.path().join(".sops.yaml");
        std::fs::write(&config_path, &template_with_anchors)?;

        // Call ensure_sops_config with a real key - should replace the placeholder
        ensure_sops_config(dir.path(), KEY_A)?;
        let after = std::fs::read_to_string(&config_path)?;

        assert!(
            after.contains(KEY_A),
            "real key should be in config after ensure_sops_config"
        );
        // The template with anchors should still be there (old rule), but a new rule without anchors
        // should have been added (or the existing placeholder should be replaced)
        assert!(
            !after.contains("AGE_PUBLIC_KEY_PLACEHOLDER"),
            "placeholder should never remain after ensure_sops_config"
        );
        Ok(())
    }

    #[test]
    fn ensure_secret_file_rejects_parent_traversal() {
        let dir = TempDir::new().expect("create temp dir");
        let err = ensure_secret_file(dir.path(), "../escape.yaml", Some("value: \"\"\n"))
            .expect_err("expected traversal path to be rejected");

        let err_chain = format!("{err:#}");
        assert!(
            err_chain.contains("Invalid secret path") || err_chain.contains("outside config_dir"),
            "unexpected error: {err_chain}"
        );
    }

    #[test]
    fn ensure_secret_file_rejects_absolute_path() {
        let dir = TempDir::new().expect("create temp dir");
        let absolute = std::env::temp_dir().join("nixmac-absolute-secret-test.yaml");
        let absolute_str = absolute
            .to_str()
            .expect("absolute temp path should be valid utf-8");

        let err = ensure_secret_file(dir.path(), absolute_str, Some("value: \"\"\n"))
            .expect_err("expected absolute path to be rejected");

        let err_chain = format!("{err:#}");
        assert!(
            err_chain.contains("Invalid secret path") || err_chain.contains("outside config_dir"),
            "unexpected error: {err_chain}"
        );

        if Path::new(absolute_str).exists() {
            let _ = std::fs::remove_file(absolute_str);
        }
    }
}
