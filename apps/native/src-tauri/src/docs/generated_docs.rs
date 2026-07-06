//! Nix-related documentation used by the app that we generate at runtime based on the user's
//! nix environment and cache in an application directory.
//!

use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};
use walkdir::WalkDir;

use crate::commands::debug::TimerGuard;
use crate::docs::docs_system::{
    DocsIndex, DocsIndexLoader, initialize_docs_index_from_strs, validate_docs_json,
};
use crate::system::nix::nix_command;

const NIX_DARWIN_DOCS_JSON_BASE: &str = "nix-darwin-docs.json";
const HOME_MANAGER_DOCS_JSON_BASE: &str = "home-manager-docs.json";
const DOCS_CACHE_META_FILE: &str = "docs-cache-meta.json";

/// Version of the docs generation pipeline: the Nix eval expressions plus the
/// compact index format. Bump when either changes so existing caches
/// regenerate. App releases that leave the pipeline untouched keep the cache
/// (keying on the app version would regenerate identical content on every
/// upgrade).
const DOCS_CACHE_SCHEMA_VERSION: u32 = 1;

/// Maximum cache age before the cache counts as stale and the background
/// refresh regenerates it. The generated docs track floating upstream refs
/// (nix-darwin and home-manager master, plus the nixpkgs they resolve) that we
/// cannot observe without network round-trips, so refresh periodically.
const DOCS_CACHE_MAX_AGE: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 60 * 60);

/// On-disk metadata describing the cached generated docs, stored next to them.
#[derive(serde::Serialize, serde::Deserialize)]
struct DocsCacheMeta {
    schema_version: u32,
    /// Unix seconds at generation time.
    generated_at: u64,
}

/// Current time as unix seconds; 0 if the clock is before the epoch.
fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Loader for runtime-generated option docs stored in the app data directory.
/// The app persists the compact `*-docs.json` files in the format used by `search_docs`.

pub struct GeneratedDocsIndexLoader {
    docs_dir: PathBuf,
}

/// Which option set we are generating.
/// Each variant has its own Nix expression but the output gets normalized into the same compact docs JSON format.
#[derive(Debug, Clone, Copy)]
enum OptionsTool {
    NixDarwin,
    HomeManager,
}

impl OptionsTool {
    fn label(self) -> &'static str {
        match self {
            Self::NixDarwin => "nix-darwin",
            Self::HomeManager => "home-manager",
        }
    }

    fn docs_file_name(self) -> &'static str {
        match self {
            Self::NixDarwin => NIX_DARWIN_DOCS_JSON_BASE,
            Self::HomeManager => HOME_MANAGER_DOCS_JSON_BASE,
        }
    }

    /// Nix snippet defining `pkgs` and `eval` for this tool. `pkgs` comes from
    /// the flake's own pinned nixpkgs input rather than `<nixpkgs>`, so
    /// generation does not depend on a channel/NIX_PATH being configured in
    /// the app's launch environment (GUI launches often have neither).
    fn eval_expr(self) -> &'static str {
        match self {
            Self::NixDarwin => {
                r#"
        flake = builtins.getFlake "github:nix-darwin/nix-darwin";
        pkgs = import flake.inputs.nixpkgs {};
        eval = flake.lib.darwinSystem {
          inherit pkgs;
          modules = [{
            _module.check = false;
            networking.hostName = "dummy";
            networking.domain = "local";
          }];
        };
      "#
            }
            Self::HomeManager => {
                r#"
        hm = builtins.getFlake "github:nix-community/home-manager";
        pkgs = import hm.inputs.nixpkgs {};
        eval = hm.lib.homeManagerConfiguration {
          inherit pkgs;
          modules = [{
            _module.check = pkgs.lib.mkForce false;
            home.stateVersion = "23.11";
            home.username = "user";
            home.homeDirectory = "/home/user";
          }];
        };
      "#
            }
        }
    }
}

impl GeneratedDocsIndexLoader {
    /// Build a loader rooted at a specific cache directory.
    pub fn new(docs_dir: PathBuf) -> Self {
        Self { docs_dir }
    }

