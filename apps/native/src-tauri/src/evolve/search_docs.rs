//! search_docs tool implementation for nix-darwin documentation.

use anyhow::Result;
use once_cell::sync::Lazy;
use regex::Regex;
use std::cmp::Ordering;
use std::sync::RwLock;

const NIX_DARWIN_DOCS_HTML: &str = include_str!("../../resources/nix-darwin-docs.html");
const DEFAULT_RESULT_LIMIT: usize = 3;

static OPTION_ENTRY_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?s)<dt>\s*<span class="term">\s*<a id="opt-([^"]+)"></a>.*?<code class="option">\s*([^<]+?)\s*</code>.*?</dt>\s*<dd>(.*?)</dd>"#,
    )
    .expect("valid option entry regex")
});

static TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<[^>]+>").expect("valid tag regex"));
static SPACE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").expect("valid space regex"));
static TYPE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?is)Type:\s*([^\n]+?)(?:\n\s*Default:|\n\s*Declared by:|\z)")
        .expect("valid type regex")
});

#[derive(Debug, Clone)]
struct DocsOptionEntry {
    option_path: String,
    anchor_id: String,
    summary: String,
    option_type: Option<String>,
}

#[derive(Debug, Clone)]
struct ScoredResult {
    score: i32,
    entry: DocsOptionEntry,
}

#[derive(Debug, Default)]
struct DocsIndex {
    entries: Vec<DocsOptionEntry>,
}

static DOCS_INDEX: Lazy<RwLock<Option<DocsIndex>>> = Lazy::new(|| RwLock::new(None));

pub fn initialize_docs_index() {
    let mut guard = match DOCS_INDEX.write() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    if guard.is_some() {
        return;
    }

    let entries = parse_entries(NIX_DARWIN_DOCS_HTML);
    log::info!(
        "[search_docs] initialized nix-darwin docs index with {} option entries",
        entries.len()
    );
    *guard = Some(DocsIndex { entries });
}

pub fn execute_search_docs(query: &str, limit: usize) -> Result<String> {
    initialize_docs_index();

    let guard = match DOCS_INDEX.read() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    let Some(index) = guard.as_ref() else {
        return Ok("No docs index available".to_string());
    };

    let normalized_query = query.trim().to_ascii_lowercase();
    if normalized_query.is_empty() {
        return Ok("search_docs requires a non-empty query".to_string());
    }

    let max_results = limit.clamp(1, 10);
    let mut ranked = rank_entries(&index.entries, &normalized_query);
    ranked.truncate(max_results);

    if ranked.is_empty() {
        return Ok(format!("No option matches found for '{}'", query));
    }

    let mut out = String::new();
    out.push_str(&format!(
        "Top {} nix-darwin option matches for '{}':\n",
        ranked.len(),
        query
    ));

    for (i, result) in ranked.iter().enumerate() {
        let type_suffix = result
            .entry
            .option_type
            .as_ref()
            .map(|t| format!(" | type: {}", t))
            .unwrap_or_default();
        out.push_str(&format!(
            "{}. {}{}\n   anchor: #{}\n   summary: {}\n",
            i + 1,
            result.entry.option_path,
            type_suffix,
            result.entry.anchor_id,
            result.entry.summary
        ));
    }

    Ok(out.trim_end().to_string())
}

fn parse_entries(html: &str) -> Vec<DocsOptionEntry> {
    OPTION_ENTRY_RE
        .captures_iter(html)
        .filter_map(|caps| {
            let anchor_id = caps.get(1)?.as_str().trim().to_string();
            let option_path = decode_html_entities(caps.get(2)?.as_str().trim());
            let dd_html = caps.get(3)?.as_str();
            let dd_text = normalize_whitespace(&decode_html_entities(&strip_html_tags(dd_html)));

            let summary = first_sentence(&dd_text, 220);
            let option_type = extract_type(&dd_text);

            Some(DocsOptionEntry {
                option_path,
                anchor_id,
                summary,
                option_type,
            })
        })
        .collect()
}

fn rank_entries(entries: &[DocsOptionEntry], query: &str) -> Vec<ScoredResult> {
    let tokens: Vec<&str> = query.split_whitespace().filter(|t| !t.is_empty()).collect();

    let mut scored: Vec<ScoredResult> = entries
        .iter()
        .filter_map(|entry| {
            let score = score_entry(entry, query, &tokens);
            (score > 0).then(|| ScoredResult {
                score,
                entry: entry.clone(),
            })
        })
        .collect();

    scored.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.entry.option_path.cmp(&b.entry.option_path))
            .then(Ordering::Equal)
    });
    scored
}

fn score_entry(entry: &DocsOptionEntry, query: &str, tokens: &[&str]) -> i32 {
    let option_lower = entry.option_path.to_ascii_lowercase();
    let anchor_lower = entry.anchor_id.to_ascii_lowercase();
    let summary_lower = entry.summary.to_ascii_lowercase();
    let segments: Vec<&str> = option_lower.split('.').collect();

    let mut score = 0;

    if option_lower == query {
        score += 500;
    }

    if anchor_lower == query || anchor_lower.ends_with(&format!(".{query}")) {
        score += 260;
    }

    if option_lower.contains(query) {
        score += 160;
    }

    for segment in &segments {
        if *segment == query {
            score += 250;
        } else if segment.contains(query) {
            score += 110;
        }
    }

    for token in tokens {
        if token.len() < 2 {
            continue;
        }

        if option_lower.contains(token) {
            score += 50;
        }
        if summary_lower.contains(token) {
            score += 20;
        }
    }

    // Slight preference for deeper, fully qualified option paths for shape guidance.
    score + (segments.len() as i32 * 2)
}

fn strip_html_tags(s: &str) -> String {
    TAG_RE.replace_all(s, " ").into_owned()
}

fn normalize_whitespace(s: &str) -> String {
    SPACE_RE.replace_all(s, " ").trim().to_string()
}

fn decode_html_entities(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#39;", "'")
}

fn extract_type(s: &str) -> Option<String> {
    TYPE_RE.captures(s).and_then(|caps| {
        caps.get(1)
            .map(|m| normalize_whitespace(m.as_str()))
            .filter(|v| !v.is_empty())
    })
}

fn first_sentence(s: &str, max_len: usize) -> String {
    let sentence = s.split('.').next().unwrap_or(s).trim();
    if sentence.len() <= max_len {
        sentence.to_string()
    } else {
        format!("{}...", &sentence[..max_len])
    }
}

pub fn default_limit() -> usize {
    DEFAULT_RESULT_LIMIT
}
