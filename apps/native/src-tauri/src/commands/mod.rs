//! Tauri command handlers exposed to the frontend.
//!
//! These async functions are callable from JavaScript via `invoke()`.
//! Each command handles a specific user action and delegates to the
//! appropriate module for the actual implementation.
//!
//! NOTE: The server is stateless regarding UI state. All app state (generating,
//! preview mode, etc.) is computed and managed entirely by the client.
//! NOTE: invoke is deprecated in favor of oRPC which has several benefits,
//! most importantly that it's typed the whole way through (invoke only gives you
//! types of the inputs and outputs, then leaves it up to you to manually put
//! together. It also lets us use react queries that get rid of the need to create
//! any stores for the values that are read by the frontend, and a free cache.
mod helpers;

pub mod account;
pub mod apply;
pub mod cli_tool;
pub mod config;
pub mod debug;
pub mod dev_configs;
pub mod editor;
pub mod evolve;
pub mod evolve_state;
pub mod feedback;
pub mod git;
pub mod homebrew;
pub mod launchd;
pub mod onboarding;
pub mod peek;
pub mod permissions;
pub mod rollback;
pub mod settings_io;
pub mod summarize;
pub mod system_defaults;
pub mod ui_prefs;
pub mod updater;
