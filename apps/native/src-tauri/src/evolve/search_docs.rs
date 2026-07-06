//! search_docs tool implementation for nix-darwin and home-manager documentation.

use anyhow::Result;
use fuzzy_matcher::FuzzyMatcher;
use fuzzy_matcher::skim::SkimMatcherV2;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::{
    RwLock,
    atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Runtime};

use crate::commands::debug::TimerGuard;
pub use crate::docs::docs_system::DocsSource;
use crate::docs::docs_system::{DocsIndex, DocsIndexLoader, DocsOptionEntry};
use crate::docs::generated_docs::GeneratedDocsIndexLoader;
use crate::docs::static_docs::StaticDocsIndexLoader;

/// Docs index is eagerly loaded by the main app and loaded lazily by the CLI.
/// We can consider changing this in the future to optimize startup time.
static DOCS_INDEX: Lazy<RwLock<Option<DocsIndex>>> = Lazy::new(|| RwLock::new(None));

/// Guard to avoid spawning multiple expensive generated-docs builds.
///
/// Lazy tool calls can race with startup initialization, so this atomic ensures
/// only one background refresh is in flight. It is reset after failures so a
/// later app-aware initialization can retry.
static GENERATED_DOCS_REFRESH_STARTED: AtomicBool = AtomicBool::new(false);

/// Simple fuzzy matching to avoid adding a more heavyweight indexed or vector search
/// dependency for this initial implementation, since the dataset is relatively small and we want to keep the tool self-contained.
static FUZZY_MATCHER: Lazy<SkimMatcherV2> = Lazy::new(SkimMatcherV2::default);

/// Skip fuzzy boosting for strong base scores to avoid outranking exact/prefix matches with fuzzy noise
const FUZZY_STRONG_THRESHOLD: i32 = 260;

/// Minimum fuzzy boost to consider a match relevant at all -- helps prevent noisy fuzzy matches
/// from outranking better non-fuzzy matches, and keeps results more relevant when the query is very short.
const FUZZY_MIN_BOOST: i32 = 8; // minimum fuzzy boost to apply

/// Minimum score to consider a match -- currently this is set based on observations in test results,
/// but we may consider a data-driven calibration in the future.
const MIN_SCORE: i32 = 30;

/// Default limit for search_docs results, can be overridden by the query.
const DEFAULT_RESULT_LIMIT: usize = 10;

// Max limit for search_docs results to prevent token bonfires or overwhelming the agent.
const MAX_RESULT_LIMIT: usize = 20;

/// Top-level categories large enough to warrant one doc key per second-level
/// subcategory. Doc keys for options under these are `<source>/<top>/<sub>.md`
/// instead of `<source>/<top>.md`, so the agent reads a focused slice rather
/// than a giant `programs.md` / `services.md`.
const SPLIT_KEYS: &[&str] = &["programs", "services"];

/// Safety cap on how many options a single "read doc" response can include, to
/// avoid token bonfires if a split subcategory is unexpectedly large.
const MAX_DOC_OPTIONS: usize = 400;

/// Sentinel string included in the response when no results are found, to allow the agent
/// to reliably detect this case and avoid retrying with similar queries or different limits,
/// which would be futile and could cause token overuse.
const NO_RESULTS_SENTINEL: &str = "SEARCH_DOCS_NO_RESULTS";

/// Aggregate for a single doc key. Doc keys are synthetic markdown-style paths
/// (e.g. `home-manager/programs/git.md`) used purely as stable grouping labels
/// for options — no such files exist on disk.
#[derive(Debug, Default)]
struct DocGroup {
    /// Number of options contained in the doc.
    count: usize,
    /// Best per-option relevance score within the doc (for key-search ranking).
    best_score: i32,
    /// A representative matching option path, shown as a hint.
    best_path: String,
    source: Option<DocsSource>,
}

/// Compute the doc key grouping an option: `<source>/<top>.md`, split one
/// level deeper for the large `SPLIT_KEYS` categories.
fn doc_key_for(source: DocsSource, option_path: &str) -> String {
    let segments: Vec<&str> = option_path.split('.').collect();
    let first = segments.first().copied().unwrap_or("");
    if first.is_empty() {
        return format!("{}/index.md", source);
    }
    if SPLIT_KEYS.contains(&first) && segments.len() >= 2 {
        format!("{}/{}/{}.md", source, first, segments[1])
    } else {
        format!("{}/{}.md", source, first)
    }
}

