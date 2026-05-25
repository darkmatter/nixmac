//! `#[derive(Configurable)]` generates an inherent `Foo::load(app)` method that
//! reads each field from `tauri-plugin-store`, falling back to the per-field
//! default when no stored value is present.
//!
//! The companion `configurable` crate provides the runtime helper(s) used by the
//! generated code and re-exports this derive for end users.

use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::quote;
use syn::{parse_macro_input, Attribute, Data, DeriveInput, Expr, ExprPath, Fields, LitStr};

/// How the generated `load()` method resolves the store file path:
///   - `Const(s)` — fixed string, baked in at compile time
///   - `Fn(path)` — runtime call to `path(app)?` returning a `String`-ish
enum StorePath {
    Const(String),
    Fn(ExprPath),
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
    let store_path = parse_struct_config(&input.attrs, name)?;

    // Resolve the store path inside the body of `load(app)` so that
    // `store_path_fn` can use `app` and return a per-call value.
    let store_path_binding: TokenStream2 = match &store_path {
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
                #ident: ::configurable::read_field::<R, #ty>(app, __store_path, #key)?
                    .unwrap_or_else(|| #default),
            })
        })
        .collect::<syn::Result<Vec<_>>>()?;

    Ok(quote! {
        impl #name {
            pub fn load<R: ::tauri::Runtime>(
                app: &::tauri::AppHandle<R>,
            ) -> ::std::result::Result<Self, ::anyhow::Error> {
                #store_path_binding
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

fn parse_struct_config(attrs: &[Attribute], name: &syn::Ident) -> syn::Result<StorePath> {
    for attr in attrs {
        if !attr.path().is_ident("config") {
            continue;
        }
        let mut store_path: Option<String> = None;
        let mut store_path_fn: Option<ExprPath> = None;
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
            } else {
                Err(meta.error("unsupported #[config(...)] attribute on struct"))
            }
        })?;
        match (store_path, store_path_fn) {
            (Some(_), Some(_)) => {
                return Err(syn::Error::new_spanned(
                    name,
                    "Configurable: pick either #[config(store_path = \"...\")] or #[config(store_path_fn = ...)], not both",
                ));
            }
            (Some(s), None) => return Ok(StorePath::Const(s)),
            (None, Some(p)) => return Ok(StorePath::Fn(p)),
            (None, None) => continue,
        }
    }
    Err(syn::Error::new_spanned(
        name,
        "Configurable: missing #[config(store_path = \"...\")] or #[config(store_path_fn = path::to::resolver)] on struct",
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
