//! search_docs tool implementation for nix-darwin documentation.

use anyhow::Result;
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::cmp::Ordering;
use std::sync::RwLock;

const NIX_DARWIN_DOCS_JSON: &str = include_str!("../../resources/nix-darwin-docs.json");
const DEFAULT_RESULT_LIMIT: usize = 3;

#[derive(Debug, Clone, Deserialize)]
struct DocsOptionEntry {
    option_path: String,
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

static FUZZY_MATCHER: Lazy<SkimMatcherV2> = Lazy::new(SkimMatcherV2::default);
const FUZZY_STRONG_THRESHOLD: i32 = 260; // skip fuzzy boosting for strong base scores
const FUZZY_MIN_BOOST: i32 = 8; // minimum fuzzy boost to apply

pub fn initialize_docs_index() {
    let mut guard = match DOCS_INDEX.write() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    if guard.is_some() {
        return;
    }

    let entries = parse_entries(NIX_DARWIN_DOCS_JSON);
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

    // Debug: log candidate names and scores
    log::debug!(
        "[search_docs] query='{}' tokens={:?} computed {} candidates before truncation",
        query,
        normalized_query.split_whitespace().collect::<Vec<_>>(),
        ranked.len()
    );
    for r in ranked.iter().take(5) {
        log::debug!(
            "[search_docs] candidate score={} path={}",
            r.score,
            r.entry.option_path,
        );
    }
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
            "{}. {}{}\n   summary: {}\n",
            i + 1,
            result.entry.option_path,
            type_suffix,
            result.entry.summary
        ));
    }

    Ok(out.trim_end().to_string())
}

fn parse_entries(json: &str) -> Vec<DocsOptionEntry> {
    match serde_json::from_str::<Vec<serde_json::Value>>(json) {
        Ok(v) => {
            let mut out: Vec<DocsOptionEntry> = Vec::with_capacity(v.len());
            for item in v.into_iter() {
                if let Some(obj) = item.as_object() {
                    let option_path = obj
                        .get("option_path")
                        .and_then(|s| s.as_str())
                        .unwrap_or("")
                        .to_string();
                    if option_path.is_empty() {
                        continue;
                    }
                    let summary = obj
                        .get("summary")
                        .and_then(|s| s.as_str())
                        .unwrap_or("")
                        .to_string();
                    let option_type = obj
                        .get("option_type")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string());

                    out.push(DocsOptionEntry {
                        option_path,
                        summary,
                        option_type,
                    });
                }
            }
            out
        }
        Err(e) => {
            log::error!("[search_docs] failed to parse nix-darwin docs JSON: {}", e);
            Vec::new()
        }
    }
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
    let summary_lower = entry.summary.to_ascii_lowercase();
    let segments: Vec<&str> = option_lower.split('.').collect();

    let mut score = 0;

    // Scoring heuristics (additive):
    // - Exact option path match: very strong signal (exact full path)
    //   weight: +500
    if option_lower == query {
        score += 500;
    }

    // - Option path contains the query anywhere: good match
    //   weight: +160
    if option_lower.contains(query) {
        score += 160;
    }

    // - Per-segment scoring (dot-separated parts of the option path):
    //   exact segment match is a very strong signal (e.g. searching "nginx"
    //   should match "services.nginx.enable"). Partial segment matches are
    //   helpful but weaker.
    //   exact segment weight: +250
    //   partial segment weight: +110
    for segment in &segments {
        if *segment == query {
            score += 250;
        } else if segment.contains(query) {
            score += 110;
        }
    }

    // - Token-level matching: allow multi-word queries to match either the
    //   option_path or the summary. Smaller weight per token to allow
    //   accumulation across multiple tokens.
    //   token-in-path weight: +50
    //   token-in-summary weight: +20
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

    // Slight preference for deeper, fully qualified option paths for shape
    // guidance: +2 points per segment.
    let mut base_score = score + (segments.len() as i32 * 2);

    // Conservative fuzzy tie-breaker: only apply when base_score is not
    // already a strong match (prevents fuzzy from outranking exact/prefix
    // matches). Tokenize the query (already passed as `tokens`) and run a
    // lightweight skim fuzzy matcher per token against the option path and
    // the summary. Scale down matcher scores so fuzzy remains a tiebreaker.
    if base_score < FUZZY_STRONG_THRESHOLD {
        let mut fuzzy_boost: i32 = 0;
        for token in tokens {
            if token.len() < 2 {
                continue;
            }
            if let Some(ms) = FuzzyMatcher::fuzzy_match(&*FUZZY_MATCHER, &entry.option_path, token)
            {
                fuzzy_boost += (ms.max(0) as i32) / 8;
            }
            if let Some(ms) = FuzzyMatcher::fuzzy_match(&*FUZZY_MATCHER, &entry.summary, token) {
                fuzzy_boost += (ms.max(0) as i32) / 16;
            }
        }
        if fuzzy_boost >= FUZZY_MIN_BOOST {
            base_score += fuzzy_boost;
        }
    }

    base_score
}

pub fn default_limit() -> usize {
    DEFAULT_RESULT_LIMIT
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_entries_loads_json() {
        let entries = parse_entries(NIX_DARWIN_DOCS_JSON);
        assert!(!entries.is_empty(), "expected parsed entries from JSON");
    }

    #[test]
    fn documentation_enable_entry_present() {
        let entries = parse_entries(NIX_DARWIN_DOCS_JSON);
        let found = entries
            .iter()
            .find(|e| e.option_path == "documentation.enable");
        assert!(found.is_some(), "documentation.enable not found in docs");
        let e = found.unwrap();
        // expect the documented type to include "boolean"
        let has_bool = e
            .option_type
            .as_deref()
            .map(|s| s.to_ascii_lowercase().contains("boolean"))
            .unwrap_or(false);
        assert!(
            has_bool,
            "documentation.enable type does not indicate boolean"
        );
    }

    #[test]
    fn sample_entries_have_summary_and_path() {
        let entries = parse_entries(NIX_DARWIN_DOCS_JSON);
        for e in entries.iter().take(50) {
            assert!(!e.option_path.is_empty(), "option_path empty");
            assert!(
                e.summary.len() > 8,
                "summary too short for {}",
                e.option_path
            );
        }
    }

    #[test]
    fn fuzzy_tiebreaker_prefers_similar_entry() {
        let query = "ngnx";
        let tokens: Vec<&str> = query.split_whitespace().collect();

        // The "close" entry is the correct spelling in docs; fuzzy should
        // prefer this when the query is misspelled.
        let entry_close = DocsOptionEntry {
            option_path: "services.nginx.enable".to_string(),
            summary: "Enable nginx service".to_string(),
            option_type: None,
        };

        let entry_far = DocsOptionEntry {
            option_path: "services.ssh.enable".to_string(),
            summary: "Enable SSH service".to_string(),
            option_type: None,
        };

        let score_close = score_entry(&entry_close, query, &tokens);
        let score_far = score_entry(&entry_far, query, &tokens);

        assert!(
            score_close > score_far,
            "expected fuzzy-preferred entry to score higher (close={} vs far={})",
            score_close,
            score_far
        );
    }
}
