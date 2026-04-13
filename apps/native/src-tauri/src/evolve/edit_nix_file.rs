use crate::evolve::types::SemanticFileEdit;
use anyhow::{Context, Result};
use log::{debug, info};
use rnix::ast::{AttrSet, List};
use rnix::SyntaxNode;
use rnix::{Parse, Root};
use rowan::ast::AstNode;
use rowan::{TextRange, TextSize};
use std::path::Path;

use crate::evolve::file_ops::rewrite_existing_file_in_dir;
use crate::evolve::types::FileEditAction;

/// Internal marker key used in JSON edit payloads to request a raw Nix path literal.
///
/// This lets tools pass values like `../../secrets/foo.yaml` without quoting, while still
/// keeping the action payload valid JSON. It is an internal contract between evolve tools.
pub(crate) const NIX_PATH_MARKER_KEY: &str = "__nixPath";

/// Internal marker key used in JSON edit payloads to request a raw Nix expression.
///
/// This is intentionally restricted and should only be used by trusted internal tool flows
/// (for example `ensure_secret`) when a scalar expression is required instead of a quoted string.
pub(crate) const NIX_EXPR_MARKER_KEY: &str = "__nixExpr";

#[allow(dead_code)]
pub(crate) fn nix_path_meta_value(path: &str) -> serde_json::Value {
    let mut value = serde_json::Map::new();
    value.insert(
        NIX_PATH_MARKER_KEY.to_string(),
        serde_json::Value::String(path.to_string()),
    );
    serde_json::Value::Object(value)
}

#[allow(dead_code)]
pub(crate) fn nix_expr_meta_value(expression: &str) -> serde_json::Value {
    let mut value = serde_json::Map::new();
    value.insert(
        NIX_EXPR_MARKER_KEY.to_string(),
        serde_json::Value::String(expression.to_string()),
    );
    serde_json::Value::Object(value)
}

fn text_size_to_usize(size: TextSize) -> usize {
    u32::from(size) as usize
}

fn text_range_to_usize_range(range: TextRange) -> std::ops::Range<usize> {
    text_size_to_usize(range.start())..text_size_to_usize(range.end())
}

fn normalize_attrpath_for_match(input: &str) -> String {
    input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '"')
        .collect()
}

fn render_nix_string(value: &str) -> String {
    let mut rendered = String::from("\"");
    for ch in value.chars() {
        match ch {
            '\\' => rendered.push_str("\\\\"),
            '"' => rendered.push_str("\\\""),
            '\n' => rendered.push_str("\\n"),
            '\r' => rendered.push_str("\\r"),
            '\t' => rendered.push_str("\\t"),
            '$' => rendered.push_str("\\$"),
            _ => rendered.push(ch),
        }
    }
    rendered.push('"');
    rendered
}

fn render_nix_scalar(value: &serde_json::Value) -> Result<String> {
    match value {
        serde_json::Value::Bool(boolean) => Ok(if *boolean {
            "true".to_string()
        } else {
            "false".to_string()
        }),
        serde_json::Value::Number(number) => Ok(number.to_string()),
        serde_json::Value::String(string) => Ok(render_nix_string(string)),
        serde_json::Value::Null => Ok("null".to_string()),
        _ => Err(anyhow::anyhow!(
            "Set action only supports scalar JSON values (bool, number, string, null)"
        )),
    }
}

fn render_nix_attr_key(key: &str) -> String {
    let mut chars = key.chars();
    let starts_with_valid = chars
        .next()
        .map(|ch| ch.is_ascii_alphabetic() || ch == '_')
        .unwrap_or(false);
    let rest_valid =
        chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '\'');

    if starts_with_valid && rest_valid {
        key.to_string()
    } else {
        render_nix_string(key)
    }
}

fn render_nix_value(value: &serde_json::Value) -> Result<String> {
    match value {
        serde_json::Value::Array(items) => {
            if items.is_empty() {
                return Ok("[ ]".to_string());
            }

            let rendered_items = items
                .iter()
                .map(render_nix_value)
                .collect::<Result<Vec<_>>>()?;
            Ok(format!("[ {} ]", rendered_items.join(" ")))
        }
        serde_json::Value::Object(map) => {
            if let Some(path_literal) = render_nix_path_literal(map)? {
                return Ok(path_literal);
            }

            if let Some(expression) = render_nix_expression_literal(map)? {
                return Ok(expression);
            }

            if map.is_empty() {
                return Ok("{ }".to_string());
            }

            let rendered_pairs = map
                .iter()
                .map(|(key, nested)| -> Result<String> {
                    Ok(format!(
                        "{} = {};",
                        render_nix_attr_key(key),
                        render_nix_value(nested)?
                    ))
                })
                .collect::<Result<Vec<_>>>()?;

            Ok(format!("{{ {} }}", rendered_pairs.join(" ")))
        }
        _ => render_nix_scalar(value),
    }
}

