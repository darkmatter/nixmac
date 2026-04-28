use rnix::ast::List;
use rnix::{Parse, Root};
use rowan::ast::AstNode;
use rowan::TextSize;
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
        let mut out = String::new();
        let bytes = value.as_bytes();
        let mut i = 1usize;
        while i + 1 < bytes.len() {
            match bytes[i] {
                b'\\' if i + 2 < bytes.len() => {
                    i += 1;
                    out.push(bytes[i] as char);
                }
                ch => out.push(ch as char),
            }
            i += 1;
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
}
