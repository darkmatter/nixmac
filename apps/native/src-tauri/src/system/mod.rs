//! OS-level inspection and system interaction modules.
//!
//! This module groups functionality that reads from or interacts with the
//! operating system directly: Nix path resolution, macOS system defaults
//! scanning, file-system permission checks, and secret detection.

pub mod app_management_preflight;
pub mod etc_preflight;
pub mod install_location;
pub mod launchd_scanner;
pub mod nix;
pub mod nix_ast_lists;
pub mod permissions;
pub mod scanner;
pub mod secret_scanner;