fn render_nix_path_literal(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<Option<String>> {
    let Some(raw_path) = map.get(NIX_PATH_MARKER_KEY) else {
        return Ok(None);
    };

    if map.len() != 1 {
        return Err(anyhow::anyhow!(
            "Nix path marker object must only contain '{}'",
            NIX_PATH_MARKER_KEY
        ));
    }

    let path = raw_path
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("'{}' must be a string", NIX_PATH_MARKER_KEY))?;

    if path.is_empty() {
        return Err(anyhow::anyhow!(
            "'{}' must not be empty",
            NIX_PATH_MARKER_KEY
        ));
    }

    let valid = path
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '.' | '_' | '-' | '+'));

    if !valid {
        return Err(anyhow::anyhow!(
            "'{}' contains invalid characters for a Nix path literal",
            NIX_PATH_MARKER_KEY
        ));
    }

    Ok(Some(path.to_string()))
}

fn render_nix_expression_literal(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<Option<String>> {
    let Some(raw_expression) = map.get(NIX_EXPR_MARKER_KEY) else {
        return Ok(None);
    };

    if map.len() != 1 {
        return Err(anyhow::anyhow!(
            "Nix expression marker object must only contain '{}'",
            NIX_EXPR_MARKER_KEY
        ));
    }

    let expression = raw_expression
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("'{}' must be a string", NIX_EXPR_MARKER_KEY))?;

    if expression.is_empty() {
        return Err(anyhow::anyhow!(
            "'{}' must not be empty",
            NIX_EXPR_MARKER_KEY
        ));
    }

    let valid = expression.chars().all(|ch| {
        ch.is_ascii_alphanumeric()
            || matches!(
                ch,
                '/' | '.' | '_' | '-' | '+' | '"' | '[' | ']' | '(' | ')' | ':'
            )
    });

    if !valid {
        return Err(anyhow::anyhow!(
            "'{}' contains invalid characters for a Nix expression",
            NIX_EXPR_MARKER_KEY
        ));
    }

    Ok(Some(expression.to_string()))
}

/// Apply a semantic file edit to the filesystem, with Nix-aware handling for specific edit types.
pub fn apply_semantic_edit(base: &Path, edit: &SemanticFileEdit) -> anyhow::Result<()> {
    rewrite_existing_file_in_dir(base, &edit.path, "apply semantic nix edit", |content| {
        info!(
            "apply_semantic_edit: path={} | action={:?}",
            edit.path, edit.action
        );

        match &edit.action {
            FileEditAction::Add { path, values } => {
                info!("Action=Add path={} values={:?}", path, values);
                add(content, path, values)
            }
            FileEditAction::Remove { path, values } => {
                info!("Action=Remove path={} values={:?}", path, values);
                remove(content, path, values)
            }
            FileEditAction::Set { path, value } => {
                info!("Action=Set path={} value={:?}", path, value);
                set_value(content, path, value)
            }
            FileEditAction::SetAttrs { path, attrs } => {
                info!("Action=SetAttrs path={} attrs_count={}", path, attrs.len());
                set_attrs(content, path, attrs)
            }
        }
    })?;

    Ok(())
}

/// Extract package names from a List node
fn extract_package_list(node: &SyntaxNode) -> Result<Vec<String>> {
    let list = List::cast(node.clone()).context("Expected a List node")?;
    let mut pkgs = Vec::new();
    for expr in list.items() {
        pkgs.push(expr.to_string().trim().to_string());
    }
    Ok(pkgs)
}

