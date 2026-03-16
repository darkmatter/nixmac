// Helper to truncate a string in-place without breaking UTF-8 encoding
// and causing a panic, thereby avoiding annoying AI code review comments
// about "don't truncate UTF-8 strings".
pub fn truncate_utf8(s: &mut String, max: usize) {
    s.truncate(s.floor_char_boundary(max));
}
