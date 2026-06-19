//! Persisted application state, split by scope and lifecycle.
//!
//! Each domain module defines a concrete state type, picks a persistence
//! backend (app-data vs repo-scoped), and exposes load/get/set functions
//! that wrap an [`Observable<T>`](crate::observable::Observable). Commands
//! and lifecycle code call into those wrappers.
//!
//! The key distinction is persistence scope:
//! - `GlobalPreferences` → per-device, stored in the OS app-data directory
//! - `EvolutionLimits` → repo-scoped, stored under `<config_dir>/.nixmac/`
//! - `EvolveState` → per-device (step routing is machine-local)
//!
//! Adding a new state type: define the struct, pick a persistence backend
//! from `crate::observable`, and construct an `Observable<T>` during Tauri
//! setup with `.emit_to()` and `.persist_to()` attached as needed.

pub mod build_state;
pub mod completion_log;
pub mod drift_notifications;
pub mod evolve_state;
pub mod preferences;
pub mod session_log;
pub mod watcher;
