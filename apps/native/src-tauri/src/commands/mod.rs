//! Tauri command handlers exposed to the frontend.
//!
//! These async functions are callable from JavaScript via `invoke()`.
//! Each command handles a specific user action and delegates to the
//! appropriate module for the actual implementation.
//!
//! NOTE: The server is stateless regarding UI state. All app state (generating,
//! preview mode, etc.) is computed and managed entirely by the client.

mod helpers;

pub mod apply;
pub mod cli_tool;
pub mod config;
pub mod debug;
pub mod editor;
pub mod evolve;
pub mod evolve_state;
pub mod feedback;
pub mod git;
pub mod homebrew;
pub mod peek;
pub mod permissions;
pub mod rollback;
pub mod summarize;
pub mod system_defaults;
pub mod ui_prefs;
pub mod updater;
