//! Rust-type to configurable-schema type mapping.
//!
//! The derive intentionally supports a narrow, explicit set of setting field
//! shapes so frontend rendering stays predictable across Rust, JSON, and
//! TypeScript.

use crate::attrs::FieldConfig;
use crate::strings::humanize;
use proc_macro2::TokenStream as TokenStream2;
use quote::quote;
use syn::{Expr, ExprLit, ExprRange, Lit, RangeLimits, Type};

/// Maps a Rust field type plus field attributes to the UI field type.
///
/// The derive intentionally supports a small set of field shapes so generated
/// settings stay predictable across Rust, JSON, and TypeScript. Enum-like
/// fields must provide explicit `options` because arbitrary Rust enum metadata
/// is not available in a useful runtime form here.
pub(crate) fn field_type_expr(ty: &Type, cfg: &FieldConfig) -> syn::Result<TokenStream2> {
    // Explicit options attribute -> Enum, regardless of Rust type.
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
                None => (
                    quote! { ::std::option::Option::None },
                    quote! { ::std::option::Option::None },
                ),
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

/// Converts a Rust range expression into optional numeric UI bounds.
///
/// The schema only carries inclusive `min` and `max` values. Half-open Rust
/// ranges are accepted for author convenience but collapse to the same UI max
/// representation because number inputs do not model exclusive bounds.
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
                // For half-open ranges treat the bound as inclusive in the UI:
                // HTML number inputs only understand inclusive max.
                RangeLimits::HalfOpen(_) => quote! { ::std::option::Option::Some(#value) },
            }
        }
        None => quote! { ::std::option::Option::None },
    };
    (from, to)
}

/// Extracts the final path segment from a field type.
///
/// This supports simple cases like `String` or `std::string::String`. More
/// complex types are rejected so the macro does not silently generate a schema
/// that the frontend cannot render.
fn type_last_ident(ty: &Type) -> Option<String> {
    match ty {
        Type::Path(tp) => tp.path.segments.last().map(|s| s.ident.to_string()),
        _ => None,
    }
}
