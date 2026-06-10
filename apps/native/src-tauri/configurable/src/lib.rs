//! Configurable — typed dev settings without per-knob boilerplate.
//!
//! This is the runtime crate. The derive macro lives in `configurable-derive`;
//! this crate re-exports it and provides the schema types the generated code
//! returns to settings/dev tooling.
//!
//! Derive `Configurable` on a struct to:
//!   1. Generate a `load(app)` method that reads the managed observable,
//!      falling back to per-field defaults when it isn't yet managed.
//!   2. Expose a static schema (`schema()`) describing every field's type,
//!      label, help text, range, and default value. No `AppHandle` needed —
//!      the schema is the same value every call and trivially cacheable.
//!   3. Push the type into a compile-time `inventory` collection so the dev
//!      settings UI can enumerate every configurable without explicit
//!      registration.
//!
//! ```ignore
//! use configurable::Configurable;
//!
//! #[derive(Configurable, Debug, Clone, Serialize, Deserialize)]
//! #[config(
//!     scope = "repo",
//!     display_name = "Tuning",
//! )]
//! pub struct EvolutionLimits {
//!     #[config(
//!         default = 25,
//!         key = "maxIterations",
//!         label = "Max iterations",
//!         range = 1..=200,
//!         help = "API calls before stopping",
//!     )]
//!     pub max_iterations: usize,
//! }
//!
//! let limits = EvolutionLimits::load(&app)?;
//! let schema = EvolutionLimits::schema();
//! ```

use serde::{Deserialize, Serialize};
use specta::Type;

pub use configurable_derive::Configurable;

// Re-exported so derive output can write `::configurable::inventory::submit!`
// without consumers needing to add the crate themselves.
pub use inventory;

// =============================================================================
// Schema types — flow to TS via specta
// =============================================================================

/// What kind of control should render this field.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FieldType {
    /// Numeric input with optional min/max/step.
    Number {
        #[serde(skip_serializing_if = "Option::is_none")]
        min: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        max: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        step: Option<f64>,
    },
    /// Toggle / checkbox.
    Boolean,
    /// Single-line text or multi-line textarea when `multiline = true`.
    String { multiline: bool },
    /// Select / dropdown of pre-declared options.
    Enum { variants: Vec<EnumVariant> },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EnumVariant {
    pub value: String,
    pub label: String,
}

/// Static description of one Configurable field.
///
/// Produced by the derive macro with no runtime context; the same value every
/// call. Pair with a [`ConfigFieldValue`] (matched by `key`) to get the
/// current store-backed value for rendering.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFieldSchema {
    /// Key as written to the underlying store (typically camelCase).
    pub key: String,
    /// Human-readable label rendered above the input.
    pub label: String,
    /// Optional help text (rendered as a tooltip / "info" icon).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
    /// What control to render.
    pub ty: FieldType,
    /// Default if the store has no value yet.
    pub default: serde_json::Value,
}

/// Current value for one Configurable field, keyed identically to its
/// [`ConfigFieldSchema`]. Sent alongside the schema in the dev-settings IPC
/// response so the frontend can render initial input state.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFieldValue {
    pub key: String,
    pub current: serde_json::Value,
}

/// One section in the auto-rendered settings panel — corresponds to one
/// `#[derive(Configurable)]` struct. Static metadata only; no current values.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurableSchema {
    /// Unique stable identifier (struct's Rust name). Used by `set_field` to
    /// dispatch to the right registered configurable.
    pub name: String,
    /// Title shown above the section in the UI.
    pub display_name: String,
    /// Optional one-line description shown under the title.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub fields: Vec<ConfigFieldSchema>,
}

/// Joined-at-the-boundary response for `dev_configs_list`: the static schema
/// plus the current values loaded from the managed observable.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurableSnapshot {
    pub schema: ConfigurableSchema,
    pub values: Vec<ConfigFieldValue>,
}

// =============================================================================
// Compile-time registry — populated by the derive via `inventory::submit!`
// =============================================================================

/// Static metadata for one `#[derive(Configurable)]` struct.
///
/// The derive macro pushes one of these per struct via `inventory::submit!`
/// at link time, so iterating every registered configurable is just a walk
/// over `inventory::iter::<ConfigurableMeta>()` — no runtime registry, no
/// app-startup registration step.
pub struct ConfigurableMeta {
    /// Stable Rust-side name of the configurable state type.
    pub name: &'static str,
    /// Returns the static UI schema. Same value every call; no app needed.
    pub schema_fn: fn() -> ConfigurableSchema,
    /// Loads the current state as a JSON object so the dev-settings command
    /// can join it with the static schema by field key.
    pub load_value_fn: fn(&tauri::AppHandle<tauri::Wry>) -> anyhow::Result<serde_json::Value>,
    /// Writes one validated field value into the managed observable.
    pub set_field_fn:
        fn(&tauri::AppHandle<tauri::Wry>, &str, serde_json::Value) -> anyhow::Result<()>,
}

inventory::collect!(ConfigurableMeta);
