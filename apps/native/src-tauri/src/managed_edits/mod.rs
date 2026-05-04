//! Managed edit helpers for non-AI config file mutations.
//!
//! These modules share the "managed edit" pattern: scan/plan a config file
//! mutation, apply it via evolve primitives, then finalize into the review flow.

pub mod homebrew_adopt;
pub mod managed_edit;
pub mod system_defaults;
