//! Persisted application state, split by scope and lifecycle.
//!
//! This module owns two categories of state:
//!
//! - **Slices** (`slice`): generic typed containers with pluggable persistence.
//!   Each `Slice<T>` holds in-memory state, flushes to a JSON file on write,
//!   and emits a Tauri event so the frontend stays in sync. See the slice
//!   module docs for the full contract.
//!
//! - **Domain modules**: thin wrappers that define a concrete state type,
//!   choose a persistence backend (app-data vs repo-scoped), and expose
//!   load/get/set functions. These are the call sites that commands and
//!   lifecycle code actually use.
//!
//! The key distinction is persistence scope:
//! - `GlobalPreferences` → per-device, stored in the OS app-data directory
//! - `EvolutionLimits` → repo-scoped, stored under `<config_dir>/.nixmac/`
//! - `EvolveState` → per-device (step routing is machine-local)
//!
//! Adding a new state type: define the struct, pick a persistence backend,
//! load a `Slice<T>` during Tauri setup, and optionally register it with
//! the slice registry for developer-settings UI.

pub mod build_state;
pub mod completion_log;
pub mod drift_notifications;
pub mod evolve_state;
pub mod preferences;
pub mod session_log;
/// Generic state slices used by runtime state and scoped preferences.
pub mod slice;
pub mod watcher;