    /// Resolve the app-data directory and create a loader for generated docs.
    pub fn for_app<R: Runtime>(app: &AppHandle<R>) -> Result<Self> {
        let docs_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&docs_dir)?;
        Ok(Self::new(docs_dir))
    }

    /// Return true only when both generated docs files are present and the
    /// cache metadata is fresh (matching schema version, within the maximum
    /// age). `search_docs` uses this as a fast readiness check. Partial and
    /// stale caches are treated as missing so we never mix stale generated
    /// docs with static docs.
    pub fn has_cached_docs(&self) -> bool {
        if !self.docs_dir.join(NIX_DARWIN_DOCS_JSON_BASE).exists()
            || !self.docs_dir.join(HOME_MANAGER_DOCS_JSON_BASE).exists()
        {
            return false;
        }
        self.cache_meta_is_fresh()
    }

    /// True when the cache metadata exists, was written by the current docs
    /// pipeline schema, and is younger than `DOCS_CACHE_MAX_AGE`. Missing or
    /// unparsable metadata counts as stale.
    fn cache_meta_is_fresh(&self) -> bool {
        let Ok(raw) = std::fs::read_to_string(self.docs_dir.join(DOCS_CACHE_META_FILE)) else {
            return false;
        };
        let Ok(meta) = serde_json::from_str::<DocsCacheMeta>(&raw) else {
            return false;
        };
        meta.schema_version == DOCS_CACHE_SCHEMA_VERSION
            && now_unix_secs().saturating_sub(meta.generated_at) <= DOCS_CACHE_MAX_AGE.as_secs()
    }

    /// Write the cache metadata so future startups recognise the cache.
    fn write_cache_meta(&self) -> Result<()> {
        let meta = DocsCacheMeta {
            schema_version: DOCS_CACHE_SCHEMA_VERSION,
            generated_at: now_unix_secs(),
        };
        let json = serde_json::to_string(&meta).context("failed to serialize docs cache meta")?;
        write_file_atomically(&self.docs_dir.join(DOCS_CACHE_META_FILE), &json)
            .context("failed to write docs cache metadata")
    }

    /// Load generated docs from app data without starting Nix generation.
    /// This is the foreground startup path: if the cache is complete, the app
    /// can immediately use generated docs. If not, the caller can fall back to
    /// static docs and decide whether to generate in the background.
    ///
    /// The cache is invalidated when the docs pipeline schema changes or the
    /// cache exceeds its maximum age. We write `DOCS_CACHE_META_FILE` alongside
    /// the docs files at generation time; if it is missing, unparsable, or
    /// stale, the cache is treated as incomplete so the background refresh
    /// regenerates it.
    pub fn load_cached(&self) -> Result<DocsIndex> {
        if !self.has_cached_docs() {
            anyhow::bail!(
                "generated docs cache is incomplete under {}",
                self.docs_dir.display()
            );
        }
        self.load_cached_files()
    }

    /// Read and validate both docs files, ignoring the metadata freshness.
    /// Used by `load_cached` behind the readiness check, and as the stale
    /// fallback when regeneration fails.
    fn load_cached_files(&self) -> Result<DocsIndex> {
        let nix_darwin_json =
            std::fs::read_to_string(self.docs_dir.join(NIX_DARWIN_DOCS_JSON_BASE))
                .with_context(|| format!("failed to read {}", NIX_DARWIN_DOCS_JSON_BASE))?;
        validate_docs_json(&nix_darwin_json, NIX_DARWIN_DOCS_JSON_BASE)?;

        let home_manager_json =
            std::fs::read_to_string(self.docs_dir.join(HOME_MANAGER_DOCS_JSON_BASE))
                .with_context(|| format!("failed to read {}", HOME_MANAGER_DOCS_JSON_BASE))?;
        validate_docs_json(&home_manager_json, HOME_MANAGER_DOCS_JSON_BASE)?;

        initialize_docs_index_from_strs(&nix_darwin_json, &home_manager_json)
    }
}

/// Write a cache file with a same-directory temp file and rename.
/// Helps avoid partial writes and ensures the file is stable on disk before returning.
fn write_file_atomically(path: &Path, contents: &str) -> Result<()> {
    let parent = path
        .parent()
        .with_context(|| format!("{} has no parent directory", path.display()))?;
    std::fs::create_dir_all(parent)?;

    let mut temp_file = tempfile::NamedTempFile::new_in(parent)
        .with_context(|| format!("failed to create temp cache file in {}", parent.display()))?;
    temp_file
        .write_all(contents.as_bytes())
        .with_context(|| format!("failed to write temp cache file for {}", path.display()))?;
    temp_file
        .as_file()
        .sync_all()
        .with_context(|| format!("failed to sync temp cache file for {}", path.display()))?;
    temp_file
        .persist(path)
        .map_err(|err| err.error)
        .with_context(|| {
            format!(
                "failed to move temp cache file into place at {}",
                path.display()
            )
        })?;

    if let Ok(parent_dir) = std::fs::File::open(parent) {
        let _ = parent_dir.sync_all();
    }

    Ok(())
}

