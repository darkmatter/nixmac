//! Bootstrap module: first-run setup and template handling.
//!
//! This module groups the functionality needed to initialize a new nix-darwin
//! configuration from bundled templates and to finalize the flake lock file.

pub mod default_config;
pub mod import;
pub mod template;

use std::path::Path;

// Re-export the key public API so callers can use short paths.
#[allow(unused_imports)]
pub use default_config::{detect_darwin_platform, finalize_flake_lock};

/// Returns true if the path has a `.nix` extension, indicating it is likely a Nix file.
pub(crate) fn is_nix_file(path: &Path) -> bool {
    path.extension().map(|ext| ext == "nix").unwrap_or(false)
}
