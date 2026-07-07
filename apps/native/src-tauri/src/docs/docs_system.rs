use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::Value;
use std::fmt;

use crate::commands::debug::TimerGuard;

/// A compact source tag carried on every parsed option so `search_docs` can
/// filter and render doc keys without caring whether entries came from bundled
/// static JSON or runtime-generated JSON.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DocsSource {
    #[default]
    NixDarwin,
    HomeManager,
}

impl fmt::Display for DocsSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DocsSource::NixDarwin => write!(f, "nix-darwin"),
            DocsSource::HomeManager => write!(f, "home-manager"),
        }
    }
}

impl DocsSource {
    /// Parse from a user-provided string, returning None for "all"/unrecognized.
    pub fn from_filter(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "nix-darwin" | "nixdarwin" | "darwin" => Some(DocsSource::NixDarwin),
            "home-manager" | "homemanager" | "home" | "hm" => Some(DocsSource::HomeManager),
            _ => None,
        }
    }
}

/// Top-level categories large enough to warrant one doc key per second-level
/// subcategory. Doc keys for options under these are `<source>/<top>/<sub>.md`
/// instead of `<source>/<top>.md`, so the agent reads a focused slice rather
/// than a giant `programs.md` / `services.md`.
const SPLIT_KEYS: &[&str] = &["programs", "services"];

/// Compute the doc key grouping an option: `<source>/<top>.md`, split one
/// level deeper for the large `SPLIT_KEYS` categories. Doc keys are synthetic
/// markdown-style paths used purely as stable grouping labels — no such files
/// exist on disk.
pub(crate) fn doc_key_for(source: DocsSource, option_path: &str) -> String {
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

/// One normalized option row in the in-memory docs index.
///
/// Both static and generated docs are converted into this shape. Keeping the
/// search layer on this compact representation lets the generated-docs path
/// swap in transparently once the app has produced fresher docs.
#[derive(Debug, Clone)]
pub(crate) struct DocsOptionEntry {
    pub(crate) option_path: String,
    pub(crate) summary: String,
    pub(crate) option_type: Option<String>,
    pub(crate) source: DocsSource,
    /// Query-independent data derived from the fields above, computed once at
    /// index build so per-query scoring does not re-lowercase or re-format
    /// every entry (several thousand per search).
    pub(crate) option_path_lower: String,
    pub(crate) summary_lower: String,
    pub(crate) doc_key: String,
}

impl DocsOptionEntry {
    pub(crate) fn new(
        option_path: String,
        summary: String,
        option_type: Option<String>,
        source: DocsSource,
    ) -> Self {
        let option_path_lower = option_path.to_ascii_lowercase();
        let summary_lower = summary.to_ascii_lowercase();
        let doc_key = doc_key_for(source, &option_path);
        Self {
            option_path,
            summary,
            option_type,
            source,
            option_path_lower,
            summary_lower,
            doc_key,
        }
    }
}

/// The complete in-memory docs index consumed by `search_docs`.
#[derive(Debug, Default)]
pub(crate) struct DocsIndex {
    pub(crate) entries: Vec<DocsOptionEntry>,
}

/// Loader abstraction for any source that can produce a complete docs index.
///
/// The static loader reads bundled resources, while the generated loader reads
/// app-data cache files or generates them with Nix. `search_docs` only depends
/// on this trait so it can choose the fastest available source at startup.
pub trait DocsIndexLoader {
    fn load(&self) -> Result<DocsIndex>;
}

/// Parse one compact docs JSON file into tagged option entries.
///
/// The format is produced by `generated_docs::docs_index_json_from_options_json`:
/// a flat array with `option_path`, `summary`, and `option_type`. Invalid rows
/// are skipped so a single malformed entry does not disable the whole docs tool.
pub(crate) fn parse_entries(json: &str, source: DocsSource) -> Vec<DocsOptionEntry> {
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

                    out.push(DocsOptionEntry::new(
                        option_path,
                        summary,
                        option_type,
                        source,
                    ));
                }
            }
            out
        }
        Err(e) => {
            log::error!("[docs_system] failed to parse {} docs JSON: {}", source, e);
            Vec::new()
        }
    }
}

