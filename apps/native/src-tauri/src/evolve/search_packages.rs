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
pub enum SearchResultInstallType {
    // Should be installed as a Homebrew package (e.g. GUI apps, language servers, etc.)
    HomebrewCaskLike,
    // May be installed either as Homebrew or nix-native package.
    Either,
    // Should be installed as a nix-native package (e.g. CLI tools, libraries, etc.)
    NixNative,
    // Package is not available on the host platform (e.g. no Darwin support, etc.)
    UnavailableOnHostPlatform,
}

#[derive(Debug, serde::Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchPackageResult {
    pub name: String,
    pub attr_path: String,
    pub channel: String,
    pub version: String,
    pub description: String,
    pub install_type: SearchResultInstallType,
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
    package_classifier: Option<&dyn Fn(&str) -> SearchResultInstallType>,
) -> Result<Vec<SearchPackageResult>> {
    let parsed = serde_json::from_str::<serde_json::Value>(search_cmd_output)
        .map_err(|e| anyhow::anyhow!("Failed to parse JSON output from nix search: {}", e))?;

    let mut results = Vec::new();

    if let Some(value) = parsed.as_object() {
        for (attr_path, pkg) in value {
            let name = attr_path.split('.').last().unwrap_or(attr_path).to_string();
            let package_type = if let Some(classifier) = package_classifier {
                classifier(&name)
            } else {
                classify_package(channel, &name)
            };

            // If the package is unavailable on the host platform, skip it.
            if package_type == SearchResultInstallType::UnavailableOnHostPlatform {
                continue;
            }

            results.push(SearchPackageResult {
                name,
                attr_path: attr_path.clone(),
                install_type: package_type,
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

/// Search channels in order for a given query/type and append unique results up to `limit`.
fn collect_from_channels(
    config_dir: &str,
    channels: &[String],
    query_term: &str,
    use_regex: bool,
    limit: u64,
    structured: &mut Vec<SearchPackageResult>,
) -> Result<bool> {
    for channel in channels {
        if structured.len() >= limit as usize {
            return Ok(true);
        }

        let channel_results = search_single_channel(config_dir, query_term, use_regex, channel)?;

        for result in channel_results {
            if structured.len() >= limit as usize {
                return Ok(true);
            };

            let map_key = result
                .attr_path
                .split('.')
                .next_back()
                .unwrap_or(&result.attr_path);
            if !structured.iter().any(|item| item.attr_path == map_key) {
                structured.push(result);
            }
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
fn classify_derivation(drv: &str) -> SearchResultInstallType {
    // Explicit GUI packaging
    if drv.contains(".app")
        || drv.contains(".desktop")
        || drv.contains("Applications/")
        || drv.contains("wrap-gapps-hook")
        || drv.contains("desktop-to-darwin-bundle-hook")
    {
        return SearchResultInstallType::HomebrewCaskLike;
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
        return SearchResultInstallType::HomebrewCaskLike;
    }

    // No signals of GUI packaging or ecosystem, likely nix-native CLI tool or library
    if !drv.contains("gtk")
        && !drv.contains("qt")
        && !drv.contains("cairo")
        && !drv.contains("wrap-gapps-hook")
        && !drv.contains(".app")
        && !drv.contains(".desktop")
    {
        return SearchResultInstallType::NixNative;
    }

    // Unclear or doesn't match any heuristics, could be either
    SearchResultInstallType::Either
}

/// Heuristically classify whether a nix package behaves like a GUI app
/// (Homebrew Cask-like) or a CLI / nix-native package.
fn classify_package(channel: &str, package_name: &str) -> SearchResultInstallType {
    let mut cmd = Command::new("nix");
    cmd.args(&[
        "derivation",
        "show",
        &format!("{}#{}", channel, package_name),
    ]);

    let output = match cmd.output() {
        Ok(output) => output,
        Err(e) => {
            eprintln!("Failed to execute nix derivation show: {}", e);
            return SearchResultInstallType::Either;
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);

        // If the error message contains "not available on the requested hostPlatform",
        // set to "unavailable".
        if stderr.contains("not available on the requested hostPlatform") {
            return SearchResultInstallType::UnavailableOnHostPlatform;
        }

        // Else assume the error is on our side and let the agent decide what to
        // do with the package.
        let truncated = truncate_error(&stderr, 8000);
        eprintln!(
            "nix derivation show failed with status {:?}: {}",
            output.status.code(),
            truncated
        );
        return SearchResultInstallType::Either;
    }

    let drv = String::from_utf8_lossy(&output.stdout);

    classify_derivation(&drv)
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
            ("firefox", SearchResultInstallType::HomebrewCaskLike),
            ("inkscape", SearchResultInstallType::HomebrewCaskLike),
            ("ripgrep", SearchResultInstallType::NixNative),
            ("emacs", SearchResultInstallType::HomebrewCaskLike),
            ("gimp-err", SearchResultInstallType::UnavailableOnHostPlatform),
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
            install_type: SearchResultInstallType::Either,
        })), ("emacs-fulltext", 55, Some(SearchPackageResult{
            name: "auctex".to_string(),
            attr_path: "legacyPackages.aarch64-darwin.auctex".to_string(),
            channel: "test-channel".to_string(),
            version: "13.2".to_string(),
            description: "Extensible package for writing and formatting TeX files in GNU Emacs and XEmacs".to_string(),
            install_type: SearchResultInstallType::Either,  
        })), ("empty", 0, None )];
        let fake_package_classifier = |_package_name: &str| SearchResultInstallType::Either;

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
}
