//! Utilities for working with YAML documents.

use anyhow::anyhow;

/// Recursively replaces a scalar value at a slash-delimited path in a YAML document.
pub fn replace_yaml_path<'a, I>(
    current: &mut serde_yaml::Value,
    parts: &mut std::iter::Peekable<I>,
    replacement: &str,
) -> anyhow::Result<()>
where
    I: Iterator<Item = &'a str>,
{
    let part = parts
        .next()
        .filter(|part| !part.is_empty())
        .ok_or_else(|| anyhow!("SOPS key must not be empty"))?;
    let mapping = current
        .as_mapping_mut()
        .ok_or_else(|| anyhow!("SOPS key path '{part}' does not refer to a YAML mapping"))?;
    let key = serde_yaml::Value::String(part.to_string());
    let child = mapping
        .get_mut(&key)
        .ok_or_else(|| anyhow!("SOPS key path '{part}' does not exist"))?;
    if parts.peek().is_none() {
        *child = serde_yaml::Value::String(replacement.to_string());
        return Ok(());
    }
    replace_yaml_path(child, parts, replacement)
}

/// Validate basic syntax of a .yaml or .yml file using serde_yaml.
pub fn validate_yaml_syntax(content: &str, file_path: &str) -> anyhow::Result<()> {
    // Try to parse the YAML content. serde_yaml will catch syntax errors
    // like unmatched quotes, braces, brackets, etc.
    serde_yaml::from_str::<serde_yaml::Value>(content)
        .map_err(|e| anyhow::anyhow!("Syntax error in {}: {}", file_path, e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn yaml(source: &str) -> anyhow::Result<serde_yaml::Value> {
        Ok(serde_yaml::from_str(source)?)
    }

    #[test]
    fn happy_replace_yaml_path() -> anyhow::Result<()> {
        let mut doc = yaml("a:\n  b:\n    c: old_value\n    sibling: preserved\n")?;

        replace_yaml_path(&mut doc, &mut "a/b/c".split('/').peekable(), "new_value")?;

        assert_eq!(doc["a"]["b"]["c"], "new_value");
        assert_eq!(doc["a"]["b"]["sibling"], "preserved");
        Ok(())
    }

    #[test]
    fn replace_yaml_path_replaces_a_top_level_value() -> anyhow::Result<()> {
        let mut doc = yaml("secret: old\nother: preserved\n")?;

        replace_yaml_path(&mut doc, &mut "secret".split('/').peekable(), "new")?;

        assert_eq!(doc, yaml("secret: new\nother: preserved\n")?);
        Ok(())
    }

    #[test]
    fn replace_yaml_path_rejects_an_empty_path() -> anyhow::Result<()> {
        let mut doc = yaml("secret: value\n")?;

        let error = replace_yaml_path(&mut doc, &mut "".split('/').peekable(), "new")
            .expect_err("an empty path should fail");

        assert_eq!(error.to_string(), "SOPS key must not be empty");
        Ok(())
    }

    #[test]
    fn replace_yaml_path_reports_a_missing_key() -> anyhow::Result<()> {
        let mut doc = yaml("a:\n  b: value\n")?;

        let error = replace_yaml_path(&mut doc, &mut "a/missing".split('/').peekable(), "new")
            .expect_err("a missing key should fail");

        assert_eq!(error.to_string(), "SOPS key path 'missing' does not exist");
        Ok(())
    }

    #[test]
    fn replace_yaml_path_rejects_traversal_through_a_scalar() -> anyhow::Result<()> {
        let mut doc = yaml("a: value\n")?;

        let error = replace_yaml_path(&mut doc, &mut "a/b".split('/').peekable(), "new")
            .expect_err("a scalar cannot contain another key");

        assert_eq!(
            error.to_string(),
            "SOPS key path 'b' does not refer to a YAML mapping"
        );
        Ok(())
    }

    #[test]
    fn validate_yaml_syntax_accepts_valid_yaml() {
        let valid_yaml = r#"
name: test
config:
  enable: true
  items:
    - first
    - second
"#;

        super::validate_yaml_syntax(valid_yaml, "test.yaml")
            .expect("should parse valid yaml syntax");
    }

    #[test]
    fn validate_yaml_syntax_rejects_unmatched_braces() {
        let invalid_yaml = r#"
config: { unclosed: value
"#;

        let err = super::validate_yaml_syntax(invalid_yaml, "test.yaml")
            .expect_err("should reject unmatched braces");
        assert!(err.to_string().contains("Syntax error"));
    }

    #[test]
    fn validate_yaml_syntax_rejects_unclosed_string() {
        let invalid_yaml = r#"
key: "unclosed string value
"#;

        let err = super::validate_yaml_syntax(invalid_yaml, "test.yaml")
            .expect_err("should reject unclosed string");
        assert!(err.to_string().contains("Syntax error"));
    }
}