/// Validate the compact docs JSON shape shared by static and generated docs.
/// Runtime-generated caches use this to reject corrupt app-data files before
/// they can produce an empty index. Note we also validate the static JSON
/// even though we hopefully didn't bundle a broken file...
pub(crate) fn validate_docs_json(json: &str, label: &str) -> Result<()> {
    let docs: Vec<Value> =
        serde_json::from_str(json).with_context(|| format!("{label} is not valid JSON"))?;

    if docs.is_empty() {
        anyhow::bail!("{label} contains no docs entries");
    }

    for (idx, item) in docs.iter().enumerate() {
        let obj = item
            .as_object()
            .with_context(|| format!("{label}[{idx}] is not an object"))?;
        let option_path = obj.get("option_path").and_then(Value::as_str).unwrap_or("");
        if option_path.is_empty() {
            anyhow::bail!("{label}[{idx}] has an empty option_path");
        }
        if obj.get("summary").is_some_and(|value| !value.is_string()) {
            anyhow::bail!("{label}[{idx}].summary is not a string");
        }
        if obj
            .get("option_type")
            .is_some_and(|value| !value.is_string() && !value.is_null())
        {
            anyhow::bail!("{label}[{idx}].option_type is not a string or null");
        }
    }

    Ok(())
}

/// Build a single index from the nix-darwin and Home Manager compact docs JSON.
///
/// This is shared by both loaders so static resources and generated app-data
/// files behave identically once they reach the search layer.
pub fn initialize_docs_index_from_strs(
    nix_darwin_json: &str,
    home_manager_json: &str,
) -> Result<DocsIndex> {
    let _timer = TimerGuard::new("initialize_docs_index_from_strs");

    validate_docs_json(nix_darwin_json, "nix-darwin docs JSON")?;
    validate_docs_json(home_manager_json, "home-manager docs JSON")?;

    let mut entries = parse_entries(nix_darwin_json, DocsSource::NixDarwin);
    let darwin_count = entries.len();

    let hm_entries = parse_entries(home_manager_json, DocsSource::HomeManager);
    let hm_count = hm_entries.len();
    entries.extend(hm_entries);

    log::info!(
        "[docs_system] build docs index with {} nix-darwin + {} home-manager = {} total entries",
        darwin_count,
        hm_count,
        entries.len(),
    );
    Ok(DocsIndex { entries })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docs::docs_system::parse_entries;
    use crate::docs::static_docs::{HOME_MANAGER_DOCS_JSON, NIX_DARWIN_DOCS_JSON};

    #[test]
    fn parse_nix_darwin_entries_loads_json() {
        let entries = parse_entries(NIX_DARWIN_DOCS_JSON, DocsSource::NixDarwin);
        assert!(!entries.is_empty(), "expected parsed entries from JSON");
        assert!(
            entries.iter().all(|e| e.source == DocsSource::NixDarwin),
            "all entries should be tagged as nix-darwin"
        );
    }

    #[test]
    fn parse_home_manager_entries_loads_json() {
        let entries = parse_entries(HOME_MANAGER_DOCS_JSON, DocsSource::HomeManager);
        assert!(
            !entries.is_empty(),
            "expected parsed home-manager entries from JSON"
        );
        assert!(
            entries.iter().all(|e| e.source == DocsSource::HomeManager),
            "all entries should be tagged as home-manager"
        );
    }

    #[test]
    fn documentation_enable_entry_present() {
        let entries = parse_entries(NIX_DARWIN_DOCS_JSON, DocsSource::NixDarwin);
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
        let entries = parse_entries(NIX_DARWIN_DOCS_JSON, DocsSource::NixDarwin);
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
    fn validate_docs_json_accepts_compact_docs_shape() {
        validate_docs_json(
            r#"[
              {
                "option_path": "programs.git.enable",
                "anchor_id": "opt-programs.git.enable",
                "summary": "Enable Git.",
                "option_type": "boolean"
              }
            ]"#,
            "test-docs.json",
        )
        .expect("valid compact docs should pass validation");
    }

    #[test]
    fn validate_docs_json_rejects_corrupt_cache_shapes() {
        assert!(validate_docs_json("not-json", "test-docs.json").is_err());
        assert!(validate_docs_json("[]", "test-docs.json").is_err());
        assert!(validate_docs_json(r#"[{"summary":"missing path"}]"#, "test-docs.json").is_err());
        assert!(
            validate_docs_json(
                r#"[{"option_path":"programs.git.enable","summary":123}]"#,
                "test-docs.json",
            )
            .is_err()
        );
        assert!(
            validate_docs_json(
                r#"[{"option_path":"programs.git.enable","option_type":123}]"#,
                "test-docs.json",
            )
            .is_err()
        );
    }

    #[test]
    fn initialize_docs_index_from_strs_validates_both_sources() {
        let valid = r#"[{"option_path":"programs.git.enable","summary":"Enable Git."}]"#;
        let invalid = r#"[{"summary":"missing option path"}]"#;

        assert!(initialize_docs_index_from_strs(valid, invalid).is_err());
        assert!(initialize_docs_index_from_strs(invalid, valid).is_err());
    }
}