/// Build the full attrpath for a list by checking brace nesting context.
/// For a list inside nested attrsets like `homebrew = { taps = [...]; }`,
/// this returns the full path "homebrew.taps" by scanning backwards through braces.
/// For flat assignments like `environment.systemPackages = [...]`, returns just the full path.
fn list_full_attrpath(content: &str, list_start: usize) -> Option<String> {
    let before_list = content.get(..list_start)?;
    let equals_pos = before_list.rfind('=')?;

    // Start with the immediate LHS (e.g., "taps")
    let immediate_lhs = assignment_lhs_at_equals(content, equals_pos)?;
    let mut path_segments = vec![immediate_lhs.to_string()];

    // Trace backwards through the content to find parent attrsets.
    // Scan from the `=` position backwards, counting brace nesting, to find the opening brace
    // of the immediately-enclosing attrset.
    let mut brace_depth = 0;
    let before_equals = content.get(..equals_pos)?;

    let char_indices: Vec<(usize, char)> = before_equals.char_indices().collect();
    for (idx, ch) in char_indices.iter().rev() {
        match ch {
            '}' => brace_depth += 1,
            '{' if brace_depth > 0 => {
                brace_depth -= 1;
            }
            '{' if brace_depth == 0 => {
                // Found the opening brace of the enclosing attrset.
                // Use the exact position from the iteration, not rfind, to avoid selecting
                // the wrong brace if there are fully-closed { ... } blocks in between.
                let brace_pos = *idx;
                if let Some(parent_equals) = content.get(..brace_pos).and_then(|s| s.rfind('=')) {
                    if let Some(parent_lhs) = assignment_lhs_at_equals(content, parent_equals) {
                        path_segments.insert(0, parent_lhs.to_string());
                    }
                }
                break;
            }
            _ => {}
        }
    }

    Some(path_segments.join("."))
}

fn assignment_lhs_at_equals(content: &str, equals_pos: usize) -> Option<&str> {
    let before_equals = content.get(..equals_pos)?;

    // Treat ';', '{', and '}' as statement boundaries for locating assignment LHS.
    let statement_start = before_equals
        .rfind([';', '{', '}'])
        .map_or(0, |idx| idx + 1);

    let lhs_region = before_equals.get(statement_start..)?;

    // In real modules, comments often sit directly above an assignment.
    // Use the last non-empty, non-comment line as the LHS candidate.
    let lhs_line = lhs_region.lines().rev().find_map(|line| {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            None
        } else {
            Some(trimmed)
        }
    })?;

    if lhs_line.is_empty() {
        return None;
    }

    Some(lhs_line)
}

fn find_assignment_value_range(content: &str, attrpath: &str) -> Option<std::ops::Range<usize>> {
    let target = normalize_attrpath_for_match(attrpath);

    for (equals_pos, character) in content.char_indices() {
        if character != '=' {
            continue;
        }

        let Some(lhs) = assignment_lhs_at_equals(content, equals_pos) else {
            continue;
        };
        if normalize_attrpath_for_match(lhs) != target {
            continue;
        }

        let rhs_start = content
            .get(equals_pos + 1..)?
            .char_indices()
            .find_map(|(offset, ch)| (!ch.is_whitespace()).then_some(equals_pos + 1 + offset))?;

        let rhs_end = find_statement_end(content, rhs_start)?;
        return Some(rhs_start..rhs_end);
    }

    None
}

fn find_statement_end(content: &str, start: usize) -> Option<usize> {
    let slice = content.get(start..)?;
    let mut bracket_depth = 0usize;
    let mut brace_depth = 0usize;
    let mut paren_depth = 0usize;
    let mut in_comment = false;
    let mut in_double_string = false;
    let mut in_indented_string = false;
    let mut escaped = false;

    let mut iter = slice.char_indices().peekable();
    while let Some((offset, ch)) = iter.next() {
        let absolute = start + offset;

        if in_comment {
            if ch == '\n' {
                in_comment = false;
            }
            continue;
        }

        if in_double_string {
            if escaped {
                escaped = false;
                continue;
            }
            match ch {
                '\\' => escaped = true,
                '"' => in_double_string = false,
                _ => {}
            }
            continue;
        }

        if in_indented_string {
            if ch == '\'' {
                if let Some((_, next)) = iter.peek() {
                    if *next == '\'' {
                        iter.next();
                        in_indented_string = false;
                    }
                }
            }
            continue;
        }

        match ch {
            '#' => in_comment = true,
            '"' => in_double_string = true,
            '\'' => {
                if let Some((_, next)) = iter.peek() {
                    if *next == '\'' {
                        iter.next();
                        in_indented_string = true;
                    }
                }
            }
            '[' => bracket_depth += 1,
            ']' => bracket_depth = bracket_depth.saturating_sub(1),
            '{' => brace_depth += 1,
            '}' => brace_depth = brace_depth.saturating_sub(1),
            '(' => paren_depth += 1,
            ')' => paren_depth = paren_depth.saturating_sub(1),
            ';' if bracket_depth == 0 && brace_depth == 0 && paren_depth == 0 => {
                return Some(absolute)
            }
            _ => {}
        }
    }

    None
}

