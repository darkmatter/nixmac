//! Field validation and field-level token generation.
//!
//! Each setting field contributes snippets to several generated methods. This
//! module turns one `syn::Field` into those reusable snippets so the final
//! method assembly does not need to know about field attributes.

use crate::attrs::parse_field_config;
use crate::strings::{humanize, snake_to_camel};
use crate::types::field_type_expr;
use proc_macro2::TokenStream as TokenStream2;
use quote::quote;
use syn::{Data, DeriveInput, Fields};

/// Token fragments for one configurable field.
///
/// Keeping these together prevents `expand` from becoming a long mix of
/// parsing, validation, and final method assembly.
pub(crate) struct FieldCode {
    default_init: TokenStream2,
    schema_field: TokenStream2,
    set_field_arm: TokenStream2,
}

/// The field-level fragments are consumed by different generated methods:
/// defaults feed `load`, schema entries feed `schema`, and setter arms feed
/// `set_field`.
pub(crate) struct GeneratedFields {
    pub(crate) default_inits: Vec<TokenStream2>,
    pub(crate) schema_fields: Vec<TokenStream2>,
    pub(crate) set_field_arms: Vec<TokenStream2>,
}

/// Returns the named fields the derive knows how to expose as settings.
///
/// Tuple structs and unit structs are rejected here because the generated
/// schema needs stable field identifiers for keys, labels, defaults, and typed
/// setters.
pub(crate) fn named_fields(
    input: &DeriveInput,
) -> syn::Result<&syn::punctuated::Punctuated<syn::Field, syn::token::Comma>> {
    let name = &input.ident;
    match &input.data {
        Data::Struct(s) => match &s.fields {
            Fields::Named(named) => Ok(&named.named),
            _ => Err(syn::Error::new_spanned(
                name,
                "Configurable requires a struct with named fields",
            )),
        },
        _ => Err(syn::Error::new_spanned(
            name,
            "Configurable can only be derived for structs",
        )),
    }
}

/// Generates all field-level fragments in one pass.
///
/// Each configurable field contributes to three generated methods. Grouping
/// fragments by method keeps `build_scope_methods` simple without reparsing
/// field attributes later.
pub(crate) fn generate_fields(
    fields: &syn::punctuated::Punctuated<syn::Field, syn::token::Comma>,
    name_str: &str,
) -> syn::Result<GeneratedFields> {
    let mut default_inits = Vec::new();
    let mut schema_fields = Vec::new();
    let mut set_field_arms = Vec::new();

    for field in fields {
        let generated = generate_field(field, name_str)?;
        default_inits.push(generated.default_init);
        schema_fields.push(generated.schema_field);
        set_field_arms.push(generated.set_field_arm);
    }

    Ok(GeneratedFields {
        default_inits,
        schema_fields,
        set_field_arms,
    })
}

/// Validates one field and emits the snippets needed by the generated methods.
///
/// This is where field attributes become concrete behavior: default values feed
/// fallback loading, type metadata feeds the UI schema, and the setter arm
/// round-trips through the declared Rust type before mutating the slice.
fn generate_field(field: &syn::Field, name_str: &str) -> syn::Result<FieldCode> {
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
    let default = cfg
        .default
        .clone()
        .ok_or_else(|| syn::Error::new_spanned(field, "field requires #[config(default = ...)]"))?;
    let label = cfg
        .label
        .clone()
        .unwrap_or_else(|| humanize(&ident.to_string()));
    let help_expr = match &cfg.help {
        Some(h) => quote! { ::std::option::Option::Some(#h.to_string()) },
        None => quote! { ::std::option::Option::None },
    };
    let ty_expr = field_type_expr(ty, &cfg)?;

    Ok(FieldCode {
        default_init: quote! {
            #ident: #default,
        },
        schema_field: quote! {
            ::configurable::ConfigField {
                key: #key.to_string(),
                label: #label.to_string(),
                help: #help_expr,
                ty: #ty_expr,
                default: ::serde_json::json!(#default),
                current: ::serde_json::to_value(&__current.#ident)
                    .unwrap_or_else(|_| ::serde_json::json!(#default)),
            },
        },
        set_field_arm: quote! {
            #key => {
                let __typed: #ty = ::serde_json::from_value(value.clone())
                    .map_err(|e| ::anyhow::anyhow!(
                        "Configurable {}: invalid value for `{}`: {}",
                        #name_str, #key, e,
                    ))?;
                __state.#ident = __typed;
                ::std::result::Result::Ok(())
            }
        },
    })
}
