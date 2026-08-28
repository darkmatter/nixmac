//! search_packages tool implementation

use super::utils::truncate_error;
use anyhow::Result;
use log::info;
use std::process::Command;

/// Indicates whether this package looks like something that we think should be
/// installed via Homebrew vs. Nix. This is just a heuristic to help users avoid installing things like
/// GUI apps via Nix when they might be better off with Homebrew Cask, etc.
#[derive(Debug, serde::Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SearchResultInstallTarget {
    // Should be installed as a Homebrew package (e.g. GUI apps, language servers, etc.)
    Homebrew,
    // May be installed either as Homebrew or nix-native package.
    Either,
    // Should be installed as a nix-native system package (e.g. CLI tools, libraries, etc.)
    System,
    // Package is not available on the host platform (e.g. no Darwin support, etc.)
    UnavailableOnHostPlatform,
    // Don't try to install -- package is broken etc.
    None,
}

#[derive(Debug, serde::Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchPackageResult {
    pub name: String,
    pub attr_path: String,
    pub channel: String,
    pub version: String,
    pub description: String,
    pub install_via: SearchResultInstallTarget,
    pub additional_info: Option<String>,
}

/// Package metadata returned by `nix search`, before the comparatively expensive
/// derivation classification step.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SearchPackageCandidate {
    name: String,
    attr_path: String,
    channel: String,
    version: String,
    description: String,
}

/// Package metadata common to both `SearchPackageCandidate` (pre-classification) and `SearchPackageResult` (post).
trait PackageMetadata {
    fn name(&self) -> &str;
    fn attr_path(&self) -> &str;
    fn description(&self) -> &str;
}

impl PackageMetadata for SearchPackageCandidate {
    fn name(&self) -> &str {
        &self.name
    }

    fn attr_path(&self) -> &str {
        &self.attr_path
    }

    fn description(&self) -> &str {
        &self.description
    }
}

impl PackageMetadata for SearchPackageResult {
    fn name(&self) -> &str {
        &self.name
    }

    fn attr_path(&self) -> &str {
        &self.attr_path
    }

    fn description(&self) -> &str {
        &self.description
    }
}

