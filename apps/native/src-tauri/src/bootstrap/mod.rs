//! Bootstrap module: first-run setup and template handling.
//!
//! This module groups the functionality needed to initialize a new nix-darwin
//! configuration from bundled templates and to finalize the flake lock file.

pub mod default_config;
pub mod import;
pub mod template;

// Re-export the key public API so callers can use short paths.
#[allow(unused_imports)]
pub use default_config::{bootstrap, detect_darwin_platform, finalize_flake_lock};
