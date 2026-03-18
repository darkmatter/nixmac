// Helper to truncate a string in-place without breaking UTF-8 encoding
// and causing a panic, thereby avoiding annoying AI code review comments
// about "don't truncate UTF-8 strings".
pub fn truncate_utf8(s: &mut String, max: usize) {
    s.truncate(s.floor_char_boundary(max));
}

pub fn truncate_with_ellipsis(s: &str, max: usize) -> String {
    let mut truncated = s.to_string();
    let original_len = truncated.len();
    truncate_utf8(&mut truncated, max);
    if truncated.len() < original_len {
        truncated.push_str("...");
    }
    truncated
}