/// Normalize a doc path/key for comparison: lowercase, trim, drop a leading
/// `./`, a trailing `/`, and an optional `.md` suffix.
fn normalize_doc_path(p: &str) -> String {
    let mut s = p.trim().to_ascii_lowercase();
    if let Some(rest) = s.strip_prefix("./") {
        s = rest.to_string();
    }
    s = s.trim_matches('/').to_string();
    if let Some(rest) = s.strip_suffix(".md") {
        s = rest.to_string();
    }
    s
}

/// Check whether an index has already been installed without taking a write lock.
fn docs_index_initialized() -> bool {
    match DOCS_INDEX.read() {
        Ok(guard) => guard.is_some(),
        Err(poisoned) => poisoned.into_inner().is_some(),
    }
}

/// Replace the global docs index (i.e. swap in a newly loaded one) and log the source/counts.
/// Static and generated indexes share the same in-memory shape, so swapping is
/// just a single write under the `RwLock`. Readers either see the old complete
/// index or the new complete index.
fn install_docs_index(index: DocsIndex, origin: &str) {
    let darwin_count = index
        .entries
        .iter()
        .filter(|entry| entry.source == DocsSource::NixDarwin)
        .count();
    let hm_count = index
        .entries
        .iter()
        .filter(|entry| entry.source == DocsSource::HomeManager)
        .count();
    let total = index.entries.len();

    let mut guard = match DOCS_INDEX.write() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    *guard = Some(index);

    log::info!(
        "[search_docs] build docs index from {} with {} nix-darwin + {} home-manager = {} total entries",
        origin,
        darwin_count,
        hm_count,
        total,
    );
}

/// Install bundled static docs if nothing has initialized the index yet.
/// This is the fast fallback path used by CLI/lazy search calls and by app
/// startup when generated docs are not already cached.
fn install_static_docs_index_if_needed() {
    if docs_index_initialized() {
        return;
    }

    let _timer = TimerGuard::new("install_static_docs_index_if_needed");
    match StaticDocsIndexLoader::new().load() {
        Ok(index) => {
            if !docs_index_initialized() {
                install_docs_index(index, "static docs");
            }
        }
        Err(err) => log::error!("[search_docs] failed to initialize static docs index: {err}"),
    }
}

/// Delays between background generation attempts. Failures are usually
/// transient (network not up yet after login, a flake fetch timing out), so a
/// few spaced retries recover within the session instead of leaving it on
/// static docs until the next launch.
const GENERATED_DOCS_RETRY_DELAYS: &[std::time::Duration] = &[
    std::time::Duration::from_secs(30),
    std::time::Duration::from_secs(2 * 60),
    std::time::Duration::from_secs(10 * 60),
];

/// Generate runtime docs in the background and swap them in when complete.
/// The foreground path has already installed static docs before this is called,
/// so a slow Nix build does not block `search_docs`. On success, the generated
/// index atomically replaces the static one. Failures are retried with backoff;
/// once the retries are exhausted the static index stays active for the rest
/// of the session and the refresh guard is reset for a future initialization.
fn start_generated_docs_refresh<R: Runtime>(app: AppHandle<R>) {
    if GENERATED_DOCS_REFRESH_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn_blocking(move || {
        let _timer = TimerGuard::new("start_generated_docs_refresh");
        let mut delays = GENERATED_DOCS_RETRY_DELAYS.iter();
        loop {
            match GeneratedDocsIndexLoader::for_app(&app).and_then(|loader| loader.load()) {
                Ok(index) => return install_docs_index(index, "generated docs"),
                Err(err) => match delays.next() {
                    Some(delay) => {
                        log::warn!(
                            "[search_docs] failed to generate docs index (retrying in {}s): {err:#}",
                            delay.as_secs()
                        );
                        std::thread::sleep(*delay);
                    }
                    None => {
                        GENERATED_DOCS_REFRESH_STARTED.store(false, Ordering::SeqCst);
                        log::warn!(
                            "[search_docs] failed to generate docs index; giving up for this session: {err:#}"
                        );
                        return;
                    }
                },
            }
        }
    });
}

/// Initialize docs without app context.
/// This path is used by CLI/lazy tool execution where a Tauri `AppHandle` is not
/// available. It installs static bundled docs only; app startup should call
/// `initialize_docs_index_for_app` so it can use generated cached docs.
pub fn initialize_docs_index() {
    install_static_docs_index_if_needed();
}