/// Find a List node assigned to a specific attrpath.
/// Handles both flat assignments (e.g., `environment.systemPackages = [...]`)
/// and nested ones (e.g., `homebrew = { taps = [...]; }`).
fn find_list_for_attrpath(root: &SyntaxNode, content: &str, attrpath: &str) -> Option<SyntaxNode> {
    let target = normalize_attrpath_for_match(attrpath);

    for node in root.descendants() {
        if List::cast(node.clone()).is_some() {
            let list_start = text_size_to_usize(node.text_range().start());
            if let Some(full_path) = list_full_attrpath(content, list_start) {
                let full_path_normalized = normalize_attrpath_for_match(&full_path);
                if full_path_normalized == target {
                    return Some(node);
                }
            }
        }
    }
    None
}

/// Add values to a list at the given attrpath, creating the list if it doesn't exist. Idempotent for existing values.
fn add(content: &str, attrpath: &str, values: &[String]) -> Result<String> {
    if values.is_empty() {
        info!("No values provided for add at {}; no-op", attrpath);
        return Ok(content.to_string());
    }

    let parsed: Parse<Root> = Root::parse(content);
    let root: Root = parsed
        .ok()
        .context("Failed to parse Nix content when adding values")?;
    let root_node_ref: &SyntaxNode = root.syntax();
    let root_node: SyntaxNode = root_node_ref.clone();

    if let Some(list_node) = find_list_for_attrpath(&root_node, content, attrpath) {
        debug!("Found existing list for {}", attrpath);
        let mut items = extract_package_list(&list_node)?;
        let mut added_any = false;
        for value in values {
            if items.contains(value) {
                info!("Value {} already present at {}; skipping", value, attrpath);
                continue;
            }
            items.push(value.clone());
            added_any = true;
        }

        if !added_any {
            info!("All values already present at {}; no-op", attrpath);
            return Ok(content.to_string());
        }

        let new_text = format!("[ {} ]", items.join(" "));
        let range = list_node.text_range();
        let mut patched = content.to_string();
        let byte_range = text_range_to_usize_range(range);

        // TODO: This drops list formatting and comments.
        // Supposedly there's a way to use rowan to keep track of that...
        info!("Replacing list at {:?} with {}", byte_range, new_text);
        patched.replace_range(byte_range, &new_text);
        return Ok(patched);
    }

    // not found -> insert new attr assignment in top-level attrset
    let insert_pos = find_top_level_attrset_end(&root_node)
        .context("Cannot find top-level attribute set to insert new attr")?;
    let addition = format!("\n  {} = [ {} ];", attrpath, values.join(" "));

    // TODO: We _may_ be requiring "with pkgs;" for list edits depending on what the
    // agent does, but we should be more flexible about it. We could insert a new attr without "with pkgs"
    // if the attrpath is different, but if the attrpath includes "pkgs" then we should probably
    // require it exists to avoid confusion about where the packages are coming from.
    info!(
        "{} not found; inserting '{}' at {}",
        attrpath, addition, insert_pos
    );
    let mut patched = content.to_string();
    patched.insert_str(insert_pos, &addition);
    Ok(patched)
}

/// Remove values from a list at the given attrpath. Idempotent for missing values. No-op if list or attrpath doesn't exist.
fn remove(content: &str, attrpath: &str, values: &[String]) -> Result<String> {
    if values.is_empty() {
        info!("No values provided for remove at {}; no-op", attrpath);
        return Ok(content.to_string());
    }

    let parsed: Parse<Root> = Root::parse(content);
    let root: Root = parsed
        .ok()
        .context("Failed to parse Nix content when removing values")?;
    let root_node_ref: &SyntaxNode = root.syntax();
    let root_node: SyntaxNode = root_node_ref.clone();

    if let Some(list_node) = find_list_for_attrpath(&root_node, content, attrpath) {
        debug!("Found existing list for removal at {}", attrpath);
        let mut items = extract_package_list(&list_node)?;
        let original_len = items.len();
        items.retain(|item| !values.contains(item));

        if items.len() == original_len {
            info!(
                "None of the requested values were present at {}; no-op",
                attrpath
            );
            return Ok(content.to_string());
        }

        let new_text = format!("[ {} ]", items.join(" "));
        let range = list_node.text_range();
        let mut patched = content.to_string();
        let byte_range = text_range_to_usize_range(range);
        info!("Replacing list at {:?} with {}", byte_range, new_text);
        patched.replace_range(byte_range, &new_text);
        return Ok(patched);
    }

    info!(
        "No list found for {} to remove {:?}; no-op",
        attrpath, values
    );
    Ok(content.to_string())
}

