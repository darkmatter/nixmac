use rnix::ast::List;
use rnix::{Parse, Root};
use rowan::TextSize;
use rowan::ast::AstNode;
use std::collections::HashMap;

/// Parse all string-only list assignments from Nix source and return a map of
/// normalized attrpaths to values. For nested attrsets, the returned key is a
/// dotted path (for example `homebrew.taps`).
pub fn parse_string_lists_by_attrpath(content: &str) -> HashMap<String, Vec<String>> {
    let parsed: Parse<Root> = Root::parse(content);
    let Ok(root) = parsed.ok() else {
        return HashMap::new();
    };

    let mut out = HashMap::new();
    for node in root.syntax().descendants() {
        if List::cast(node.clone()).is_none() {
            continue;
        }

        let start = text_size_to_usize(node.text_range().start());
        let Some(attrpath) = list_full_attrpath(content, start) else {
            continue;
        };

        let values = extract_package_list(&node);
        if !values.is_empty() {
            out.insert(attrpath, values);
        }
    }

    out
}

fn text_size_to_usize(size: TextSize) -> usize {
    u32::from(size) as usize
}

fn extract_package_list(node: &rnix::SyntaxNode) -> Vec<String> {
    let Some(list) = List::cast(node.clone()) else {
        return Vec::new();
    };

    list.items()
        .filter_map(|expr| parse_nix_string_literal(expr.to_string().trim()))
        .collect()
}

fn parse_nix_string_literal(value: &str) -> Option<String> {
    let value = value.trim();

    if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
        let inner = &value[1..value.len() - 1];
        let mut out = String::new();
        let mut chars = inner.chars();

        while let Some(ch) = chars.next() {
            if ch != '\\' {
                out.push(ch);
                continue;
            }

            match chars.next() {
                Some('n') => out.push('\n'),
                Some('r') => out.push('\r'),
                Some('t') => out.push('\t'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => return None,
            }
        }
        return Some(out);
    }

    if value.starts_with("''") && value.ends_with("''") && value.len() >= 4 {
        return Some(value[2..value.len() - 2].to_string());
    }

    None
}

fn normalize_attrpath_for_match(input: &str) -> String {
    input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '"')
        .collect()
}

fn assignment_lhs_at_equals(content: &str, equals_pos: usize) -> Option<&str> {
    let before_equals = content.get(..equals_pos)?;
    let statement_start = before_equals
        .rfind([';', '{', '}'])
        .map_or(0, |idx| idx + 1);

    let lhs_region = before_equals.get(statement_start..)?;
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

/// Returns the dotted attrpath for the list whose source starts at `list_start`.
/// Supports up to one level of parent attrset nesting (e.g. `homebrew.taps` but not `a.b.c`).
/// For deeper nesting, only the immediate parent key is included in the path.
fn list_full_attrpath(content: &str, list_start: usize) -> Option<String> {
    let before_list = content.get(..list_start)?;
    let equals_pos = before_list.rfind('=')?;

    let immediate_lhs = assignment_lhs_at_equals(content, equals_pos)?;
    let mut path_segments = vec![immediate_lhs.to_string()];

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

    let joined = path_segments.join(".");
    Some(normalize_attrpath_for_match(&joined))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested_attrset_lists() {
        let content = r#"{ config, ... }:
{
  homebrew = {
    taps = [
            "homebrew/cask-fonts"
    ];
        brews = [ "git" "jq" ];
  };
}
"#;

        let parsed = parse_string_lists_by_attrpath(content);
        assert_eq!(
            parsed.get("homebrew.taps"),
            Some(&vec!["homebrew/cask-fonts".to_string()])
        );
        assert_eq!(
            parsed.get("homebrew.brews"),
            Some(&vec!["git".to_string(), "jq".to_string()])
        );
    }

    #[test]
    fn parses_flat_attrpath_lists() {
        let content = r#"{ config, ... }:
{
    homebrew.casks = [ "iterm2" ];
    homebrew.taps = [ "homebrew/cask-fonts" ];
}
"#;

        let parsed = parse_string_lists_by_attrpath(content);
        assert_eq!(
            parsed.get("homebrew.casks"),
            Some(&vec!["iterm2".to_string()])
        );
        assert_eq!(
            parsed.get("homebrew.taps"),
            Some(&vec!["homebrew/cask-fonts".to_string()])
        );
    }

    #[test]
    fn ignores_non_string_entries() {
        let content = r#"{ config, ... }:
{
    homebrew.brews = [ "git" pkgs.jq ];
}
"#;

        let parsed = parse_string_lists_by_attrpath(content);
        assert_eq!(parsed.get("homebrew.brews"), Some(&vec!["git".to_string()]));
    }

    #[test]
    fn parse_nix_string_literal_handles_escape_sequences() {
        assert_eq!(
            parse_nix_string_literal(r#""hello\nworld""#),
            Some("hello\nworld".to_string())
        );
        assert_eq!(
            parse_nix_string_literal(r#""tab\there""#),
            Some("tab\there".to_string())
        );
        assert_eq!(
            parse_nix_string_literal(r#""back\\slash""#),
            Some("back\\slash".to_string())
        );
        assert_eq!(
            parse_nix_string_literal(r#""quote\"here""#),
            Some("quote\"here".to_string())
        );
        // Unknown escape sequences preserve the backslash
        assert_eq!(
            parse_nix_string_literal(r#""foo\xbar""#),
            Some("foo\\xbar".to_string())
        );
        // Trailing backslash (invalid Nix string) returns None
        assert_eq!(parse_nix_string_literal(r#""trailing\""#), None);
        // Plain strings pass through unchanged
        assert_eq!(
            parse_nix_string_literal(r#""aws/tap""#),
            Some("aws/tap".to_string())
        );
    }
}
