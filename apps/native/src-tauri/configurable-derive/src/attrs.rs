//! Attribute parsing for `#[derive(Configurable)]`. Handles how the struct is
//! serialized / deserialized.
//!
//! This module owns the compile-time contract for `#[config(...)]`. Keeping it
//! separate from token generation makes stale migration attributes fail in one
//! obvious place.

use syn::{Attribute, Expr, ExprArray, ExprRange, LitStr};

/// Which managed-slice scope owns a configurable struct's values.
///
/// `Global` stores are shared across all repositories; `Repo` stores are
/// scoped to a single repository's managed slice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StoreScope {
    Global,
    Repo,
    Env,
}

/// Parsed `#[config(...)]` attributes that apply to the whole struct.
///
/// Controls which managed-slice scope the generated store reads from and how
/// the struct is labelled in the settings UI.
pub(crate) struct StructConfig {
    /// The managed-slice scope that owns this struct's values. Defaults to
    /// [`StoreScope::Global`] when `scope` is omitted.
    pub(crate) scope: StoreScope,
    /// Human-readable name shown in the settings UI. Falls back to the Rust
    /// struct name when absent.
    pub(crate) display_name: Option<String>,
    /// One-line description shown beneath the display name.
    pub(crate) description: Option<String>,
    /// Output filename for generated JSON Schema (e.g. `settings.schema.json`).
    pub(crate) schema_file: Option<String>,
}

/// Parsed `#[config(...)]` attributes that apply to a single field.
///
/// Field attributes control the default value, persistence key, UI label,
/// and input constraints for the generated schema entry.
pub(crate) struct FieldConfig {
    /// Expression used as the fallback when no stored value exists.
    pub(crate) default: Option<Expr>,
    /// Override for the persistence key. Defaults to the Rust field name.
    pub(crate) key: Option<String>,
    /// Human-readable label shown in the settings UI.
    pub(crate) label: Option<String>,
    /// Help text displayed below the field in the settings UI.
    pub(crate) help: Option<String>,
    /// Inclusive range constraint for numeric fields (e.g. `0..=100`).
    pub(crate) range: Option<ExprRange>,
    /// Fixed set of allowed values for enum-like fields.
    pub(crate) options: Option<ExprArray>,
    /// Whether a text field should render as a multi-line textarea.
    pub(crate) multiline: bool,
    /// Process environment variable that overrides repo and build defaults.
    pub(crate) env_var: Option<String>,
    /// When true, fall back to compile-time `option_env!` for this field.
    pub(crate) build_embed: bool,
}

/// Parses attributes that apply to the whole configurable struct.
///
/// Struct attributes define how the generated schema is presented and which
/// managed slice scope owns the values. Unknown keys fail at compile time so
/// stale migration attributes do not sit unnoticed in settings structs.
/// Default JSON Schema filename for a configurable struct.
pub(crate) fn default_schema_file(scope: StoreScope, struct_name: &str) -> String {
    match scope {
        StoreScope::Repo => "settings.schema.json".to_string(),
        StoreScope::Env => "env.schema.json".to_string(),
        StoreScope::Global => format!("{}.schema.json", struct_name_to_snake(struct_name)),
    }
}

fn struct_name_to_snake(name: &str) -> String {
    let mut out = String::new();
    for (i, c) in name.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                out.push('_');
            }
            out.extend(c.to_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

pub(crate) fn parse_struct_config(
    attrs: &[Attribute],
    struct_name: &str,
) -> syn::Result<StructConfig> {
    let mut scope: Option<StoreScope> = None;
    let mut display_name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut schema_file: Option<String> = None;

    for attr in attrs {
        if !attr.path().is_ident("config") {
            continue;
        }
        attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("scope") {
                let value = meta.value()?;
                let lit: LitStr = value.parse()?;
                scope = Some(match lit.value().as_str() {
                    "global" => StoreScope::Global,
                    "repo" => StoreScope::Repo,
                    "env" => StoreScope::Env,
                    other => {
                        return Err(syn::Error::new_spanned(
                            lit,
                            format!("Configurable: unsupported scope `{other}`"),
                        ));
                    }
                });
                Ok(())
            } else if meta.path.is_ident("display_name") {
                let value = meta.value()?;
                let lit: LitStr = value.parse()?;
                display_name = Some(lit.value());
                Ok(())
            } else if meta.path.is_ident("description") {
                let value = meta.value()?;
                let lit: LitStr = value.parse()?;
                description = Some(lit.value());
                Ok(())
            } else if meta.path.is_ident("schema_file") {
                let value = meta.value()?;
                let lit: LitStr = value.parse()?;
                schema_file = Some(lit.value());
                Ok(())
            } else {
                Err(meta.error("unsupported #[config(...)] attribute on struct"))
            }
        })?;
    }

    let scope = scope.unwrap_or(StoreScope::Global);

    Ok(StructConfig {
        scope,
        display_name,
        description,
        schema_file: schema_file.or_else(|| Some(default_schema_file(scope, struct_name))),
    })
}

