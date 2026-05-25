//! `#[derive(Configurable)]` — generates everything the runtime registry
//! needs to read, write, and render a settings struct without per-field
//! frontend code.
//!
//! Per struct, the derive generates:
//!   - `load<R>(app)` — read all fields from the store with defaults
//!   - `schema<R>(app)` — full UI schema with current values populated
//!   - `set_field<R>(app, key, value)` — write one field, type-checked
//!   - Wry-specialized shims (`*_wry`) for the type-erased registry
//!   - `inventory::submit!` — auto-registers the struct at startup
//!
//! The companion `configurable` crate provides the runtime helpers and
//! re-exports this derive for end users.

use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::quote;
use syn::{
    parse_macro_input, Attribute, Data, DeriveInput, Expr, ExprArray, ExprLit, ExprPath,
    ExprRange, Fields, Lit, LitStr, RangeLimits, Type,
};

/// How the generated `load()` method resolves the store file path:
///   - `Const(s)` — fixed string, baked in at compile time
///   - `Fn(path)` — runtime call to `path(app)?` returning a `String`-ish
enum StorePath {
    Const(String),
    Fn(ExprPath),
}

struct StructConfig {
    store_path: StorePath,
    display_name: Option<String>,
    description: Option<String>,
}

struct FieldConfig {
    default: Option<Expr>,
    key: Option<String>,
    label: Option<String>,
    help: Option<String>,
    range: Option<ExprRange>,
    options: Option<ExprArray>,
    multiline: bool,
}