/// Initialize docs for the GUI app using the preferred generated-docs flow.
///
/// Order matters:
/// 1. If both generated docs files already exist in app data, use them
///    immediately.
/// 2. Otherwise install static bundled docs immediately so `search_docs` is
///    usable.
/// 3. Start background generation; when it succeeds, replace the static index
///    with the generated one.
pub fn initialize_docs_index_for_app<R: Runtime>(app: AppHandle<R>) {
    let _timer = TimerGuard::new("initialize_docs_index_for_app");

    match GeneratedDocsIndexLoader::for_app(&app).and_then(|loader| loader.load_cached()) {
        Ok(index) => {
            install_docs_index(index, "generated docs cache");
            return;
        }
        Err(err) => {
            log::debug!("[search_docs] generated docs cache not ready: {err:#}");
        }
    }

    install_static_docs_index_if_needed();
    start_generated_docs_refresh(app);
}

/// Entry point for the search_docs tool.
///
/// Two complementary modes keep token usage low:
/// - Key search (default): given `query`, return a compact ranked list of doc
///   keys (markdown-style grouping labels, e.g. `home-manager/programs/git.md`)
///   with an option count and a representative matching option. No per-option
///   summaries are emitted here.
/// - Read doc: given `doc_path` (one of the keys above), return the flat table
///   of every option in that doc, keyed by its fully-qualified dotted path with
///   type and summary.
///
/// This lets the agent first discover *which* doc is relevant by matching
/// filenames, then read only that doc's options, instead of paying for full
/// option summaries on every search.
pub fn execute_search_docs(
    query: &str,
    doc_path: Option<&str>,
    limit: usize,
    source_filter: Option<DocsSource>,
) -> Result<String> {
    initialize_docs_index();

    let guard = match DOCS_INDEX.read() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    let Some(index) = guard.as_ref() else {
        return Ok("No docs index available".to_string());
    };

    // Read mode: a specific doc key/path was requested.
    if let Some(path) = doc_path.map(str::trim).filter(|p| !p.is_empty()) {
        return Ok(read_doc(index, path, source_filter));
    }

    // Key-search mode.
    let normalized_query = query.trim().to_ascii_lowercase();
    if normalized_query.is_empty() {
        return Ok(
            "search_docs requires a non-empty `query` (to find docs) or a `path` (to read one)"
                .to_string(),
        );
    }

    let entries: Vec<&DocsOptionEntry> = index
        .entries
        .iter()
        .filter(|e| source_filter.is_none_or(|s| e.source == s))
        .collect();

    let max_results = limit.clamp(1, MAX_RESULT_LIMIT);
    let ranked = rank_doc_keys(&entries, &normalized_query);

    log::debug!(
        "[search_docs] key-search query='{}' source={:?} matched {} docs before truncation",
        query,
        source_filter,
        ranked.len()
    );

    if ranked.is_empty() {
        return Ok(format_no_results_message(query, source_filter));
    }

    let source_label = source_filter.map(|s| format!("{} ", s)).unwrap_or_default();
    let shown = ranked.len().min(max_results);
    let mut out = format!(
        "Top {} {}doc(s) matching '{}'. Read one with search_docs(path=\"<key>\"):\n",
        shown, source_label, query
    );

    for (i, (key, group)) in ranked.iter().take(max_results).enumerate() {
        let source_tag = match source_filter {
            Some(_) => String::new(),
            None => group
                .source
                .map(|s| format!(" [{}]", s))
                .unwrap_or_default(),
        };
        let hint = if group.best_path.is_empty() {
            String::new()
        } else {
            format!(" — e.g. {}", group.best_path)
        };
        out.push_str(&format!(
            "{}. {} ({} option{}){}{}\n",
            i + 1,
            key,
            group.count,
            if group.count == 1 { "" } else { "s" },
            source_tag,
            hint,
        ));
    }

    Ok(out.trim_end().to_string())
}