/// Build the Nix expression used by `nix build --expr`.
///
/// This mirrors the relevant parts of `scripts/nix-options.sh`: instantiate
/// the target module system, remove `_module`, and ask `pkgs.nixosOptionsDoc`
/// for its structured `optionsJSON` derivation.
fn options_expr(tool: OptionsTool) -> String {
    format!(
        r#"
let
  {}

  optionsDoc = pkgs.nixosOptionsDoc {{
    options = builtins.removeAttrs eval.options [ "_module" ];
  }};
in
  optionsDoc.optionsJSON
"#,
        tool.eval_expr()
    )
}

/// Locate the `options.json` file inside the Nix build result.
///
/// `pkgs.nixosOptionsDoc` returns a derivation path, not the JSON contents on
/// stdout, so after `nix build --print-out-paths` we scan that output path for
/// the generated file and read it directly from the Nix store.
fn find_options_json(out_path: &Path) -> Result<PathBuf> {
    WalkDir::new(out_path)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .find(|entry| entry.file_type().is_file() && entry.file_name() == "options.json")
        .map(|entry| entry.into_path())
        .with_context(|| format!("could not find options.json under {}", out_path.display()))
}

/// Run Nix and return raw structured option metadata as a string.
///
/// The command is executed through `system::nix::nix_command` so GUI launches
/// get the same PATH/NIX_CONFIG handling as the rest of the app. The returned
/// JSON is only an in-memory intermediate.
fn generate_options_json(tool: OptionsTool, docs_dir: &Path) -> Result<String> {
    let _timer = TimerGuard::new("generate_options_json");
    let config_dir = docs_dir.to_string_lossy();
    let output = nix_command(&config_dir)
        .args([
            "build",
            "--impure",
            "--no-link",
            "--print-out-paths",
            "--expr",
            &options_expr(tool),
        ])
        .output()
        .with_context(|| format!("failed to run nix build for {} options", tool.label()))?;

    if !output.status.success() {
        anyhow::bail!(
            "failed to generate {} options JSON: {}",
            tool.label(),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let stdout = String::from_utf8(output.stdout)
        .with_context(|| format!("nix build for {} returned invalid UTF-8", tool.label()))?;
    let out_path = stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(PathBuf::from)
        .with_context(|| format!("nix build for {} returned no output path", tool.label()))?;
    let options_json_path = find_options_json(&out_path)?;
    std::fs::read_to_string(&options_json_path).with_context(|| {
        format!(
            "failed to read {} options JSON from {}",
            tool.label(),
            options_json_path.display()
        )
    })
}

/// Convert raw `nixosOptionsDoc` metadata into the compact search index JSON.
///
/// This is the Rust equivalent of `scripts/generate-docs-index.py`: sorted
/// option keys become flat rows containing the option path, anchor id, summary,
/// and type. The output is what we cache in app data.
fn docs_index_json_from_options_json(options_json: &str) -> Result<String> {
    let options: Value =
        serde_json::from_str(options_json).context("failed to parse generated options JSON")?;
    let options = options
        .as_object()
        .context("generated options JSON root was not an object")?;

    // Sort the option paths so the generated docs index is deterministic and
    // stable across runs.
    let mut items: Vec<(&String, &Value)> = options.iter().collect();
    items.sort_by(|a, b| a.0.cmp(b.0));
    let mut docs = Vec::with_capacity(items.len());

    for (path, entry) in items {
        let Some(entry) = entry.as_object() else {
            continue;
        };
        docs.push(json!({
            "option_path": path,
            "anchor_id": format!("opt-{path}"),
            "summary": entry.get("description").and_then(Value::as_str).unwrap_or(""),
            "option_type": entry.get("type").and_then(Value::as_str),
        }));
    }

    let mut json = serde_json::to_string_pretty(&docs)?;
    json.push('\n');
    Ok(json)
}

/// Read a tool's cached docs file if it exists and validates, else `None`.
fn read_cached_docs_json(tool: OptionsTool, docs_dir: &Path) -> Option<String> {
    let docs_path = docs_dir.join(tool.docs_file_name());
    let cached_json = match std::fs::read_to_string(&docs_path) {
        Ok(json) => json,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
        Err(err) => {
            log::warn!(
                "[generated_docs] ignoring unreadable generated docs cache {}: {err:#}",
                docs_path.display()
            );
            return None;
        }
    };
    match validate_docs_json(&cached_json, tool.docs_file_name()) {
        Ok(()) => Some(cached_json),
        Err(err) => {
            log::warn!(
                "[generated_docs] ignoring invalid generated docs cache {}: {err:#}",
                docs_path.display()
            );
            None
        }
    }
}

/// Read a generated docs file if cached, otherwise generate and cache it.
/// With `force`, skip the cached file entirely and regenerate — used when the
/// cache is stale, where returning the existing file would defeat invalidation.
///
/// The durable artifact is the compact `*-docs.json` file. The raw options JSON
/// is generated, transformed, and then dropped.
fn read_or_generate_docs_json(tool: OptionsTool, docs_dir: &Path, force: bool) -> Result<String> {
    if !force {
        if let Some(cached_json) = read_cached_docs_json(tool, docs_dir) {
            return Ok(cached_json);
        }
    }

    let docs_path = docs_dir.join(tool.docs_file_name());
    let options_json = generate_options_json(tool, docs_dir)?;
    let docs_json = docs_index_json_from_options_json(&options_json)?;
    validate_docs_json(&docs_json, tool.docs_file_name())?;
    write_file_atomically(&docs_path, &docs_json)
        .with_context(|| format!("failed to write {}", docs_path.display()))?;
    Ok(docs_json)
}

/// Produce or read the cached nix-darwin compact docs JSON.
fn generate_nix_darwin_docs_json(docs_dir: &Path, force: bool) -> Result<String> {
    let _timer = TimerGuard::new("generate_nix_darwin_docs_json");
    read_or_generate_docs_json(OptionsTool::NixDarwin, docs_dir, force)
}

/// Produce or read the cached Home Manager compact docs JSON.
fn generate_home_manager_docs_json(docs_dir: &Path, force: bool) -> Result<String> {
    let _timer = TimerGuard::new("generate_home_manager_docs_json");
    read_or_generate_docs_json(OptionsTool::HomeManager, docs_dir, force)
}

impl GeneratedDocsIndexLoader {
    /// Core load flow with an injectable per-tool generator so tests can
    /// exercise the cache and staleness decisions without running Nix.
    /// `generate(tool, force)` must return the compact docs JSON for `tool`,
    /// regenerating rather than reading any cached file when `force` is set.
    fn load_with(
        &self,
        generate: impl Fn(OptionsTool, bool) -> Result<String>,
    ) -> Result<DocsIndex> {
        std::fs::create_dir_all(&self.docs_dir)?;

        if self.has_cached_docs() {
            match self.load_cached() {
                Ok(index) => return Ok(index),
                Err(err) => {
                    log::warn!(
                        "[generated_docs] generated docs cache is invalid; regenerating: {err:#}"
                    );
                }
            }
        }

        // Stale (or absent) metadata means any docs files on disk predate the
        // current pipeline schema or exceeded the maximum age, so force
        // regeneration instead of letting the generator hand the stale files
        // back. Fresh metadata with a missing file only happens for a corrupt
        // cache; reusing the intact file is then safe.
        let force = !self.cache_meta_is_fresh();
        let generated = generate(OptionsTool::NixDarwin, force)
            .and_then(|nix_darwin| Ok((nix_darwin, generate(OptionsTool::HomeManager, force)?)));
        match generated {
            Ok((nix_darwin_json, home_manager_json)) => {
                self.write_cache_meta()?;
                initialize_docs_index_from_strs(&nix_darwin_json, &home_manager_json)
            }
            Err(err) => {
                // Regeneration failed (offline, upstream breakage, missing
                // nix). Valid-but-stale generated docs still describe the
                // user's system better than the bundled static fallback the
                // caller would revert to, so serve them. The metadata is left
                // stale so a later launch retries the regeneration.
                match self.load_cached_files() {
                    Ok(index) => {
                        log::warn!(
                            "[generated_docs] regeneration failed; serving stale generated docs: {err:#}"
                        );
                        Ok(index)
                    }
                    Err(_) => Err(err),
                }
            }
        }
    }
}

impl DocsIndexLoader for GeneratedDocsIndexLoader {
    /// Load a complete generated docs index, generating missing or stale files
    /// if needed.
    ///
    /// Callers that must not block on Nix should use `load_cached` first and
    /// only call this method from a background task.
    fn load(&self) -> Result<DocsIndex> {
        // Generate in the same way as we do with the nix-options.sh script but
        // right here in Rust.
        self.load_with(|tool, force| match tool {
            OptionsTool::NixDarwin => generate_nix_darwin_docs_json(&self.docs_dir, force),
            OptionsTool::HomeManager => generate_home_manager_docs_json(&self.docs_dir, force),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docs::docs_system::DocsSource;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn docs_index_json_from_options_json_matches_python_shape() {
        let json = docs_index_json_from_options_json(
            r#"{
              "programs.git.enable": {
                "description": "Enable Git.",
                "type": "boolean"
              },
              "_module.args": "ignored"
            }"#,
        )
        .expect("docs index should be generated");

        let docs: Vec<Value> = serde_json::from_str(&json).expect("generated JSON should parse");
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0]["option_path"], "programs.git.enable");
        assert_eq!(docs[0]["anchor_id"], "opt-programs.git.enable");
        assert_eq!(docs[0]["summary"], "Enable Git.");
        assert_eq!(docs[0]["option_type"], "boolean");
    }

    #[test]
    fn write_file_atomically_writes_final_file_and_cleans_temp_path() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let path = temp.path().join("docs.json");

        write_file_atomically(&path, r#"[{"option_path":"programs.git.enable"}]"#)?;

        assert_eq!(
            std::fs::read_to_string(&path)?,
            r#"[{"option_path":"programs.git.enable"}]"#
        );
        let leftover_temp_files = std::fs::read_dir(temp.path())?
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".docs.json.")
            })
            .count();
        assert_eq!(leftover_temp_files, 0);

        Ok(())
    }

    #[test]
    fn read_or_generate_docs_json_returns_cached_file_without_nix() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let docs_dir = temp.path();
        let cached = r#"[
          {"option_path":"programs.git.enable","anchor_id":"opt-programs.git.enable","summary":"Enable Git.","option_type":"boolean"}
        ]"#;
        std::fs::write(docs_dir.join(NIX_DARWIN_DOCS_JSON_BASE), cached)?;

        let result = read_or_generate_docs_json(OptionsTool::NixDarwin, docs_dir, false)?;
        assert_eq!(result, cached, "should return the cached file verbatim");
        Ok(())
    }

    #[test]
    fn read_cached_docs_json_rejects_invalid_file() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let docs_dir = temp.path();
        std::fs::write(docs_dir.join(NIX_DARWIN_DOCS_JSON_BASE), "not json")?;

        assert!(read_cached_docs_json(OptionsTool::NixDarwin, docs_dir).is_none());
        Ok(())
    }

    const TEST_DOCS_JSON: &str = r#"[
      {"option_path":"programs.git.enable","anchor_id":"opt-programs.git.enable","summary":"Enable Git.","option_type":"boolean"}
    ]"#;

    /// Write both docs files so the cache looks complete apart from the metadata.
    fn write_docs_files(docs_dir: &Path) -> Result<()> {
        std::fs::write(docs_dir.join(NIX_DARWIN_DOCS_JSON_BASE), TEST_DOCS_JSON)?;
        std::fs::write(docs_dir.join(HOME_MANAGER_DOCS_JSON_BASE), TEST_DOCS_JSON)?;
        Ok(())
    }

    fn write_meta(docs_dir: &Path, schema_version: u32, generated_at: u64) -> Result<()> {
        let meta = serde_json::to_string(&DocsCacheMeta {
            schema_version,
            generated_at,
        })?;
        std::fs::write(docs_dir.join(DOCS_CACHE_META_FILE), meta)?;
        Ok(())
    }

    fn write_fresh_meta(docs_dir: &Path) -> Result<()> {
        write_meta(docs_dir, DOCS_CACHE_SCHEMA_VERSION, now_unix_secs())
    }

    #[test]
    fn load_forces_regeneration_when_cache_is_stale() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let docs_dir = temp.path();
        write_docs_files(docs_dir)?;
        write_meta(docs_dir, DOCS_CACHE_SCHEMA_VERSION - 1, now_unix_secs())?;

        let loader = GeneratedDocsIndexLoader::new(docs_dir.to_path_buf());
        let forced = std::cell::RefCell::new(Vec::new());
        let index = loader.load_with(|_tool, force| {
            forced.borrow_mut().push(force);
            Ok(TEST_DOCS_JSON.to_string())
        })?;

        assert_eq!(
            forced.into_inner(),
            vec![true, true],
            "stale metadata must force regeneration of both sources"
        );
        assert_eq!(index.entries.len(), 2);
        assert!(
            loader.cache_meta_is_fresh(),
            "metadata should be refreshed after regeneration"
        );
        Ok(())
    }

    #[test]
    fn load_reuses_intact_files_when_meta_is_fresh() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let docs_dir = temp.path();
        // Fresh metadata but one docs file missing: the surviving file may be
        // reused, only the missing one needs generating.
        std::fs::write(docs_dir.join(NIX_DARWIN_DOCS_JSON_BASE), TEST_DOCS_JSON)?;
        write_fresh_meta(docs_dir)?;

        let loader = GeneratedDocsIndexLoader::new(docs_dir.to_path_buf());
        let forced = std::cell::RefCell::new(Vec::new());
        loader.load_with(|_tool, force| {
            forced.borrow_mut().push(force);
            Ok(TEST_DOCS_JSON.to_string())
        })?;

        assert_eq!(
            forced.into_inner(),
            vec![false, false],
            "fresh metadata must not force regeneration"
        );
        Ok(())
    }

    #[test]
    fn load_serves_stale_cache_when_regeneration_fails() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let docs_dir = temp.path();
        write_docs_files(docs_dir)?;
        let expired = now_unix_secs() - DOCS_CACHE_MAX_AGE.as_secs() - 1;
        write_meta(docs_dir, DOCS_CACHE_SCHEMA_VERSION, expired)?;

        let loader = GeneratedDocsIndexLoader::new(docs_dir.to_path_buf());
        let index =
            loader.load_with(|_tool, _force| anyhow::bail!("nix is unavailable in this test"))?;

        assert_eq!(index.entries.len(), 2, "stale docs files should be served");
        assert!(
            !loader.cache_meta_is_fresh(),
            "metadata must stay stale so a later launch retries regeneration"
        );
        Ok(())
    }

    #[test]
    fn load_propagates_error_when_no_cache_and_generation_fails() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let loader = GeneratedDocsIndexLoader::new(temp.path().to_path_buf());
        let result = loader.load_with(|_tool, _force| anyhow::bail!("nix is unavailable"));
        assert!(result.is_err(), "no cache to fall back to");
        Ok(())
    }

    #[test]
    fn load_skips_generation_when_cache_is_fresh_and_complete() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let docs_dir = temp.path();
        write_docs_files(docs_dir)?;
        write_fresh_meta(docs_dir)?;

        let loader = GeneratedDocsIndexLoader::new(docs_dir.to_path_buf());
        let index = loader.load_with(|tool, _force| {
            panic!("generator must not run for a fresh cache: {}", tool.label())
        })?;
        assert_eq!(index.entries.len(), 2);
        Ok(())
    }

    #[test]
    fn load_cached_tags_entries_by_source() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let docs_dir = temp.path();

        let nix_darwin_docs = r#"[
          {"option_path":"homebrew.enable","anchor_id":"opt-homebrew.enable","summary":"Enable Homebrew.","option_type":"boolean"}
        ]"#;
        let home_manager_docs = r#"[
          {"option_path":"programs.git.enable","anchor_id":"opt-programs.git.enable","summary":"Enable Git.","option_type":"boolean"}
        ]"#;
        std::fs::write(docs_dir.join(NIX_DARWIN_DOCS_JSON_BASE), nix_darwin_docs)?;
        std::fs::write(
            docs_dir.join(HOME_MANAGER_DOCS_JSON_BASE),
            home_manager_docs,
        )?;
        write_fresh_meta(docs_dir)?;

        let loader = GeneratedDocsIndexLoader::new(docs_dir.to_path_buf());
        let index = loader.load_cached()?;

        assert_eq!(index.entries.len(), 2, "both sources loaded");
        let darwin = index
            .entries
            .iter()
            .find(|e| e.option_path == "homebrew.enable");
        let hm = index
            .entries
            .iter()
            .find(|e| e.option_path == "programs.git.enable");
        assert_eq!(darwin.map(|e| e.source), Some(DocsSource::NixDarwin));
        assert_eq!(hm.map(|e| e.source), Some(DocsSource::HomeManager));
        Ok(())
    }

    #[test]
    fn has_cached_docs_false_when_one_source_missing() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let docs_dir = temp.path();
        std::fs::write(
            docs_dir.join(NIX_DARWIN_DOCS_JSON_BASE),
            r#"[{"option_path":"homebrew.enable"}]"#,
        )?;

        let loader = GeneratedDocsIndexLoader::new(docs_dir.to_path_buf());
        assert!(
            !loader.has_cached_docs(),
            "partial cache should not be ready"
        );
        Ok(())
    }

    #[test]
    fn stale_schema_version_invalidates_cache() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let docs_dir = temp.path();
        write_docs_files(docs_dir)?;
        // Metadata from an older docs pipeline schema.
        write_meta(docs_dir, DOCS_CACHE_SCHEMA_VERSION - 1, now_unix_secs())?;

        let loader = GeneratedDocsIndexLoader::new(docs_dir.to_path_buf());
        assert!(
            !loader.has_cached_docs(),
            "cache with a stale schema version should not be ready"
        );
        Ok(())
    }

    #[test]
    fn expired_cache_age_invalidates_cache() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let docs_dir = temp.path();
        write_docs_files(docs_dir)?;
        let expired = now_unix_secs() - DOCS_CACHE_MAX_AGE.as_secs() - 1;
        write_meta(docs_dir, DOCS_CACHE_SCHEMA_VERSION, expired)?;

        let loader = GeneratedDocsIndexLoader::new(docs_dir.to_path_buf());
        assert!(
            !loader.has_cached_docs(),
            "cache older than the maximum age should not be ready"
        );
        Ok(())
    }

    #[test]
    fn fresh_meta_keeps_cache() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let docs_dir = temp.path();
        write_docs_files(docs_dir)?;
        write_fresh_meta(docs_dir)?;

        let loader = GeneratedDocsIndexLoader::new(docs_dir.to_path_buf());
        assert!(
            loader.has_cached_docs(),
            "cache with fresh metadata should be ready"
        );
        Ok(())
    }

    #[test]
    #[ignore = "Runs Nix against the user's current system for integration testing"]
    fn test_generate_docs() -> Result<()> {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_secs();
        let docs_dir = std::env::temp_dir()
            .join("generated-docs-test")
            .join(format!("{}-{}", stamp, std::process::id()));

        std::fs::create_dir_all(&docs_dir)?;

        println!("Generating docs into {}", docs_dir.display());

        let loader = GeneratedDocsIndexLoader::new(docs_dir.clone());
        let index = loader.load()?;

        let nix_darwin_path = docs_dir.join(NIX_DARWIN_DOCS_JSON_BASE);
        let home_manager_path = docs_dir.join(HOME_MANAGER_DOCS_JSON_BASE);
        let nix_darwin_size = std::fs::metadata(&nix_darwin_path)?.len();
        let home_manager_size = std::fs::metadata(&home_manager_path)?.len();
        let nix_darwin_count = index
            .entries
            .iter()
            .filter(|entry| entry.source == DocsSource::NixDarwin)
            .count();
        let home_manager_count = index
            .entries
            .iter()
            .filter(|entry| entry.source == DocsSource::HomeManager)
            .count();

        println!(
            "Generated {} entries total: {} nix-darwin, {} home-manager",
            index.entries.len(),
            nix_darwin_count,
            home_manager_count
        );
        println!("{} ({} bytes)", nix_darwin_path.display(), nix_darwin_size);
        println!(
            "{} ({} bytes)",
            home_manager_path.display(),
            home_manager_size
        );

        assert!(nix_darwin_path.exists(), "nix-darwin docs file exists");
        assert!(home_manager_path.exists(), "home-manager docs file exists");
        assert!(
            nix_darwin_count > 0,
            "expected generated nix-darwin entries"
        );
        assert!(
            home_manager_count > 0,
            "expected generated home-manager entries"
        );

        Ok(())
    }
}