fn set_value(content: &str, attrpath: &str, value: &serde_json::Value) -> Result<String> {
    let rendered_value = render_nix_value(value)?;

    if let Some(value_range) = find_assignment_value_range(content, attrpath) {
        let mut patched = content.to_string();
        info!(
            "Replacing scalar assignment for {} at {:?} with {}",
            attrpath, value_range, rendered_value
        );
        patched.replace_range(value_range, &rendered_value);
        return Ok(patched);
    }

    let parsed: Parse<Root> = Root::parse(content);
    let root: Root = parsed
        .ok()
        .context("Failed to parse Nix content when setting value")?;
    let insert_pos = find_top_level_attrset_end(&root.syntax().clone())
        .context("Cannot find top-level attribute set to insert scalar attr")?;
    let addition = format!("\n  {} = {};", attrpath, rendered_value);
    info!(
        "{} not found; inserting scalar assignment '{}' at {}",
        attrpath, addition, insert_pos
    );
    let mut patched = content.to_string();
    patched.insert_str(insert_pos, &addition);
    Ok(patched)
}

/// Find the end of the top-level attribute set to insert new attributes
fn find_top_level_attrset_end(root: &SyntaxNode) -> Option<usize> {
    let mut largest_attrset_end: Option<TextSize> = None;
    let mut largest_attrset_len: u32 = 0;

    // Nix modules often contain two attrsets: argument attrset and body attrset.
    // Selecting the largest one targets the body where home.packages belongs.
    for node in root.descendants() {
        if let Some(attr_set) = AttrSet::cast(node) {
            let range = attr_set.syntax().text_range();
            let len = u32::from(range.end() - range.start());
            if len > largest_attrset_len {
                largest_attrset_len = len;
                largest_attrset_end = Some(range.end());
            }
        }
    }

    largest_attrset_end
        .map(text_size_to_usize)
        .and_then(|end| end.checked_sub(1))
}

/// Create or update a Nix attribute set at the given path with the provided scalar key-value pairs.
///
/// Strategy:
///   1. Keys that already exist as flat assignments (`path.key = val;`) are updated via `set_value`.
///   2. Remaining keys are merged into an existing `path = { ... }` attrset (updating present keys,
///      inserting missing ones before the closing `}`).
///   3. If no attrset exists at `path`, a fresh one is inserted into the top-level module body.
fn set_attrs(
    content: &str,
    path: &str,
    attrs: &serde_json::Map<String, serde_json::Value>,
) -> Result<String> {
    if attrs.is_empty() {
        info!("No attrs provided for set_attrs at {}; no-op", path);
        return Ok(content.to_string());
    }

    let mut current = content.to_string();
    let mut pending: Vec<(&str, &serde_json::Value)> = Vec::new();

    // Step 1: handle keys that already exist as flat assignments (e.g. path.key = val).
    for (key, value) in attrs {
        let flat_path = format!("{}.{}", path, key);
        if find_assignment_value_range(&current, &flat_path).is_some() {
            info!("Updating flat assignment {} for set_attrs", flat_path);
            current = set_value(&current, &flat_path, value)?;
        } else {
            pending.push((key.as_str(), value));
        }
    }

    if pending.is_empty() {
        return Ok(current);
    }

    // Step 2: check whether path = { ... } already exists.
    let attrset_exists = find_assignment_value_range(&current, path)
        .map(|r| current[r].trim_start().starts_with('{'))
        .unwrap_or(false);

    if attrset_exists {
        // Merge into existing attrset; re-query range after each mutation.
        for (key, value) in pending {
            let rendered = render_nix_value(value)?;
            let attrset_range = find_assignment_value_range(&current, path)
                .ok_or_else(|| anyhow::anyhow!("set_attrs: lost attrset range during update"))?;
            let attrset_text = current[attrset_range.clone()].to_string();

            if let Some(key_val_range) = find_assignment_value_range(&attrset_text, key) {
                // Key exists – update its value.
                let abs_start = attrset_range.start + key_val_range.start;
                let abs_end = attrset_range.start + key_val_range.end;
                info!(
                    "Updating key {} inside attrset {} at {}..{}",
                    key, path, abs_start, abs_end
                );
                current.replace_range(abs_start..abs_end, &rendered);
            } else {
                // Key absent – insert before closing `}`.
                let close_offset = attrset_text.rfind('}').ok_or_else(|| {
                    anyhow::anyhow!("set_attrs: malformed attrset – no closing brace")
                })?;
                let indent = infer_inner_indent(&attrset_text);
                let insert_pos = attrset_range.start + close_offset;
                let kv = format!("{}{} = {};\n", indent, key, rendered);
                info!(
                    "Inserting key {} into attrset {} at {}",
                    key, path, insert_pos
                );
                current.insert_str(insert_pos, &kv);
            }
        }
    } else {
        // Step 3: create a fresh attrset assignment.
        let parsed = Root::parse(&current)
            .ok()
            .context("Failed to parse Nix content when creating attrset")?;
        let insert_pos = find_top_level_attrset_end(parsed.syntax())
            .context("Cannot find top-level attrset end for set_attrs insertion")?;

        let inner_indent = "    ";
        let body = pending
            .iter()
            .map(|(k, v)| -> Result<String> {
                Ok(format!("{}{} = {};", inner_indent, k, render_nix_value(v)?))
            })
            .collect::<Result<Vec<_>>>()?
            .join("\n");

        let insertion = format!("\n  {} = {{\n{}\n  }};", path, body);
        info!(
            "Creating new attrset for {} at position {}",
            path, insert_pos
        );
        current.insert_str(insert_pos, &insertion);
    }

    Ok(current)
}

