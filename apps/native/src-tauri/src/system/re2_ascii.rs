//! Rewrites Go/RE2 regex patterns into exact Rust-compilable equivalents.
//!
//! Gitleaks patterns are written for Go's RE2, where the Perl classes and
//! word boundaries are ASCII-only. Compiled with the Rust regex crates they
//! get Unicode semantics instead, and patterns with large bounded repetitions
//! of `\w` can exceed NFA size limits and fail to compile entirely. Rewriting
//! those constructs to their explicit ASCII definitions reproduces exactly
//! what gitleaks executes, and compiles cheaply.

use regex_syntax::ast::{AssertionKind, Ast, ClassPerlKind, ClassSet, ClassSetItem};
use std::ops::Range;

// Go/RE2 definitions of the Perl classes:
//   \w = [0-9A-Za-z_]   \d = [0-9]   \s = [\t\n\f\r ]
// The negated variants are the full complement, including all of non-ASCII.
const ASCII_WORD: &str = "0-9A-Za-z_";
const ASCII_NOT_WORD: &str = r"\x00-\x2f\x3a-\x40\x5b-\x5e\x60\x7b-\x{10FFFF}";
const ASCII_DIGIT: &str = "0-9";
const ASCII_NOT_DIGIT: &str = r"\x00-\x2f\x3a-\x{10FFFF}";
const ASCII_SPACE: &str = r"\t\n\x0c\r\x20";
const ASCII_NOT_SPACE: &str = r"\x00-\x08\x0b\x0e-\x1f\x21-\x{10FFFF}";

// Go's `\b` is an ASCII word boundary; the regex crate's is Unicode-aware and
// `(?-u)` is unsupported by fancy_regex, so express it with lookarounds.
const ASCII_WORD_BOUNDARY: &str =
    "(?:(?<![0-9A-Za-z_])(?=[0-9A-Za-z_])|(?<=[0-9A-Za-z_])(?![0-9A-Za-z_]))";
const ASCII_NOT_WORD_BOUNDARY: &str =
    "(?:(?<=[0-9A-Za-z_])(?=[0-9A-Za-z_])|(?<![0-9A-Za-z_])(?![0-9A-Za-z_]))";

fn perl_class_ranges(kind: &ClassPerlKind, negated: bool) -> &'static str {
    match (kind, negated) {
        (ClassPerlKind::Word, false) => ASCII_WORD,
        (ClassPerlKind::Word, true) => ASCII_NOT_WORD,
        (ClassPerlKind::Digit, false) => ASCII_DIGIT,
        (ClassPerlKind::Digit, true) => ASCII_NOT_DIGIT,
        (ClassPerlKind::Space, false) => ASCII_SPACE,
        (ClassPerlKind::Space, true) => ASCII_NOT_SPACE,
    }
}

fn collect_ascii_replacements(node: &Ast, out: &mut Vec<(Range<usize>, String)>) {
    match node {
        Ast::ClassPerl(p) => {
            let ranges = perl_class_ranges(&p.kind, p.negated);
            out.push((
                p.span.start.offset..p.span.end.offset,
                format!("[{ranges}]"),
            ));
        }
        Ast::Assertion(a) => {
            let replacement = match a.kind {
                AssertionKind::WordBoundary => ASCII_WORD_BOUNDARY,
                AssertionKind::NotWordBoundary => ASCII_NOT_WORD_BOUNDARY,
                _ => return,
            };
            out.push((a.span.start.offset..a.span.end.offset, replacement.to_string()));
        }
        Ast::ClassBracketed(c) => collect_class_set(&c.kind, out),
        Ast::Repetition(r) => collect_ascii_replacements(&r.ast, out),
        Ast::Group(g) => collect_ascii_replacements(&g.ast, out),
        Ast::Alternation(a) => {
            for ast in &a.asts {
                collect_ascii_replacements(ast, out);
            }
        }
        Ast::Concat(c) => {
            for ast in &c.asts {
                collect_ascii_replacements(ast, out);
            }
        }
        _ => {}
    }
}

fn collect_class_set(set: &ClassSet, out: &mut Vec<(Range<usize>, String)>) {
    match set {
        ClassSet::Item(item) => collect_class_item(item, out),
        ClassSet::BinaryOp(op) => {
            collect_class_set(&op.lhs, out);
            collect_class_set(&op.rhs, out);
        }
    }
}

fn collect_class_item(item: &ClassSetItem, out: &mut Vec<(Range<usize>, String)>) {
    match item {
        // Inside a bracketed class, splice in bare ranges (no brackets).
        ClassSetItem::Perl(p) => {
            let ranges = perl_class_ranges(&p.kind, p.negated);
            out.push((p.span.start.offset..p.span.end.offset, ranges.to_string()));
        }
        ClassSetItem::Bracketed(b) => collect_class_set(&b.kind, out),
        ClassSetItem::Union(u) => {
            for item in &u.items {
                collect_class_item(item, out);
            }
        }
        _ => {}
    }
}

