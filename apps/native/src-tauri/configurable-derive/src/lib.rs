//! `#[derive(Configurable)]` — generates `Foo::load(app)` that reads each field
//! from `tauri-plugin-store` (falling back to the per-field default).
//!
//! See the `configurable` crate for the user-facing trait and runtime helpers.

use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::quote;
use syn::{parse_macro_input, Attribute, Data, DeriveInput, Expr, Fields, LitStr};

#[proc_macro_derive(Configurable, attributes(config))]
pub fn derive_configurable(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

fn expand(input: DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;
    let store_path = parse_struct_config(&input.attrs, name)?;

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

    let field_loads: Vec<TokenStream2> = fields
        .iter()
        .map(|field| {
            let ident = field.ident.as_ref().expect("named field has an ident");
            let ty = &field.ty;
            let cfg = parse_field_config(&field.attrs, ident)?;
            let key = cfg
                .key
                .unwrap_or_else(|| snake_to_camel(&ident.to_string()));
            let default = cfg.default.ok_or_else(|| {
                syn::Error::new_spanned(field, "field requires #[config(default = ...)]")
            })?;
            Ok(quote! {
                #ident: ::configurable::read_field::<R, #ty>(app, #store_path, #key)?
                    .unwrap_or_else(|| #default),
            })
        })
        .collect::<syn::Result<Vec<_>>>()?;

    Ok(quote! {
        impl #name {
            pub fn load<R: ::tauri::Runtime>(
                app: &::tauri::AppHandle<R>,
            ) -> ::std::result::Result<Self, ::anyhow::Error> {
                ::std::result::Result::Ok(Self {
                    #(#field_loads)*
                })
            }
        }
    })
}

struct FieldConfig {
    default: Option<Expr>,
    key: Option<String>,
}

fn parse_struct_config(attrs: &[Attribute], name: &syn::Ident) -> syn::Result<String> {
    for attr in attrs {
        if !attr.path().is_ident("config") {
            continue;
        }
        let mut store_path: Option<String> = None;
        attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("store_path") {
                let value = meta.value()?;
                let lit: LitStr = value.parse()?;
                store_path = Some(lit.value());
                Ok(())
            } else {
                Err(meta.error("unsupported #[config(...)] attribute on struct"))
            }
        })?;
        if let Some(s) = store_path {
            return Ok(s);
        }
    }
    Err(syn::Error::new_spanned(
        name,
        "missing #[config(store_path = \"...\")] on struct",
    ))
}

fn parse_field_config(attrs: &[Attribute], ident: &syn::Ident) -> syn::Result<FieldConfig> {
    let mut default: Option<Expr> = None;
    let mut key: Option<String> = None;
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
            } else {
                Err(meta.error(format!(
                    "unsupported #[config(...)] attribute on field `{}`",
                    ident
                )))
            }
        })?;
    }
    Ok(FieldConfig { default, key })
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