/// Infer the indentation string used for key-value lines inside an attrset text fragment.
fn infer_inner_indent(attrset_text: &str) -> String {
    for line in attrset_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed == "{" || trimmed.starts_with('}') {
            continue;
        }
        let leading = line.len() - line.trim_start().len();
        if leading > 0 {
            return " ".repeat(leading);
        }
    }
    "    ".to_string() // default: 4 spaces
}

#[cfg(test)]
mod tests {
    use super::*;

    const WITH_PKGS_EMPTY: &str = r#"{ config, pkgs, ... }:
{
environment.systemPackages = with pkgs; [
];
}
"#;

    const WITH_PKGS_COMMENTED: &str = r#"{ config, pkgs, ... }:
{
    # System packages module
    # Purpose:
    # - Declare packages that should be present in the global system profile.
    # - Use this for CLI tools and utilities you want available to all users.

    environment.systemPackages = with pkgs; [
        # Example packages (uncomment or add your own):
        # git   # version control
    ];
}
"#;

    const BOOL_ASSIGNMENT: &str = r#"{ config, pkgs, ... }:
{
    services.tailscale.enable = false;
}
"#;

    #[test]
    fn finds_existing_list_for_with_pkgs_attrpath() {
        let parsed: Parse<Root> = Root::parse(WITH_PKGS_EMPTY);
        let root: Root = parsed.ok().expect("fixture should parse");
        let root_node = root.syntax().clone();

        let found =
            find_list_for_attrpath(&root_node, WITH_PKGS_EMPTY, "environment.systemPackages");
        assert!(
            found.is_some(),
            "expected to find existing list for environment.systemPackages"
        );
    }

    #[test]
    fn add_updates_existing_with_pkgs_list_instead_of_inserting_new_attr() {
        let edited = add(
            WITH_PKGS_EMPTY,
            "environment.systemPackages",
            &["ripgrep".to_string()],
        )
        .expect("add should succeed");

        assert!(
            edited.contains("environment.systemPackages = with pkgs; [ ripgrep ];"),
            "expected to update existing assignment in-place"
        );

        assert_eq!(
            edited.matches("environment.systemPackages =").count(),
            1,
            "should not insert duplicate environment.systemPackages assignment"
        );
    }

    #[test]
    fn remove_updates_existing_with_pkgs_list() {
        let with_item = add(
            WITH_PKGS_EMPTY,
            "environment.systemPackages",
            &["ripgrep".to_string()],
        )
        .expect("seed add should succeed");
        let removed = remove(
            &with_item,
            "environment.systemPackages",
            &["ripgrep".to_string()],
        )
        .expect("remove should succeed");

        assert!(
            removed.contains("environment.systemPackages = with pkgs; [  ];"),
            "expected to remove item from existing assignment"
        );
        assert_eq!(
            removed.matches("environment.systemPackages =").count(),
            1,
            "should not duplicate assignment during remove"
        );
    }

    #[test]
    fn add_updates_existing_list_when_comments_precede_assignment() {
        let edited = add(
            WITH_PKGS_COMMENTED,
            "environment.systemPackages",
            &["ripgrep".to_string()],
        )
        .expect("add should succeed");

        assert!(
            edited.contains("environment.systemPackages = with pkgs; [ ripgrep"),
            "expected add to update existing commented assignment"
        );
        assert_eq!(
            edited.matches("environment.systemPackages =").count(),
            1,
            "should not insert duplicate environment.systemPackages assignment"
        );
    }

