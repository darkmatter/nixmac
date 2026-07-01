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

/// Search a single channel and return a list of SearchPackageResult
/// results.
fn search_single_channel(
    config_dir: &str,
    query_term: &str,
    use_regex: bool,
    channel: &str,
) -> Result<Vec<SearchPackageResult>> {
    // Nix search supports regex implicitly. So if the user wants non-"regex"
    // search, we need to pin it with ^$.
    // It also returns search results for both name and description so there
    // is no point to have separate "search types".
    let search_query = match use_regex {
        false => format!("^{}$", query_term), // Search in attr path (package name)
        true => query_term.to_string(),
    };

    let mut cmd = Command::new("nix");
    cmd.args(["search", channel]);

    cmd.arg(&search_query)
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

    process_search_output(&stdout, channel, None)
}

/// Process the JSON output from a nix search command and return a list of SearchPackageResult.
fn process_search_output(
    search_cmd_output: &str,
    channel: &str,
    package_classifier: Option<&dyn Fn(&str) -> SearchResultInstallTarget>,
) -> Result<Vec<SearchPackageResult>> {
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
            let (package_type, additional_info) = if let Some(classifier) = package_classifier {
                (classifier(&name), None)
            } else {
                let (pkg_type, info) = classify_package(channel, attr_path);
                (pkg_type, info)
            };

            // If the package is unavailable on the host platform, skip it.
            if package_type == SearchResultInstallTarget::UnavailableOnHostPlatform {
                continue;
            }

            results.push(SearchPackageResult {
                name,
                attr_path: attr_path.clone(),
                install_via: package_type,
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
                additional_info,
            });
        }
    }

    Ok(results)
}

/// Adds the search results from a single channel to the structured results list, ensuring uniqueness by attr_path and respecting the limit.
fn process_channel_results(
    structured: &mut Vec<SearchPackageResult>,
    channel_results: Vec<SearchPackageResult>,
    limit: u64,
) -> Result<bool> {
    for result in channel_results {
        if structured.len() >= limit as usize {
            return Ok(true);
        };

        let _map_key = result
            .attr_path
            .split('.')
            .next_back()
            .unwrap_or(&result.attr_path);
        if !structured
            .iter()
            .any(|item| item.attr_path == result.attr_path)
        {
            structured.push(result);
        }
    }
    Ok(structured.len() >= limit as usize)
}

/// Search channels in order for a given query/type and append unique results up to `limit`.
fn collect_from_channels(
    config_dir: &str,
    channels: &[String],
    query_term: &str,
    use_regex: bool,
    limit: u64,
    structured: &mut Vec<SearchPackageResult>,
) -> Result<bool> {
    let registry_list = nix_registry_list(config_dir)?;

    for channel in channels {
        if structured.len() >= limit as usize {
            return Ok(true);
        }

        if !channel_is_registered(&registry_list, channel) {
            // CONSIDER: Whether we need to surface this to the agent somehow.
            log::warn!(
                "Channel '{}' is not registered, skipping search for this channel",
                channel
            );
            continue;
        }

        let channel_results = search_single_channel(config_dir, query_term, use_regex, channel)?;
        let complete = process_channel_results(structured, channel_results, limit)?;
        if complete {
            return Ok(true);
        }
    }

    Ok(structured.len() >= limit as usize)
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

    let mut structured = Vec::new();

    // Try primary search across channels, collecting up to limit.
    let mut _complete = collect_from_channels(
        config_dir,
        channels,
        query,
        use_regex,
        limit,
        &mut structured,
    )?;

    // Return JSON result
    Ok(structured)
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
        let fake_package_classifier = |_package_name: &str| SearchResultInstallTarget::Either;

        for (name, expected_count, first_result) in cases {
            let output = load_search_fixture(name);
            let results =
                process_search_output(output, "test-channel", Some(&fake_package_classifier))
                    .unwrap();
            assert_eq!(
                results.len(),
                expected_count,
                "unexpected number of results for {}",
                name
            );
            if let Some(expected_first) = first_result {
                assert_eq!(
                    results.first(),
                    Some(&expected_first),
                    "unexpected first result for {}",
                    name
                );
            }
        }
    }

    #[test]
    fn multiple_channels_are_deduped() {
        let mut structured = Vec::new();
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

        process_channel_results(&mut structured, channel1_results, 10).unwrap();
        process_channel_results(&mut structured, channel2_results, 10).unwrap();

        assert_eq!(structured.len(), 2, "expected deduplication by attr_path");
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
}