/// Read mode: render the flat option table for a requested doc key. If the
/// requested path resolves to multiple docs (e.g. a split top-level like
/// `nix-darwin/programs`), list those docs instead so the agent can pick one.
fn read_doc(index: &DocsIndex, requested: &str, source_filter: Option<DocsSource>) -> String {
    let target = normalize_doc_path(requested);
    let child_prefix = format!("{}/", target);

    let mut exact: Vec<&DocsOptionEntry> = Vec::new();
    let mut child_keys: std::collections::BTreeMap<String, usize> =
        std::collections::BTreeMap::new();

    for entry in index
        .entries
        .iter()
        .filter(|e| source_filter.is_none_or(|s| e.source == s))
    {
        let key = doc_key_for(entry.source, &entry.option_path);
        let key_norm = normalize_doc_path(&key);
        if key_norm == target {
            exact.push(entry);
        } else if key_norm.starts_with(child_prefix.as_str()) {
            *child_keys.entry(key).or_insert(0) += 1;
        }
    }

    if !exact.is_empty() {
        exact.sort_by(|a, b| a.option_path.cmp(&b.option_path));
        let total = exact.len();
        let mut out = format!(
            "{} ({} option{}):\n\noption | type | summary\n",
            requested.trim(),
            total,
            if total == 1 { "" } else { "s" },
        );
        for entry in exact.iter().take(MAX_DOC_OPTIONS) {
            let type_cell = entry.option_type.as_deref().unwrap_or("");
            out.push_str(&format!(
                "{} | {} | {}\n",
                entry.option_path, type_cell, entry.summary
            ));
        }
        if total > MAX_DOC_OPTIONS {
            out.push_str(&format!(
                "... {} more options omitted (narrow your read or filter by source)\n",
                total - MAX_DOC_OPTIONS
            ));
        }
        return out.trim_end().to_string();
    }

    if !child_keys.is_empty() {
        let mut out = format!(
            "'{}' is split into multiple docs. Read one of:\n",
            requested.trim()
        );
        for (i, (key, count)) in child_keys.iter().enumerate() {
            out.push_str(&format!(
                "{}. {} ({} option{})\n",
                i + 1,
                key,
                count,
                if *count == 1 { "" } else { "s" }
            ));
        }
        return out.trim_end().to_string();
    }

    format!(
        "{}: no doc found at path '{}'. Use search_docs(query=...) to discover valid doc keys.",
        NO_RESULTS_SENTINEL,
        requested.trim()
    )
}

fn format_no_results_message(query: &str, source_filter: Option<DocsSource>) -> String {
    let scope = source_filter
        .map(|s| format!("{} ", s))
        .unwrap_or_else(|| "nix-darwin or home-manager ".to_string());
    format!(
        "{}: query='{}'. No {}docs matched this query. Treat this as definitive and do not retry with similar wording or different limits.",
        NO_RESULTS_SENTINEL, query, scope
    )
}

/// Rank doc keys by the best per-option relevance score within each doc, with a
/// bonus when the doc key (filename/category name) itself matches the query.
fn rank_doc_keys(entries: &[&DocsOptionEntry], query: &str) -> Vec<(String, DocGroup)> {
    let tokens: Vec<&str> = query.split_whitespace().filter(|t| !t.is_empty()).collect();

    let mut groups: HashMap<String, DocGroup> = HashMap::new();
    for entry in entries {
        let key = doc_key_for(entry.source, &entry.option_path);
        let score = score_entry(entry, query, &tokens);
        let group = groups.entry(key).or_default();
        group.count += 1;
        group.source.get_or_insert(entry.source);
        if score > group.best_score {
            group.best_score = score;
            group.best_path = entry.option_path.clone();
        }
    }

    let mut ranked: Vec<(String, DocGroup)> = groups
        .into_iter()
        .map(|(key, mut group)| {
            group.best_score += score_doc_key(&key, query, &tokens);
            (key, group)
        })
        .filter(|(_, group)| group.best_score >= MIN_SCORE)
        .collect();

    ranked.sort_by(|a, b| {
        b.1.best_score
            .cmp(&a.1.best_score)
            .then_with(|| a.0.cmp(&b.0))
    });
    ranked
}