    #[test]
    fn add_supports_multiple_values() {
        let edited = add(
            WITH_PKGS_EMPTY,
            "environment.systemPackages",
            &["ripgrep".to_string(), "fd".to_string()],
        )
        .expect("add should succeed");

        assert!(
            edited.contains("environment.systemPackages = with pkgs; [ ripgrep fd ];"),
            "expected add to insert multiple values into existing assignment"
        );
    }

    #[test]
    fn remove_supports_multiple_values() {
        let with_items = add(
            WITH_PKGS_EMPTY,
            "environment.systemPackages",
            &["ripgrep".to_string(), "fd".to_string(), "jq".to_string()],
        )
        .expect("seed add should succeed");
        let removed = remove(
            &with_items,
            "environment.systemPackages",
            &["ripgrep".to_string(), "fd".to_string()],
        )
        .expect("remove should succeed");

        assert!(
            removed.contains("environment.systemPackages = with pkgs; [ jq ];"),
            "expected remove to drop multiple values from existing assignment"
        );
    }

    #[test]
    fn set_updates_existing_boolean_assignment() {
        let edited = set_value(
            BOOL_ASSIGNMENT,
            "services.tailscale.enable",
            &serde_json::Value::Bool(true),
        )
        .expect("set should succeed");

        assert!(
            edited.contains("services.tailscale.enable = true;"),
            "expected set to replace existing boolean assignment"
        );
    }

    #[test]
    fn set_inserts_missing_scalar_assignment() {
        let edited = set_value(
            WITH_PKGS_EMPTY,
            "services.tailscale.enable",
            &serde_json::Value::Bool(true),
        )
        .expect("set should succeed");

        assert!(
            edited.contains("services.tailscale.enable = true;"),
            "expected set to insert missing boolean assignment"
        );
    }

    #[test]
    fn set_renders_strings_as_nix_strings() {
        let edited = set_value(
            WITH_PKGS_EMPTY,
            "networking.hostName",
            &serde_json::Value::String("my-mac".to_string()),
        )
        .expect("set should succeed");

        assert!(
            edited.contains("networking.hostName = \"my-mac\";"),
            "expected set to quote string values as Nix strings"
        );
    }

    #[test]
    fn set_renders_nix_expr_marker_without_quotes() {
        let edited = set_value(
            WITH_PKGS_EMPTY,
            "environment.variables.MYAPP_FILE",
            &nix_expr_meta_value("config.sops.secrets.\"myapp\".path"),
        )
        .expect("set should support nix expression marker values");

        assert!(
            edited
                .contains("environment.variables.MYAPP_FILE = config.sops.secrets.\"myapp\".path;"),
            "expected expression marker to render as raw Nix expression"
        );
        assert!(
            !edited.contains(
                "environment.variables.MYAPP_FILE = \"config.sops.secrets.\\\"myapp\\\".path\";"
            ),
            "expected expression marker not to render as a quoted string"
        );
    }

    const DOCK_ATTRSET: &str = r#"{ config, pkgs, ... }:
{
    system.defaults.dock = {
        tilesize = 48;
    };
}
"#;

    #[test]
    fn set_attrs_creates_new_attrset_when_missing() {
        let mut attrs = serde_json::Map::new();
        attrs.insert("tilesize".to_string(), serde_json::json!(48));
        attrs.insert("autohide".to_string(), serde_json::json!(true));

        let edited = set_attrs(WITH_PKGS_EMPTY, "system.defaults.dock", &attrs)
            .expect("set_attrs should succeed");

        assert!(
            edited.contains("system.defaults.dock = {"),
            "expected set_attrs to create attrset block"
        );
        assert!(
            edited.contains("tilesize = 48;"),
            "expected tilesize key in new attrset"
        );
        assert!(
            edited.contains("autohide = true;"),
            "expected autohide key in new attrset"
        );
        assert_eq!(
            edited.matches("system.defaults.dock").count(),
            1,
            "should only appear once"
        );
    }

    #[test]
    fn set_attrs_updates_existing_key_in_attrset() {
        let mut attrs = serde_json::Map::new();
        attrs.insert("tilesize".to_string(), serde_json::json!(64));

        let edited = set_attrs(DOCK_ATTRSET, "system.defaults.dock", &attrs)
            .expect("set_attrs should succeed");

        assert!(
            edited.contains("tilesize = 64;"),
            "expected tilesize to be updated to 64"
        );
        assert!(
            !edited.contains("tilesize = 48;"),
            "expected old tilesize value to be replaced"
        );
    }