#[proc_macro_derive(Configurable, attributes(config))]
pub fn derive_configurable(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

fn expand(input: DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;
    let name_str = name.to_string();
    let struct_config = parse_struct_config(&input.attrs, name)?;
    let display_name = struct_config
        .display_name
        .clone()
        .unwrap_or_else(|| name_str.clone());
    let description_expr = match &struct_config.description {
        Some(s) => quote! { ::std::option::Option::Some(#s.to_string()) },
        None => quote! { ::std::option::Option::None },
    };

    // The store path is resolved inside each generated method's body so
    // `store_path_fn` can use `app`.
    let store_path_binding: TokenStream2 = match &struct_config.store_path {
        StorePath::Const(s) => quote! { let __store_path: &str = #s; },
        StorePath::Fn(path) => quote! {
            let __store_path_string: ::std::string::String = #path(app)?;
            let __store_path: &str = __store_path_string.as_str();
        },
    };

    let fields = match &input.data {
        Data::Struct(s) => match &s.fields {
            Fields::Named(named) => &named.named,
            _ => {
                return Err(syn::Error::new_spanned(
                    name,
                    "Configurable requires a struct with named fields",
                ))
            }
        },
        _ => {
            return Err(syn::Error::new_spanned(
                name,
                "Configurable can only be derived for structs",
            ))
        }
    };

    // Per-field codegen — collect into three buckets:
    //   load_inits     : `field: read_or_default,` for the Self { ... } literal
    //   schema_fields  : `ConfigField { ... },` per field
    //   set_field_arms : `"key" => { typecheck; write; },` for the match
    let mut load_inits = Vec::new();
    let mut schema_fields = Vec::new();
    let mut set_field_arms = Vec::new();

    for field in fields {
        let ident = field
            .ident
            .as_ref()
            .ok_or_else(|| syn::Error::new_spanned(field, "field must be named"))?;
        let ty = &field.ty;
        let cfg = parse_field_config(&field.attrs, ident)?;

        let key = cfg
            .key
            .clone()
            .unwrap_or_else(|| snake_to_camel(&ident.to_string()));
        let default = cfg.default.clone().ok_or_else(|| {
            syn::Error::new_spanned(field, "field requires #[config(default = ...)]")
        })?;
        let label = cfg.label.clone().unwrap_or_else(|| humanize(&ident.to_string()));
        let help_expr = match &cfg.help {
            Some(h) => quote! { ::std::option::Option::Some(#h.to_string()) },
            None => quote! { ::std::option::Option::None },
        };
        let ty_expr = field_type_expr(ty, &cfg)?;

        load_inits.push(quote! {
            #ident: ::configurable::read_field::<R, #ty>(app, __store_path, #key)?
                .unwrap_or_else(|| #default),
        });

        schema_fields.push(quote! {
            ::configurable::ConfigField {
                key: #key.to_string(),
                label: #label.to_string(),
                help: #help_expr,
                ty: #ty_expr,
                default: ::serde_json::json!(#default),
                current: ::configurable::read_field::<R, ::serde_json::Value>(app, __store_path, #key)?
                    .unwrap_or_else(|| ::serde_json::json!(#default)),
            },
        });

        set_field_arms.push(quote! {
            #key => {
                // Type-check: round-trip through the declared Rust type.
                let _typed: #ty = ::serde_json::from_value(value.clone())
                    .map_err(|e| ::anyhow::anyhow!(
                        "Configurable {}: invalid value for `{}`: {}",
                        #name_str, #key, e,
                    ))?;
                ::configurable::write_field(app, __store_path, #key, value)?;
                ::std::result::Result::Ok(())
            }
        });
    }

    Ok(quote! {
        impl #name {
            pub fn load<R: ::tauri::Runtime>(
                app: &::tauri::AppHandle<R>,
            ) -> ::std::result::Result<Self, ::anyhow::Error> {
                #store_path_binding
                ::std::result::Result::Ok(Self {
                    #(#load_inits)*
                })
            }

            pub fn schema<R: ::tauri::Runtime>(
                app: &::tauri::AppHandle<R>,
            ) -> ::std::result::Result<::configurable::ConfigurableSchema, ::anyhow::Error> {
                #store_path_binding
                ::std::result::Result::Ok(::configurable::ConfigurableSchema {
                    name: #name_str.to_string(),
                    display_name: #display_name.to_string(),
                    description: #description_expr,
                    fields: ::std::vec![
                        #(#schema_fields)*
                    ],
                })
            }

            pub fn set_field<R: ::tauri::Runtime>(
                app: &::tauri::AppHandle<R>,
                key: &str,
                value: ::serde_json::Value,
            ) -> ::std::result::Result<(), ::anyhow::Error> {
                #store_path_binding
                match key {
                    #(#set_field_arms)*
                    other => ::std::result::Result::Err(::anyhow::anyhow!(
                        "Configurable {}: unknown field `{}`",
                        #name_str, other,
                    )),
                }
            }

            // Wry-specialized shims for the type-erased registry. Generic
            // functions can't be cast to fn pointers; these monomorphic
            // wrappers can.
            #[doc(hidden)]
            pub fn __configurable_schema_wry(
                app: &::tauri::AppHandle<::tauri::Wry>,
            ) -> ::std::result::Result<::configurable::ConfigurableSchema, ::anyhow::Error> {
                Self::schema(app)
            }

            #[doc(hidden)]
            pub fn __configurable_set_field_wry(
                app: &::tauri::AppHandle<::tauri::Wry>,
                key: &str,
                value: ::serde_json::Value,
            ) -> ::std::result::Result<(), ::anyhow::Error> {
                Self::set_field(app, key, value)
            }
        }

        ::configurable::inventory::submit! {
            ::configurable::RegisteredConfig {
                name: #name_str,
                schema_fn: #name::__configurable_schema_wry,
                set_field_fn: #name::__configurable_set_field_wry,
            }
        }
    })
}

fn field_type_expr(ty: &Type, cfg: &FieldConfig) -> syn::Result<TokenStream2> {
    // Explicit options attribute → Enum, regardless of Rust type.
    if let Some(arr) = &cfg.options {
        let variant_tokens: Vec<TokenStream2> = arr
            .elems
            .iter()
            .map(|elem| {
                let value_str = match elem {
                    Expr::Lit(ExprLit {
                        lit: Lit::Str(s), ..
                    }) => s.value(),
                    _ => {
                        return Err(syn::Error::new_spanned(
                            elem,
                            "#[config(options = [...])] entries must be string literals",
                        ))
                    }
                };
                let label = humanize(&value_str);
                Ok(quote! {
                    ::configurable::EnumVariant {
                        value: #value_str.to_string(),
                        label: #label.to_string(),
                    }
                })
            })
            .collect::<syn::Result<_>>()?;
        return Ok(quote! {
            ::configurable::FieldType::Enum {
                variants: ::std::vec![ #(#variant_tokens),* ],
            }
        });
    }

    // Otherwise dispatch on the Rust type's last path segment.
    let name = type_last_ident(ty).ok_or_else(|| {
        syn::Error::new_spanned(
            ty,
            "Configurable: can't determine field type — add #[config(options = [...])] for enums",
        )
    })?;

    match name.as_str() {
        "u8" | "u16" | "u32" | "u64" | "usize" | "i8" | "i16" | "i32" | "i64" | "isize"
        | "f32" | "f64" => {
            let (min_expr, max_expr) = match &cfg.range {
                Some(range) => range_bounds(range),
                None => (quote! { ::std::option::Option::None }, quote! { ::std::option::Option::None }),
            };
            Ok(quote! {
                ::configurable::FieldType::Number {
                    min: #min_expr,
                    max: #max_expr,
                    step: ::std::option::Option::None,
                }
            })
        }
        "bool" => Ok(quote! { ::configurable::FieldType::Boolean }),
        "String" => {
            let ml = cfg.multiline;
            Ok(quote! { ::configurable::FieldType::String { multiline: #ml } })
        }
        other => Err(syn::Error::new_spanned(
            ty,
            format!(
                "Configurable: unsupported field type `{other}` — use a numeric primitive, bool, String, or supply #[config(options = [...])] for enums",
            ),
        )),
    }
}

fn range_bounds(range: &ExprRange) -> (TokenStream2, TokenStream2) {
    let from = match &range.start {
        Some(e) => quote! { ::std::option::Option::Some((#e) as f64) },
        None => quote! { ::std::option::Option::None },
    };
    let to = match &range.end {
        Some(e) => {
            let value = quote! { (#e) as f64 };
            match range.limits {
                RangeLimits::Closed(_) => quote! { ::std::option::Option::Some(#value) },
                // For half-open ranges treat the bound as inclusive in the UI —
                // HTML number inputs only understand inclusive max.
                RangeLimits::HalfOpen(_) => quote! { ::std::option::Option::Some(#value) },
            }
        }
        None => quote! { ::std::option::Option::None },
    };
    (from, to)
}

fn type_last_ident(ty: &Type) -> Option<String> {
    match ty {
        Type::Path(tp) => tp.path.segments.last().map(|s| s.ident.to_string()),
        _ => None,
    }
}

fn parse_struct_config(attrs: &[Attribute], name: &syn::Ident) -> syn::Result<StructConfig> {
    let mut store_path: Option<String> = None;
    let mut store_path_fn: Option<ExprPath> = None;
    let mut display_name: Option<String> = None;
    let mut description: Option<String> = None;

    for attr in attrs {
        if !attr.path().is_ident("config") {
            continue;
        }
        attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("store_path") {
                let value = meta.value()?;
                let lit: LitStr = value.parse()?;
                store_path = Some(lit.value());
                Ok(())
            } else if meta.path.is_ident("store_path_fn") {
                let value = meta.value()?;
                store_path_fn = Some(value.parse::<ExprPath>()?);
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
            } else {
                Err(meta.error("unsupported #[config(...)] attribute on struct"))
            }
        })?;
    }

    let path = match (store_path, store_path_fn) {
        (Some(_), Some(_)) => {
            return Err(syn::Error::new_spanned(
                name,
                "Configurable: pick either #[config(store_path = \"...\")] or #[config(store_path_fn = ...)], not both",
            ));
        }
        (Some(s), None) => StorePath::Const(s),
        (None, Some(p)) => StorePath::Fn(p),
        (None, None) => {
            return Err(syn::Error::new_spanned(
                name,
                "Configurable: missing #[config(store_path = \"...\")] or #[config(store_path_fn = ...)] on struct",
            ));
        }
    };

    Ok(StructConfig {
        store_path: path,
        display_name,
        description,
    })
}

fn parse_field_config(attrs: &[Attribute], ident: &syn::Ident) -> syn::Result<FieldConfig> {
    let mut default: Option<Expr> = None;
    let mut key: Option<String> = None;
    let mut label: Option<String> = None;
    let mut help: Option<String> = None;
    let mut range: Option<ExprRange> = None;
    let mut options: Option<ExprArray> = None;
    let mut multiline = false;

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
    })
}

fn snake_to_camel(snake: &str) -> String {
    let mut out = String::with_capacity(snake.len());
    let mut upper_next = false;
    for c in snake.chars() {
        if c == '_' {
            upper_next = true;
        } else if upper_next {
            out.extend(c.to_uppercase());
            upper_next = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// Convert a snake_case or kebab-case identifier into a Title-Cased label
/// suitable for UI rendering. "max_iterations" -> "Max iterations".
fn humanize(s: &str) -> String {
    let normalized = s.replace(['_', '-'], " ");
    let mut chars = normalized.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}
