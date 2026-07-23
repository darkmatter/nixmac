//! Privileged helper integration for unattended activation.
//!
//! The GUI and sync agent keep git/sync/build work in the user session. The
//! helper daemon is intentionally narrow: it validates and activates an already
//! built nix-darwin store path.

pub mod client;
#[allow(dead_code)]
pub mod helper_runtime;
pub mod protocol;
pub mod root_activation;
pub mod service;
pub mod sync_agent;