    #[test]
    fn set_attrs_inserts_new_key_into_existing_attrset() {
        let mut attrs = serde_json::Map::new();
        attrs.insert("autohide".to_string(), serde_json::json!(true));

        let edited = set_attrs(DOCK_ATTRSET, "system.defaults.dock", &attrs)
            .expect("set_attrs should succeed");

        assert!(
            edited.contains("autohide = true;"),
            "expected autohide to be inserted into existing attrset"
        );
        assert!(
            edited.contains("tilesize = 48;"),
            "expected original tilesize to be preserved"
        );
        assert_eq!(
            edited.matches("system.defaults.dock").count(),
            1,
            "should not duplicate the attrset assignment"
        );
    }

    #[test]
    fn set_attrs_supports_nested_json_values() {
        let mut attrs = serde_json::Map::new();
        attrs.insert(
            "script".to_string(),
            serde_json::json!("source /run/secrets/myapp && exec /usr/local/bin/myapp"),
        );
        attrs.insert(
            "serviceConfig".to_string(),
            serde_json::json!({
                "Label": "org.myapp.service",
                "RunAtLoad": true,
                "StandardOutPath": "/tmp/myapp.out.log",
                "StandardErrorPath": "/tmp/myapp.err.log"
            }),
        );

        let edited = set_attrs(WITH_PKGS_EMPTY, "launchd.user.agents.myapp", &attrs)
            .expect("set_attrs should support nested values");

        assert!(
            edited.contains("launchd.user.agents.myapp = {"),
            "expected set_attrs to create target attrset"
        );
        assert!(
            edited.contains("script = \"source /run/secrets/myapp && exec /usr/local/bin/myapp\";"),
            "expected script string to render"
        );
        assert!(
            edited.contains("serviceConfig = { Label = \"org.myapp.service\"; RunAtLoad = true; StandardErrorPath = \"/tmp/myapp.err.log\"; StandardOutPath = \"/tmp/myapp.out.log\"; };"),
            "expected nested object to render as Nix attrset"
        );
    }

    #[test]
    fn set_attrs_renders_nix_path_literal_marker_without_quotes() {
        let mut attrs = serde_json::Map::new();
        attrs.insert(
            "sopsFile".to_string(),
            nix_path_meta_value("../../secrets/ssh-private-key.yaml"),
        );

        let edited = set_attrs(WITH_PKGS_EMPTY, "sops.secrets.\"ssh-private-key\"", &attrs)
            .expect("set_attrs should render nix path literal marker");

        assert!(
            edited.contains("sopsFile = ../../secrets/ssh-private-key.yaml;"),
            "expected sopsFile to render as a Nix path literal"
        );
        assert!(
            !edited.contains("sopsFile = \"../../secrets/ssh-private-key.yaml\";"),
            "expected sopsFile not to be rendered as a quoted string"
        );
    }

    #[test]
    fn set_attrs_renders_nix_expr_marker_without_quotes() {
        let mut attrs = serde_json::Map::new();
        attrs.insert(
            "MYAPP_ENV_FILE".to_string(),
            nix_expr_meta_value("config.sops.secrets.\"myapp-env\".path"),
        );

        let edited = set_attrs(WITH_PKGS_EMPTY, "environment.variables", &attrs)
            .expect("set_attrs should render nix expression marker");

        assert!(
            edited.contains("MYAPP_ENV_FILE = config.sops.secrets.\"myapp-env\".path;"),
            "expected MYAPP_ENV_FILE to render as a raw expression"
        );
        assert!(
            !edited.contains("MYAPP_ENV_FILE = \"config.sops.secrets.\\\"myapp-env\\\".path\";"),
            "expected MYAPP_ENV_FILE not to be rendered as a quoted string"
        );
    }

    const HOMEBREW_NESTED: &str = r#"{ config, pkgs, ... }:
{
  homebrew = {
    # Homebrew taps (e.g., "dotenvx/brew")
    taps = [
      # "dotenvx/brew" # required for dotenvx formula
    ];

    # Homebrew formulae (non-GUI packages)
    brews = [
      # "git" # required for CLI workflows
    ];

    casks = [
      # Homebrew Casks should be specified as strings (Cask token names).
      # Add casks here, e.g.
      # "visual-studio-code" # editor - enable if you prefer cask-managed VSCode
    ];
  };
}
"#;

    #[test]
    fn add_to_nested_list_inside_attrset() {
        let edited = add(
            HOMEBREW_NESTED,
            "homebrew.taps",
            &["dotenvx/brew".to_string()],
        )
        .expect("add should succeed for nested list in attrset");

        assert!(
            edited.contains("dotenvx/brew"),
            "expected to find dotenvx/brew in the edited output"
        );
        assert_eq!(
            edited.matches("taps = [").count(),
            1,
            "should not insert duplicate taps assignment"
        );
    }
}
