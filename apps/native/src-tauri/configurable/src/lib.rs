//! Configurable — typed dev settings without per-knob boilerplate.
//!
//! This is the runtime crate. The derive macro lives in `configurable-derive`;
//! this crate re-exports it and provides the schema types the generated code
//! returns to settings/dev tooling.
//!
//! Derive `Configurable` on a struct to:
//!   1. Generate a `load(app)` method that reads the managed slice, falling
//!      back to per-field defaults when the slice is not yet registered.
//!   2. Expose a rich schema (`schema()`) describing every field's
//!      type, label, help text, range, and default value.
//!   3. Generate Wry-specialized shim methods that callers can register with
//!      the slice registry.
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
//! let schema = EvolutionLimits::schema(&app)?;
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

/// Per-field description rendered into a UI control.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigField {
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
    /// Current value loaded from the store.
    pub current: serde_json::Value,
}

/// One section in the auto-rendered settings panel — corresponds to one
/// `#[derive(Configurable)]` struct.
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
    pub fields: Vec<ConfigField>,
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
    /// Returns the UI schema with current values populated.
    pub schema_fn: fn(&tauri::AppHandle<tauri::Wry>) -> anyhow::Result<ConfigurableSchema>,
    /// Writes one validated field value into the managed observable.
    pub set_field_fn:
        fn(&tauri::AppHandle<tauri::Wry>, &str, serde_json::Value) -> anyhow::Result<()>,
}

inventory::collect!(ConfigurableMeta);