/// Wrapper for `nix registry list` that returns the raw output as a string, or an error if the command fails.
/// Clients can parse it themselves.
fn nix_registry_list(config_dir: &str) -> Result<String> {
    let mut cmd = Command::new("nix");
    cmd.args(["registry", "list"])
        .current_dir(config_dir)
        .env("PATH", crate::system::nix::get_nix_path())
        .env("NIX_CONFIG", "experimental-features = nix-command flakes");

    let output = cmd.output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let truncated_stderr = truncate_error(&stderr, 8000);
        return Err(anyhow::anyhow!(
            "nix registry list failed with status {:?}: {}",
            output.status.code(),
            truncated_stderr
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Determine prior to searching whether a channel is registered and can be searched,
/// to avoid unnecessary command execution and errors.
/// Check if the output contains the channel in a "flake:channel" format.
fn channel_is_registered(registry_list: &str, channel: &str) -> bool {
    // Split each line by whitespace and check if any token equals "flake:<channel>".
    // Avoids partial matches.
    let channel_pattern = format!("flake:{}", channel);
    registry_list.lines().any(|line| {
        line.split_whitespace()
            .any(|token| token == channel_pattern)
    })
}

/// Escape a literal for the POSIX ERE syntax used by `nix search`.
/// Do not use `regex::escape`: it targets Rust regex syntax and escapes
/// additional characters whose backslash-escaped forms are not valid
/// portable POSIX ERE.
fn ere_escape(term: &str) -> String {
    let mut out = String::with_capacity(term.len() + 2);
    for c in term.chars() {
        if r#"\.[(){}*+?^$|"#.contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Splits the query terms into the appropriate argument(s) for the nix search command, handling regex vs. non-regex searches.
fn build_search_queries(query: &str, use_regex: bool) -> Result<Vec<String>> {
    if use_regex {
        return Ok(vec![query.to_string()]);
    }

    let terms = query.split_whitespace().map(ere_escape).collect::<Vec<_>>();

    if terms.is_empty() {
        anyhow::bail!("package search query cannot be empty");
    }

    Ok(terms)
}

/// Search a single channel and return its unclassified package candidates.
fn search_single_channel(
    config_dir: &str,
    query_term: &str,
    use_regex: bool,
    channel: &str,
) -> Result<Vec<SearchPackageCandidate>> {
    let search_queries = build_search_queries(query_term, use_regex)?;

    let mut cmd = Command::new("nix");
    cmd.args(["search", channel]);

    cmd.args(&search_queries)
        .arg("--json")
        .current_dir(config_dir)
        .env("PATH", crate::system::nix::get_nix_path())
        .env("NIX_CONFIG", "experimental-features = nix-command flakes");

    let output = cmd.output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let truncated_stderr = truncate_error(&stderr, 8000);
        return Err(anyhow::anyhow!(
            "nix search failed with status {:?}: {}",
            output.status.code(),
            truncated_stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    process_search_output(&stdout, channel)
}

/// Parse all candidates from the JSON output of a nix search command.
fn process_search_output(
    search_cmd_output: &str,
    channel: &str,
) -> Result<Vec<SearchPackageCandidate>> {
    let parsed = serde_json::from_str::<serde_json::Value>(search_cmd_output)
        .map_err(|e| anyhow::anyhow!("Failed to parse JSON output from nix search: {}", e))?;

    let mut results = Vec::new();

    if let Some(value) = parsed.as_object() {
        for (attr_path, pkg) in value {
            let name = attr_path
                .split('.')
                .next_back()
                .unwrap_or(attr_path)
                .to_string();
            results.push(SearchPackageCandidate {
                name,
                attr_path: attr_path.clone(),
                channel: channel.to_string(),
                version: pkg
                    .get("version")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                description: pkg
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("No description")
                    .to_string(),
            });
        }
    }

    Ok(results)
}

/// Computes a relevance bonus for package attribute names with fewer terms.
/// A top-level package is a particularly strong signal that it is the package a
/// user intended, while deeper package-set entries receive progressively less.
fn fewer_terms_relevance_bonus(terms: &[&str]) -> i32 {
    match terms.len() {
        0 => 0,
        1 => 200,
        2 => 100,
        num_terms => 100 / num_terms as i32,
    }
}

/// Compute a relevance score for package metadata based on the query terms.
fn relevance_score(result: &impl PackageMetadata, query: &str) -> i32 {
    let query = query.to_lowercase();
    let terms = query.split_whitespace().collect::<Vec<_>>();

    let name = result.name().to_lowercase();
    let attr = result.attr_path().to_lowercase();
    let description = result.description().to_lowercase();

    // `nix search` prefixes attribute paths with `legacyPackages.<system>`.
    // Score the remaining package attribute, so `spotify` gets a larger bonus
    // than a nested package such as `haskellPackages.spotify`.
    let package_attr_terms = attr.split('.').skip(2).collect::<Vec<_>>();

    let normalized_query = query.replace([' ', '_'], "-");

    let mut score = 0;

    // Exact-ish package identity should dominate, but give a bonus to fewer terms in the name.
    if name == query || attr.ends_with(&format!(".{query}")) {
        score += 1000;
    }

    if name == normalized_query || attr.ends_with(&format!(".{normalized_query}")) {
        score += 900;
    }

    // Strong prefix matches.
    if name.starts_with(&query) {
        score += 500;
    }

    if name.starts_with(&normalized_query) {
        score += 450;
    }

    // All terms in package name is much stronger than description-only.
    if terms.iter().all(|term| name.contains(term)) {
        score += 300;
    }

    if terms.iter().all(|term| attr.contains(term)) {
        score += 200;
    }

    // Individual term weighting.
    for term in &terms {
        if name.contains(term) {
            score += 50;
        }

        if attr.contains(term) {
            score += 25;
        }

        if description.contains(term) {
            score += 5;
        }
    }

    score += fewer_terms_relevance_bonus(&package_attr_terms);

    score
}

/// Deduplicate and rank all lightweight candidates, truncate them to the requested
/// limit, and only then run the expensive derivation classifier.
fn process_results<F>(
    results: Vec<SearchPackageCandidate>,
    query: &str,
    limit: u64,
    package_classifier: &F,
) -> Result<Vec<SearchPackageResult>>
where
    F: Fn(&str, &str) -> (SearchResultInstallTarget, Option<String>),
{
    let mut unique_results = Vec::new();
    let mut seen_attr_paths = std::collections::HashSet::new();

    for result in results {
        if !seen_attr_paths.contains(&result.attr_path) {
            seen_attr_paths.insert(result.attr_path.clone());
            unique_results.push(result);
        }
    }

    // Sort by relevance score in descending order.
    unique_results.sort_by(|a, b| {
        let score_a = relevance_score(a, query);
        let score_b = relevance_score(b, query);
        score_b.cmp(&score_a)
    });

    // Limit the number of results.
    if unique_results.len() > limit as usize {
        unique_results.truncate(limit as usize);
    }

    Ok(unique_results
        .into_iter()
        .filter_map(|candidate| {
            let (install_via, additional_info) =
                package_classifier(&candidate.channel, &candidate.attr_path);

            if install_via == SearchResultInstallTarget::UnavailableOnHostPlatform {
                return None;
            }

            Some(SearchPackageResult {
                name: candidate.name,
                attr_path: candidate.attr_path,
                channel: candidate.channel,
                version: candidate.version,
                description: candidate.description,
                install_via,
                additional_info,
            })
        })
        .collect())
}

/// Execute a search_packages tool call
pub fn execute_search_packages(
    config_dir: &str,
    query: &str,
    limit: u64,
    use_regex: bool,
    channels: &[String],
) -> Result<Vec<SearchPackageResult>> {
    info!(
        "Searching for packages matching: '{}' (regex: {}, channels: {:?})",
        query, use_regex, channels
    );
    let registry_list = nix_registry_list(config_dir)?;

    // 1. Collect results from each channel.
    let mut results = Vec::new();
    for channel in channels {
        if !channel_is_registered(&registry_list, channel) {
            // CONSIDER: Whether we need to surface this to the agent somehow.
            log::warn!(
                "Channel '{}' is not registered, skipping search for this channel",
                channel
            );
            continue;
        }

        let channel_results = search_single_channel(config_dir, query, use_regex, channel)?;
        results.push((channel.clone(), channel_results));
    }

    // 2. Process the full results.
    let processed = process_results(
        results.into_iter().flat_map(|(_, r)| r).collect(),
        query,
        limit,
        &classify_package,
    )?;
    Ok(processed)
}

/// Heuristically classify a nix derivation to determine if it looks like a GUI app (Homebrew Cask-like)
/// or a CLI / nix-native package. This is based on the presence of certain keywords in the derivation output.
fn classify_derivation(drv: &str) -> SearchResultInstallTarget {
    // Explicit GUI packaging
    if drv.contains(".app")
        || drv.contains(".desktop")
        || drv.contains("Applications/")
        || drv.contains("wrap-gapps-hook")
        || drv.contains("desktop-to-darwin-bundle-hook")
    {
        return SearchResultInstallTarget::Homebrew;
    }

    // GUI ecosystem signals
    if drv.contains("gtk")
        || drv.contains("gtkmm")
        || drv.contains("qt")
        || drv.contains("libadwaita")
        || drv.contains("gdk-pixbuf")
        || drv.contains("cairo")
        || drv.contains("pango")
    {
        return SearchResultInstallTarget::Homebrew;
    }

    // No signals of GUI packaging or ecosystem, likely nix-native CLI tool or library
    if !drv.contains("gtk")
        && !drv.contains("qt")
        && !drv.contains("cairo")
        && !drv.contains("wrap-gapps-hook")
        && !drv.contains(".app")
        && !drv.contains(".desktop")
    {
        return SearchResultInstallTarget::System;
    }

    // Unclear or doesn't match any heuristics, could be either
    SearchResultInstallTarget::Either
}

/// Heuristically classify whether a nix package behaves like a GUI app
/// (Homebrew Cask-like) or a CLI / nix-native package.
fn classify_package(channel: &str, attr_path: &str) -> (SearchResultInstallTarget, Option<String>) {
    let mut cmd = Command::new("nix");
    cmd.args(["derivation", "show", &format!("{}#{}", channel, attr_path)]);

    let output = match cmd.output() {
        Ok(output) => output,
        Err(e) => {
            log::error!("Failed to execute nix derivation show: {}", e);
            return (SearchResultInstallTarget::Either, None);
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);

        // If the error message contains "not available on the requested hostPlatform",
        // set to "unavailable".
        if stderr.contains("not available on the requested hostPlatform") {
            return (SearchResultInstallTarget::UnavailableOnHostPlatform, None);
        }

        // If the package is broken, set to "none" to avoid trying to install it at all.
        if stderr.contains("broken: This package is broken.") {
            return (
                SearchResultInstallTarget::None,
                Some("package is broken".to_string()),
            );
        }

        // If this error occurs because the package is "unfree" and allowUnfree
        // is not enabled, we can't do a type determination but the package
        // is technically installable via nix if the user enables allowUnfree,
        // so we return "either".
        // CONSIDER: We may do something additional in the future like offer
        // to enable allowUnfree for the user or something like that, but for now
        // we'll leave things up to the agent.
        if stderr.contains("Refusing to evaluate package")
            && stderr.contains("because it has an unfree license")
        {
            return (
                SearchResultInstallTarget::Either,
                Some("needs allowUnfree enabled".to_string()),
            );
        }

        // Else assume the error is on our side and let the agent decide what to
        // do with the package.
        let truncated = truncate_error(&stderr, 8000);
        log::error!(
            "nix derivation show failed with status {:?}: {}",
            output.status.code(),
            truncated
        );
        return (SearchResultInstallTarget::Either, Some(truncated));
    }

    let drv = String::from_utf8_lossy(&output.stdout);

    (classify_derivation(&drv), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate_from_result(result: SearchPackageResult) -> SearchPackageCandidate {
        SearchPackageCandidate {
            name: result.name,
            attr_path: result.attr_path,
            channel: result.channel,
            version: result.version,
            description: result.description,
        }
    }

    fn process_test_results(
        results: Vec<SearchPackageResult>,
        query: &str,
        limit: u64,
    ) -> Vec<SearchPackageResult> {
        let candidates = results
            .into_iter()
            .map(candidate_from_result)
            .collect::<Vec<_>>();
        process_results(candidates, query, limit, &|_, _| {
            (SearchResultInstallTarget::Either, None)
        })
        .unwrap()
    }

    fn load_classifier_fixture(name: &str) -> &'static str {
        match name {
            "firefox" => include_str!("../../tests/fixtures/derivations/firefox.json"),
            "inkscape" => include_str!("../../tests/fixtures/derivations/inkscape.json"),
            "ripgrep" => include_str!("../../tests/fixtures/derivations/ripgrep.json"),
            "emacs" => include_str!("../../tests/fixtures/derivations/emacs.json"),
            _ => panic!("unknown classifier fixture"),
        }
    }

    fn load_search_fixture(name: &str) -> &'static str {
        match name {
            "emacs-name" => include_str!("../../tests/fixtures/searches/emacs-name.json"),
            "emacs-fulltext" => include_str!("../../tests/fixtures/searches/emacs-fulltext.json"),
            "empty" => include_str!("../../tests/fixtures/searches/empty.json"),
            _ => panic!("unknown search fixture"),
        }
    }

    #[test]
    fn classifier_fixtures() {
        let cases = vec![
            ("firefox", SearchResultInstallTarget::Homebrew),
            ("inkscape", SearchResultInstallTarget::Homebrew),
            ("ripgrep", SearchResultInstallTarget::System),
            ("emacs", SearchResultInstallTarget::Homebrew),
        ];

        for (name, expected) in cases {
            let drv = load_classifier_fixture(name);
            let result = classify_derivation(drv);
            assert_eq!(result, expected, "failed on {}", name);
        }
    }

    #[test]
    fn search_fixtures() {
        let cases = vec![("emacs-name", 2, Some(SearchPackageResult{
            name: "emacs".to_string(),
            attr_path: "legacyPackages.aarch64-darwin.emacs".to_string(),
            channel: "test-channel".to_string(),
            version: "30.2".to_string(),
            description: "Extensible, customizable GNU text editor".to_string(),
            install_via: SearchResultInstallTarget::Either,
            additional_info: None,
        })), ("emacs-fulltext", 55, Some(SearchPackageResult{
            name: "auctex".to_string(),
            attr_path: "legacyPackages.aarch64-darwin.auctex".to_string(),
            channel: "test-channel".to_string(),
            version: "13.2".to_string(),
            description: "Extensible package for writing and formatting TeX files in GNU Emacs and XEmacs".to_string(),
            install_via: SearchResultInstallTarget::Either,
            additional_info: None,
        })), ("empty", 0, None )];
        for (name, expected_count, first_result) in cases {
            let output = load_search_fixture(name);
            let results = process_search_output(output, "test-channel").unwrap();
            assert_eq!(
                results.len(),
                expected_count,
                "unexpected number of results for {}",
                name
            );
            if let Some(expected_first) = first_result {
                assert_eq!(
                    results.first(),
                    Some(&candidate_from_result(expected_first)),
                    "unexpected first result for {}",
                    name
                );
            }
        }
    }

    #[test]
    fn ranks_all_candidates_before_limiting_and_classifying() {
        let mut packages = serde_json::Map::new();
        for index in 0..150 {
            packages.insert(
                format!("legacyPackages.aarch64-darwin.androidenv.pkg{index:03}.google"),
                serde_json::json!({
                    "version": "1.0",
                    "description": "Android Google API image"
                }),
            );
        }
        packages.insert(
            "legacyPackages.aarch64-darwin.go".to_string(),
            serde_json::json!({
                "version": "1.25",
                "description": "The Go programming language"
            }),
        );

        let output = serde_json::Value::Object(packages).to_string();
        let candidates = process_search_output(&output, "nixpkgs").unwrap();
        assert_eq!(candidates.len(), 151);

        let classification_count = std::cell::Cell::new(0);
        let results = process_results(candidates, "go", 2, &|_, _| {
            classification_count.set(classification_count.get() + 1);
            (SearchResultInstallTarget::System, None)
        })
        .unwrap();

        assert_eq!(classification_count.get(), 2);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].attr_path, "legacyPackages.aarch64-darwin.go");
    }

    #[test]
    fn multiple_channels_are_deduped() {
        let channel1_results = vec![
            SearchPackageResult {
                name: "emacs".to_string(),
                attr_path: "legacyPackages.aarch64-darwin.emacs".to_string(),
                channel: "channel1".to_string(),
                version: "30.2".to_string(),
                description: "Extensible, customizable GNU text editor".to_string(),
                install_via: SearchResultInstallTarget::Either,
                additional_info: None,
            },
            SearchPackageResult {
                name: "auctex".to_string(),
                attr_path: "legacyPackages.aarch64-darwin.auctex".to_string(),
                channel: "channel1".to_string(),
                version: "13.2".to_string(),
                description:
                    "Extensible package for writing and formatting TeX files in GNU Emacs and XEmacs"
                        .to_string(),
                install_via: SearchResultInstallTarget::Either,
                additional_info: None,
            },
        ];
        let channel2_results = vec![SearchPackageResult {
            name: "emacs".to_string(),
            attr_path: "legacyPackages.aarch64-darwin.emacs".to_string(),
            channel: "channel2".to_string(),
            version: "30.2".to_string(),
            description: "Extensible, customizable GNU text editor".to_string(),
            install_via: SearchResultInstallTarget::Either,
            additional_info: None,
        }];

        let all_results = [channel1_results.clone(), channel2_results.clone()].concat();
        let processed_results = process_test_results(all_results, "emacs", 10);

        assert_eq!(
            processed_results.len(),
            2,
            "expected deduplication by attr_path"
        );
    }

    #[test]
    fn channel_registration_check() {
        let registry_list = "global flake:agda github:agda/agd\nglobal flake:nixpkgs github:NixOS/nixpkgs/nixpkgs-unstable\nglobal flake:nix github:NixOS/nix\n";
        assert!(channel_is_registered(registry_list, "nixpkgs"));
        assert!(channel_is_registered(registry_list, "nix"));
        assert!(!channel_is_registered(
            registry_list,
            "unregistered-channel"
        ));
    }

    #[test]
    fn build_search_queries_ere_escape() {
        let query = "google-chrome";
        let use_regex = false;
        let expected = vec!["google-chrome"];
        let result = build_search_queries(query, use_regex).unwrap();
        assert_eq!(result, expected);

        let query = "c++";
        let use_regex = false;
        let expected = vec!["c\\+\\+"];
        let result = build_search_queries(query, use_regex).unwrap();
        assert_eq!(result, expected);
    }

    #[test]
    fn build_search_queries_no_regex() {
        let query = "google chrome";
        let use_regex = false;
        let expected = vec!["google", "chrome"];
        let result = build_search_queries(query, use_regex).unwrap();
        assert_eq!(result, expected);
    }

    #[test]
    fn build_search_queries_with_regex() {
        let query = "google chrome";
        let use_regex = true;
        let expected = vec!["google chrome"];
        let result = build_search_queries(query, use_regex).unwrap();
        assert_eq!(result, expected);
    }

    #[test]
    fn relevance_score_basic() {
        let result = SearchPackageResult {
            name: "emacs".to_string(),
            attr_path: "legacyPackages.aarch64-darwin.emacs".to_string(),
            channel: "test-channel".to_string(),
            version: "30.2".to_string(),
            description: "Extensible, customizable GNU text editor".to_string(),
            install_via: SearchResultInstallTarget::Either,
            additional_info: None,
        };

        let score_exact = relevance_score(&result, "emacs");
        let score_partial = relevance_score(&result, "em");
        let score_unrelated = relevance_score(&result, "vim");

        assert!(score_exact > score_partial);
        assert!(score_partial > score_unrelated);
    }

    #[test]
    fn relevance_score_with_normalization() {
        let result = SearchPackageResult {
            name: "google-chrome".to_string(),
            attr_path: "legacyPackages.aarch64-darwin.google-chrome".to_string(),
            channel: "test-channel".to_string(),
            version: "90.0".to_string(),
            description: "Web browser".to_string(),
            install_via: SearchResultInstallTarget::Either,
            additional_info: None,
        };
        let score_exact = relevance_score(&result, "google-chrome");
        let score_partial = relevance_score(&result, "google");
        let score_unrelated = relevance_score(&result, "firefox");

        assert!(score_exact > score_partial);
        assert!(score_partial > score_unrelated);
    }

    #[test]
    fn relevance_score_with_description() {
        let result = SearchPackageResult {
            name: "vim".to_string(),
            attr_path: "legacyPackages.aarch64-darwin.vim".to_string(),
            channel: "test-channel".to_string(),
            version: "8.2".to_string(),
            description: "Vi IMproved, a highly configurable text editor".to_string(),
            install_via: SearchResultInstallTarget::Either,
            additional_info: None,
        };

        let score_exact = relevance_score(&result, "vim");
        let score_description = relevance_score(&result, "text editor");
        let score_unrelated = relevance_score(&result, "emacs");

        assert!(score_exact > score_description);
        assert!(score_description > score_unrelated);
    }

    #[test]
    fn relevance_score_with_multiple_terms() {
        let result = SearchPackageResult {
            name: "python".to_string(),
            attr_path: "legacyPackages.aarch64-darwin.python".to_string(),
            channel: "test-channel".to_string(),
            version: "3.9".to_string(),
            description: "Python programming language".to_string(),
            install_via: SearchResultInstallTarget::Either,
            additional_info: None,
        };

        let score_exact = relevance_score(&result, "python");
        let score_partial = relevance_score(&result, "programming language");
        let score_unrelated = relevance_score(&result, "java");

        assert!(score_exact > score_partial);
        assert!(score_partial > score_unrelated);
    }

    #[test]
    fn fewer_terms_bonus_favors_short_package_attributes() {
        assert_eq!(fewer_terms_relevance_bonus(&[]), 0);
        assert_eq!(fewer_terms_relevance_bonus(&["spotify"]), 200);
        assert_eq!(
            fewer_terms_relevance_bonus(&["haskellPackages", "spotify"]),
            100
        );
        assert_eq!(
            fewer_terms_relevance_bonus(&["packageSet", "nested", "spotify"]),
            33
        );
    }

    #[test]
    fn relevance_score_prefers_top_level_package_attributes() {
        let spotify = SearchPackageResult {
            name: "spotify".to_string(),
            attr_path: "legacyPackages.aarch64-darwin.spotify".to_string(),
            channel: "test-channel".to_string(),
            version: "1.0".to_string(),
            description: "Spotify client".to_string(),
            install_via: SearchResultInstallTarget::Either,
            additional_info: None,
        };
        let haskell_spotify = SearchPackageResult {
            attr_path: "legacyPackages.aarch64-darwin.haskellPackages.spotify".to_string(),
            ..spotify.clone()
        };

        assert_eq!(
            relevance_score(&spotify, "spotify") - relevance_score(&haskell_spotify, "spotify"),
            100
        );

        let ranked = process_test_results(vec![haskell_spotify, spotify.clone()], "spotify", 10);
        assert_eq!(ranked[0], spotify);
    }

    #[test]
    fn process_limit() {
        let results = vec![
            SearchPackageResult {
                name: "pkg1".to_string(),
                attr_path: "legacyPackages.aarch64-darwin.pkg1".to_string(),
                channel: "test-channel".to_string(),
                version: "1.0".to_string(),
                description: "Package 1".to_string(),
                install_via: SearchResultInstallTarget::Either,
                additional_info: None,
            },
            SearchPackageResult {
                name: "pkg2".to_string(),
                attr_path: "legacyPackages.aarch64-darwin.pkg2".to_string(),
                channel: "test-channel".to_string(),
                version: "2.0".to_string(),
                description: "Package 2".to_string(),
                install_via: SearchResultInstallTarget::Either,
                additional_info: None,
            },
            SearchPackageResult {
                name: "pkg3".to_string(),
                attr_path: "legacyPackages.aarch64-darwin.pkg3".to_string(),
                channel: "test-channel".to_string(),
                version: "3.0".to_string(),
                description: "Package 3".to_string(),
                install_via: SearchResultInstallTarget::Either,
                additional_info: None,
            },
        ];

        let limit = 2;
        let processed = process_test_results(results, "pkg", limit);
        assert_eq!(processed.len(), limit as usize);
    }

    #[test]
    fn process_results_ranks_by_user_query() {
        let emacs = SearchPackageResult {
            name: "emacs".to_string(),
            attr_path: "legacyPackages.aarch64-darwin.emacs".to_string(),
            channel: "test-channel".to_string(),
            version: "30.2".to_string(),
            description: "Extensible text editor".to_string(),
            install_via: SearchResultInstallTarget::Either,
            additional_info: None,
        };
        let vim = SearchPackageResult {
            name: "vim".to_string(),
            attr_path: "legacyPackages.aarch64-darwin.vim".to_string(),
            channel: "test-channel".to_string(),
            version: "9.1".to_string(),
            description: "Vi IMproved text editor".to_string(),
            install_via: SearchResultInstallTarget::Either,
            additional_info: None,
        };

        // Keep the non-matching package first in the input so this fails if
        // equal self-match scores merely preserve the original order.
        let results = vec![emacs.clone(), vim.clone()];
        let ranked_for_vim = process_test_results(results.clone(), "vim", 10);
        let ranked_for_emacs = process_test_results(results, "emacs", 10);

        assert_eq!(ranked_for_vim[0], vim);
        assert_eq!(ranked_for_emacs[0], emacs);
    }
}
