//! Naming helpers shared by schema and field generation.

/// Converts Rust field identifiers into the camelCase keys used at the IPC
/// boundary.
pub(crate) fn snake_to_camel(snake: &str) -> String {
    let mut out = String::with_capacity(snake.len());
    let mut upper_next = false;
    for c in snake.chars() {
        if c == '_' {
            upper_next = true;
        } else if upper_next {
            out.extend(c.to_uppercase());
            upper_next = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// Convert a snake_case or kebab-case identifier into a Title-Cased label
/// suitable for UI rendering. "max_iterations" -> "Max iterations".
pub(crate) fn humanize(s: &str) -> String {
    let normalized = s.replace(['_', '-'], " ");
    let mut chars = normalized.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}