/// Rewrite the unicode-dependent constructs (`\w` `\d` `\s` `\b` and their
/// negations) into their exact Go/RE2 ASCII equivalents, using the parsed AST
/// so escaped literals and class-internal contexts are handled correctly.
/// Returns None if the pattern doesn't parse or contains nothing to rewrite.
pub fn ascii_rewrite(pattern: &str) -> Option<String> {
    let ast = regex_syntax::ast::parse::Parser::new().parse(pattern).ok()?;
    let mut replacements: Vec<(Range<usize>, String)> = Vec::new();
    collect_ascii_replacements(&ast, &mut replacements);
    if replacements.is_empty() {
        return None;
    }
    replacements.sort_by_key(|(range, _)| range.start);
    let mut result = pattern.to_string();
    for (range, replacement) in replacements.into_iter().rev() {
        result.replace_range(range, &replacement);
    }
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fancy_regex::Regex;

    #[test]
    fn maps_perl_classes_and_boundaries() {
        for (pattern, expected) in [
            (r"\w+", Some("[0-9A-Za-z_]+")),
            (r"[\w-]{3}", Some("[0-9A-Za-z_-]{3}")),
            (r"\d\D", Some(r"[0-9][\x00-\x2f\x3a-\x{10FFFF}]")),
            (r"[\s;]", Some(r"[\t\n\x0c\r\x20;]")),
            (
                r"[^\W]",
                Some(r"[^\x00-\x2f\x3a-\x40\x5b-\x5e\x60\x7b-\x{10FFFF}]"),
            ),
            // Escaped backslash followed by a literal `w` is not a Perl class.
            (r"\\w", None),
            (r"plain literal", None),
        ] {
            assert_eq!(
                ascii_rewrite(pattern).as_deref(),
                expected,
                "pattern: {pattern}"
            );
        }

        let boundary = ascii_rewrite(r"\bhvb").unwrap();
        assert_eq!(boundary, format!("{ASCII_WORD_BOUNDARY}hvb"));
    }

    #[test]
    fn output_compiles_and_matches_go_boundary_semantics() {
        let vault_original = r#"\b(hvb\.[\w-]{138,300})(?:[\x60'"\s;]|\\[nr]|$)"#;
        let rewritten = ascii_rewrite(vault_original).unwrap();
        let re = Regex::new(&rewritten).expect("rewrite compiles at default size limit");

        let token = format!("hvb.{}", "Ab1-".repeat(36));
        // Go's ASCII \b sees a boundary after a CJK char; Rust's unicode \b
        // would not, silently missing the secret.
        assert!(re.is_match(&format!("token: {token} end")).unwrap());
        assert!(re.is_match(&format!("密码{token} end")).unwrap());
        // No boundary when the token abuts ASCII word characters.
        assert!(!re.is_match(&format!("xyz{token} end")).unwrap());
    }

    #[test]
    fn rewrite_is_equivalent_to_originals_on_ascii_input() {
        // Real gitleaks patterns whose originals CAN compile if given a large
        // enough delegate size limit — compare behavior against the rewrite.
        // (ASCII-only corpus: on non-ASCII input the rewrite is intentionally
        // MORE faithful to gitleaks than the unicode original.)
        let originals = [
            r#"pypi-AgEIcHlwaS5vcmc[\w-]{50,1000}"#,
            r#"(?i)[\w.-]{0,50}?(?:access|auth|(?-i:[Aa]pi|API)|credential|creds|key|passw(?:or)?d|secret|token)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([\w.=-]{10,150}|[a-z0-9][a-z0-9+/]{11,}={0,3})(?:[\x60'"\s;]|\\[nr]|$)"#,
        ];
        let corpus = [
            format!("pypi-AgEIcHlwaS5vcmc{}", "Ab1-".repeat(15)),
            format!("pypi-AgEIcHlwaS5vcmc{}", "a".repeat(49)),
            r#"api_key = "zaCELgL0imfnc8mVLWwsAawjYr4Rx""#.to_string(),
            r#"my_secret_token: 'abcd1234efgh5678'"#.to_string(),
            "password: hunter2".to_string(),
            "AUTH-CREDS := `Xy9_k2mQ8vL4nP7r`; next".to_string(),
            "no secrets here at all".to_string(),
        ];

        for pattern in originals {
            let original = fancy_regex::RegexBuilder::new(pattern)
                .delegate_size_limit(64 << 20)
                .build()
                .expect("original compiles at raised limit");
            let rewritten =
                Regex::new(&ascii_rewrite(pattern).unwrap()).expect("rewrite compiles");

            for hay in &corpus {
                let a = original.find(hay).unwrap().map(|m| (m.start(), m.end()));
                let b = rewritten.find(hay).unwrap().map(|m| (m.start(), m.end()));
                assert_eq!(a, b, "divergence on {hay:?} for pattern {pattern}");
            }
        }
    }
}
