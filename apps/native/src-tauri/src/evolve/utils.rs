//! Common utilities for the evolve module

/// Truncate error output to a maximum length, keeping the most relevant parts
pub fn truncate_error(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        return s.to_string();
    }

    // Keep the beginning and end, which usually have the most relevant info
    let half = max_len / 2;
    let start = &s[..half];
    let end = &s[s.len() - half..];

    format!(
        "{}\n\n... [truncated {} bytes] ...\n\n{}",
        start,
        s.len() - max_len,
        end
    )
}
