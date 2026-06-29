//! `#[derive(Configurable)]` — generates the helpers needed to read, write,
//! and render a settings struct without per-field frontend code.
//!
//! Per struct, the derive generates:
//!   - `load<R>(app)` — read the managed slice with defaults
//!   - `schema<R>(app)` — full UI schema with current values populated
//!   - `set_field<R>(app, key, value)` — write one field, type-checked
//!   - Wry-specialized shims (`*_wry`) for slice registry registration
//!
//! Use `#[config(scope = "global")]` or `#[config(scope = "repo")]` to select
//! the managed slice scope. Omitting `scope` defaults to global.
//!
//! Use `#[config(scope = "env")]` for build-time deployment profiles stored
//! in `apps/native/env.{development,release}.json` and embedded by `build.rs`. Fields
//! may declare `env_var` and `build_embed` to generate a `resolve()` method that
//! merges process env, CI secrets, and the embedded profile JSON.
//!
//! `schema_file` selects the JSON Schema output filename for codegen
//! (`cargo run -- gen-schemas`). Defaults: `settings.schema.json` (repo),
//! `env.schema.json` (env), `{snake_case_struct}.schema.json` (global).
//!
//! The companion `configurable` crate provides the runtime helpers and
//! re-exports this derive for end users.

mod attrs;
mod codegen;
mod fields;
mod strings;
mod types;

use proc_macro::TokenStream;
use syn::{DeriveInput, parse_macro_input};

/// Proc-macro entrypoint called by the compiler for each annotated struct.
///
/// This function only handles the Rust proc-macro boundary: parse raw tokens,
/// delegate generation to `expand`, and convert validation failures into
/// compiler errors at the derive site.
#[proc_macro_derive(Configurable, attributes(config))]
pub fn derive_configurable(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    codegen::expand(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}