/// Parses attributes that apply to one configurable field.
///
/// A field must declare its default because `load` can run before a managed
/// slice exists, and because the schema needs a stable fallback value for the
/// frontend renderer.
pub(crate) fn parse_field_config(
    attrs: &[Attribute],
    ident: &syn::Ident,
) -> syn::Result<FieldConfig> {
    let mut default: Option<Expr> = None;
    let mut key: Option<String> = None;
    let mut label: Option<String> = None;
    let mut help: Option<String> = None;
    let mut range: Option<ExprRange> = None;
    let mut options: Option<ExprArray> = None;
    let mut multiline = false;
    let mut env_var: Option<String> = None;
    let mut build_embed = false;

    for attr in attrs {
        if !attr.path().is_ident("config") {
            continue;
        }
        attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("default") {
                let value = meta.value()?;
                default = Some(value.parse::<Expr>()?);
                Ok(())
            } else if meta.path.is_ident("key") {
                let value = meta.value()?;
                let lit: LitStr = value.parse()?;
                key = Some(lit.value());
                Ok(())
            } else if meta.path.is_ident("label") {
                let value = meta.value()?;
                let lit: LitStr = value.parse()?;
                label = Some(lit.value());
                Ok(())
            } else if meta.path.is_ident("help") {
                let value = meta.value()?;
                let lit: LitStr = value.parse()?;
                help = Some(lit.value());
                Ok(())
            } else if meta.path.is_ident("range") {
                let value = meta.value()?;
                range = Some(value.parse::<ExprRange>()?);
                Ok(())
            } else if meta.path.is_ident("options") {
                let value = meta.value()?;
                options = Some(value.parse::<ExprArray>()?);
                Ok(())
            } else if meta.path.is_ident("multiline") {
                let value = meta.value()?;
                let lit: syn::LitBool = value.parse()?;
                multiline = lit.value;
                Ok(())
            } else if meta.path.is_ident("env_var") {
                let value = meta.value()?;
                let lit: LitStr = value.parse()?;
                env_var = Some(lit.value());
                Ok(())
            } else if meta.path.is_ident("build_embed") {
                let value = meta.value()?;
                let lit: syn::LitBool = value.parse()?;
                build_embed = lit.value;
                Ok(())
            } else {
                Err(meta.error(format!(
                    "unsupported #[config(...)] attribute on field `{}`",
                    ident
                )))
            }
        })?;
    }
    Ok(FieldConfig {
        default,
        key,
        label,
        help,
        range,
        options,
        multiline,
        env_var,
        build_embed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use syn::{DeriveInput, parse_quote};

    #[test]
    fn parse_struct_config_accepts_repo_scope() {
        let input: DeriveInput = parse_quote! {
            #[config(scope = "repo", display_name = "Evolution")]
            struct EvolutionLimits {
                max_iterations: usize,
            }
        };

        let config = parse_struct_config(&input.attrs, "EvolutionLimits").expect("config parses");

        assert!(matches!(config.scope, StoreScope::Repo));
        assert_eq!(config.display_name.as_deref(), Some("Evolution"));
        assert_eq!(config.schema_file.as_deref(), Some("settings.schema.json"));
    }

    #[test]
    fn parse_struct_config_defaults_to_global_scope() {
        let input: DeriveInput = parse_quote! {
            struct Preferences {
                enabled: bool,
            }
        };

        let config = parse_struct_config(&input.attrs, "Preferences").expect("config parses");

        assert!(matches!(config.scope, StoreScope::Global));
        assert_eq!(
            config.schema_file.as_deref(),
            Some("preferences.schema.json")
        );
    }
}