/// Score how well a doc key (its category/subcategory name) matches the query.
/// Operates on the label after the source prefix and without the `.md` suffix,
/// e.g. `programs/git`.
fn score_doc_key(doc_key: &str, query: &str, tokens: &[&str]) -> i32 {
    let label = doc_key
        .split_once('/')
        .map(|(_, rest)| rest)
        .unwrap_or(doc_key)
        .trim_end_matches(".md")
        .to_ascii_lowercase();
    let segments: Vec<&str> = label.split(['/', '.']).filter(|s| !s.is_empty()).collect();

    let mut score = 0;
    if label == query {
        score += 400;
    }
    if label.contains(query) {
        score += 120;
    }
    for segment in &segments {
        if *segment == query {
            score += 250;
        } else if segment.contains(query) {
            score += 90;
        }
    }
    for token in tokens {
        if token.len() < 2 {
            continue;
        }
        if label.contains(token) {
            score += 40;
        }
    }
    score
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

pub fn max_limit() -> usize {
    MAX_RESULT_LIMIT
}

#[cfg(test)]
mod tests {
    use super::*;

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
            source: DocsSource::NixDarwin,
        };

        let entry_far = DocsOptionEntry {
            option_path: "services.ssh.enable".to_string(),
            summary: "Enable SSH service".to_string(),
            option_type: None,
            source: DocsSource::NixDarwin,
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

    #[test]
    fn no_results_message_has_sentinel_and_query() {
        let query = "zzzzzzzzzzzzzzzzzzzzqqq";
        let response =
            execute_search_docs(query, None, 3, None).expect("search_docs should succeed");

        assert!(
            response.starts_with(NO_RESULTS_SENTINEL),
            "expected no-results sentinel in response: {}",
            response
        );
        assert!(
            response.contains(query),
            "expected query to be echoed in no-results response: {}",
            response
        );
    }

    #[test]
    fn source_filter_returns_only_matching_source() {
        let result_darwin = execute_search_docs("enable", None, 5, Some(DocsSource::NixDarwin))
            .expect("search should succeed");
        assert!(
            !result_darwin.contains("home-manager/"),
            "filtered nix-darwin results should not contain home-manager doc keys"
        );

        let result_hm = execute_search_docs("enable", None, 5, Some(DocsSource::HomeManager))
            .expect("search should succeed");
        assert!(
            !result_hm.contains("nix-darwin/"),
            "filtered home-manager results should not contain nix-darwin doc keys"
        );
    }

    #[test]
    fn unfiltered_search_returns_both_sources() {
        // A broad query should return results from both sources
        let result = execute_search_docs("enable", None, 10, None).expect("search should succeed");
        assert!(
            !result.starts_with(NO_RESULTS_SENTINEL),
            "expected results for broad query 'enable'"
        );
    }

    #[test]
    fn limit_parameter_restricts_number_of_results() {
        let result = execute_search_docs("enable", None, 3, None).expect("search should succeed");
        let lines: Vec<&str> = result.lines().collect();
        // One header line + one line per doc result, capped at the limit.
        assert!(
            lines.len() <= 4,
            "expected at most 3 doc results plus header line, got {} lines",
            lines.len()
        );
    }

    #[test]
    fn max_limit_enforced() {
        let result = execute_search_docs("enable", None, 100, None).expect("search should succeed");
        let lines: Vec<&str> = result.lines().collect();
        // Limit is clamped to MAX_RESULT_LIMIT; one header + one line per result.
        assert!(
            lines.len() <= MAX_RESULT_LIMIT + 1,
            "expected at most {} results plus header line, got {} lines",
            MAX_RESULT_LIMIT,
            lines.len()
        );
    }

    #[test]
    fn doc_key_for_splits_programs_and_services() {
        assert_eq!(
            doc_key_for(DocsSource::HomeManager, "programs.git.enable"),
            "home-manager/programs/git.md"
        );
        assert_eq!(
            doc_key_for(DocsSource::NixDarwin, "services.nginx.enable"),
            "nix-darwin/services/nginx.md"
        );
        // Non-split top-level categories collapse to one file.
        assert_eq!(
            doc_key_for(DocsSource::NixDarwin, "homebrew.casks"),
            "nix-darwin/homebrew.md"
        );
    }

    #[test]
    fn key_search_returns_doc_keys_not_option_dump() {
        let result = execute_search_docs("git", None, 5, Some(DocsSource::HomeManager))
            .expect("search should succeed");
        assert!(
            result.contains("home-manager/programs/git.md"),
            "expected the git doc key in results, got: {}",
            result
        );
        // Discovery output should not include per-option summary blocks.
        assert!(
            !result.contains("\n   summary:"),
            "key search should not emit per-option summaries: {}",
            result
        );
    }

    #[test]
    fn read_doc_returns_flat_table_of_options() {
        let result = execute_search_docs("", Some("home-manager/programs/git.md"), 10, None)
            .expect("read should succeed");
        assert!(
            result.contains("option | type | summary"),
            "expected a flat table header, got: {}",
            result
        );
        assert!(
            result.contains("programs.git."),
            "expected dotted option paths under programs.git, got: {}",
            result
        );
    }

    #[test]
    fn read_doc_accepts_key_without_md_suffix() {
        let with = execute_search_docs("", Some("home-manager/programs/git.md"), 10, None)
            .expect("read should succeed");
        let without = execute_search_docs("", Some("home-manager/programs/git"), 10, None)
            .expect("read should succeed");
        assert!(without.contains("programs.git."), "got: {}", without);
        // Both forms should resolve to the same doc (same option count line shape).
        assert_eq!(
            with.lines().count(),
            without.lines().count(),
            "normalized path should resolve to the same doc"
        );
    }

    #[test]
    fn read_doc_unknown_path_returns_sentinel() {
        let result = execute_search_docs("", Some("home-manager/does/not/exist.md"), 10, None)
            .expect("read should succeed");
        assert!(
            result.starts_with(NO_RESULTS_SENTINEL),
            "expected no-results sentinel for unknown doc path: {}",
            result
        );
    }
}
