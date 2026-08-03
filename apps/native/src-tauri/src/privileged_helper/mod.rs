//! Privileged helper integration for unattended activation.
//!
//! The GUI and sync agent keep git/sync/build work in the user session. The
//! helper daemon is intentionally narrow: it validates and activates an already
//! built nix-darwin store path.

pub mod client;
#[allow(dead_code)]
pub mod helper_runtime;
pub mod peer_auth;
pub mod protocol;
// Complete and unreachable from production: nothing calls the reconciliation
// function yet. The change that wires it into startup, the grant and disable
// actions, apply, and the updater removes this.
#[allow(dead_code)]
pub mod reconcile;
pub mod root_activation;
pub mod service;
pub mod socket_probe;
pub mod sync_agent;
