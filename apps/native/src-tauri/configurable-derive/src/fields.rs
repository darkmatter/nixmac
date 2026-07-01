//! Field validation and field-level token generation.
//!
//! Each setting field contributes snippets to several generated methods. This
//! module turns one `syn::Field` into those reusable snippets so the final
//! method assembly does not need to know about field attributes.

use crate::attrs::{FieldConfig, StoreScope, parse_field_config};
use crate::strings::{humanize, snake_to_camel};
use crate::types::{field_type_expr, json_schema_property_insert, type_last_ident};
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
    json_schema_property: TokenStream2,
    resolve_init: Option<TokenStream2>,
}

pub(crate) struct GeneratedFields {
    pub(crate) default_inits: Vec<TokenStream2>,
    pub(crate) schema_fields: Vec<TokenStream2>,
    pub(crate) json_schema_properties: Vec<TokenStream2>,
    pub(crate) resolve_inits: Vec<TokenStream2>,
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
/// Defaults feed `load`'s fallback; schema entries feed `schema`. Grouping
/// fragments by method keeps `build_scope_methods` simple without reparsing
/// field attributes later.
pub(crate) fn generate_fields(
    fields: &syn::punctuated::Punctuated<syn::Field, syn::token::Comma>,
    scope: StoreScope,
) -> syn::Result<GeneratedFields> {
    let mut default_inits = Vec::new();
    let mut schema_fields = Vec::new();
    let mut json_schema_properties = Vec::new();
    let mut resolve_inits = Vec::new();

    for field in fields {
        let generated = generate_field(field, scope)?;
        default_inits.push(generated.default_init);
        schema_fields.push(generated.schema_field);
        json_schema_properties.push(generated.json_schema_property);
        if let Some(resolve_init) = generated.resolve_init {
            resolve_inits.push(resolve_init);
        }
    }

    Ok(GeneratedFields {
        default_inits,
        schema_fields,
        json_schema_properties,
        resolve_inits,
    })
}

/// Validates one field and emits the snippets needed by the generated methods.
///
/// This is where field attributes become concrete behavior: default values
/// feed fallback loading and type metadata feeds the UI schema. Setting is
/// handled at the struct level by Serde, so no per-field setter code is
/// emitted here.
fn generate_field(field: &syn::Field, scope: StoreScope) -> syn::Result<FieldCode> {
    let ident = field
        .ident
        .as_ref()
        .ok_or_else(|| syn::Error::new_spanned(field, "field must be named"))?;
    let ty = &field.ty;
    let cfg = parse_field_config(&field.attrs, ident)?;

    let ui_key = cfg
        .key
        .clone()
        .unwrap_or_else(|| snake_to_camel(&ident.to_string()));
    let profile_key = profile_json_key(scope, &ui_key, &cfg);
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
    let json_schema_property = json_schema_property_insert(&profile_key, &label, ty, &cfg)?;

    let resolve_init = if let Some(env_var) = &cfg.env_var {
        let env_var_lit = env_var.as_str();
        let profile_key_lit = profile_key.as_str();
        let build_embed = cfg.build_embed;
        let type_name = type_last_ident(ty).unwrap_or_default();
        Some(match type_name.as_str() {
            "bool" => quote! {
                #ident: Self::__resolve_bool(
                    __build_profile.as_ref(),
                    #profile_key_lit,
                    #env_var_lit,
                    #default,
                ),
            },
            "String" => quote! {
                #ident: Self::__resolve_string(
                    __build_profile.as_ref(),
                    #profile_key_lit,
                    #env_var_lit,
                    #build_embed,
                    #default,
                ),
            },
            other => {
                return Err(syn::Error::new_spanned(
                    ty,
                    format!(
                        "Configurable: env_var resolution unsupported for field type `{other}`",
                    ),
                ));
            }
        })
    } else {
        None
    };

    let default_init = match type_last_ident(ty).as_deref() {
        Some("String") => quote! {
            #ident: (#default).to_string(),
        },
        _ => quote! {
            #ident: #default,
        },
    };

    Ok(FieldCode {
        default_init,
        schema_field: quote! {
            ::configurable::ConfigFieldSchema {
                key: #ui_key.to_string(),
                label: #label.to_string(),
                help: #help_expr,
                ty: #ty_expr,
                default: ::serde_json::json!(#default),
            },
        },
        json_schema_property,
        resolve_init,
    })
}

/// Key used in `apps/native/env.*.json` and env JSON Schema. Env-scoped fields prefer
/// their `env_var` name so profile files mirror process environment variables.
fn profile_json_key(scope: StoreScope, ui_key: &str, cfg: &FieldConfig) -> String {
    if matches!(scope, StoreScope::Env) {
        if let Some(env_var) = &cfg.env_var {
            return env_var.clone();
        }
    }
    ui_key.to_string()
}
