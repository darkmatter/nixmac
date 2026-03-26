#![allow(dead_code)] // since we don't necessarily use all templating capabilities yet
//! Tera-based templating system for Nix configuration files.
//!
//! This module provides a flexible templating system that can process
//! Nix configuration files with variable substitution and conditional logic.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tera::{Context, Tera};

/// Template engine wrapper for Nix configuration files.
pub struct TemplateEngine {
    tera: Tera,
}

impl TemplateEngine {
    /// Creates a new template engine instance.
    pub fn new() -> Self {
        Self {
            tera: Tera::default(),
        }
    }

    /// Creates a template engine that loads templates from a directory.
    ///
    /// The glob pattern should match template files, e.g., "templates/**/*.nix"
    pub fn from_directory(glob_pattern: &str) -> Result<Self, TemplateError> {
        let tera = Tera::new(glob_pattern).map_err(TemplateError::Parse)?;
        Ok(Self { tera })
    }

    /// Renders a template string with the given context.
    pub fn render_string(
        &mut self,
        template: &str,
        context: &TemplateContext,
    ) -> Result<String, TemplateError> {
        self.tera
            .render_str(template, &context.to_tera_context())
            .map_err(TemplateError::Render)
    }

    /// Renders a named template (loaded from directory) with the given context.
    pub fn render(
        &self,
        template_name: &str,
        context: &TemplateContext,
    ) -> Result<String, TemplateError> {
        self.tera
            .render(template_name, &context.to_tera_context())
            .map_err(TemplateError::Render)
    }

    /// Adds a template from a string.
    pub fn add_template(&mut self, name: &str, content: &str) -> Result<(), TemplateError> {
        self.tera
            .add_raw_template(name, content)
            .map_err(TemplateError::Parse)
    }
}

impl Default for TemplateEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Context for template rendering containing variables and their values.
#[derive(Debug, Clone, Default)]
pub struct TemplateContext {
    values: HashMap<String, ContextValue>,
}

/// A value that can be inserted into a template context.
#[derive(Debug, Clone)]
pub enum ContextValue {
    String(String),
    Bool(bool),
    Int(i64),
    Float(f64),
    List(Vec<ContextValue>),
    Map(HashMap<String, ContextValue>),
}

impl TemplateContext {
    /// Creates a new empty template context.
    pub fn new() -> Self {
        Self {
            values: HashMap::new(),
        }
    }

    /// Inserts a string value into the context.
    pub fn insert_str(&mut self, key: impl Into<String>, value: impl Into<String>) -> &mut Self {
        self.values
            .insert(key.into(), ContextValue::String(value.into()));
        self
    }

    /// Inserts a boolean value into the context.
    pub fn insert_bool(&mut self, key: impl Into<String>, value: bool) -> &mut Self {
        self.values.insert(key.into(), ContextValue::Bool(value));
        self
    }

    /// Inserts an integer value into the context.
    pub fn insert_int(&mut self, key: impl Into<String>, value: i64) -> &mut Self {
        self.values.insert(key.into(), ContextValue::Int(value));
        self
    }

    /// Inserts a float value into the context.
    pub fn insert_float(&mut self, key: impl Into<String>, value: f64) -> &mut Self {
        self.values.insert(key.into(), ContextValue::Float(value));
        self
    }

    /// Inserts a list of strings into the context.
    pub fn insert_string_list(&mut self, key: impl Into<String>, values: Vec<String>) -> &mut Self {
        let list = values.into_iter().map(ContextValue::String).collect();
        self.values.insert(key.into(), ContextValue::List(list));
        self
    }

    /// Converts this context to a Tera context.
    fn to_tera_context(&self) -> Context {
        let mut ctx = Context::new();
        for (key, value) in &self.values {
            self.insert_value_into_context(&mut ctx, key, value);
        }
        ctx
    }

    fn insert_value_into_context(&self, ctx: &mut Context, key: &str, value: &ContextValue) {
        fn context_value_to_json(value: &ContextValue) -> serde_json::Value {
            match value {
                ContextValue::String(s) => serde_json::Value::String(s.clone()),
                ContextValue::Bool(b) => serde_json::Value::Bool(*b),
                ContextValue::Int(i) => serde_json::Value::Number((*i).into()),
                ContextValue::Float(f) => serde_json::Number::from_f64(*f)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null),
                ContextValue::List(list) => {
                    serde_json::Value::Array(list.iter().map(context_value_to_json).collect())
                }
                ContextValue::Map(map) => {
                    let obj: serde_json::Map<_, _> = map
                        .iter()
                        .map(|(k, v)| (k.clone(), context_value_to_json(v)))
                        .collect();
                    serde_json::Value::Object(obj)
                }
            }
        }

        match value {
            ContextValue::String(s) => ctx.insert(key, s),
            ContextValue::Bool(b) => ctx.insert(key, b),
            ContextValue::Int(i) => ctx.insert(key, i),
            ContextValue::Float(f) => ctx.insert(key, f),
            ContextValue::List(list) => {
                let values: Vec<_> = list.iter().map(context_value_to_json).collect();
                ctx.insert(key, &values);
            }
            ContextValue::Map(map) => {
                let values: HashMap<_, _> = map
                    .iter()
                    .map(|(k, v)| (k.clone(), context_value_to_json(v)))
                    .collect();
                ctx.insert(key, &values);
            }
        }
    }
}

/// Errors that can occur during template operations.
#[derive(Debug, thiserror::Error)]
pub enum TemplateError {
    /// Error parsing a template
    #[error("Template parse error: {0}")]
    Parse(#[source] tera::Error),
    /// Error rendering a template
    #[error("Template render error: {0}")]
    Render(#[source] tera::Error),
    /// Error reading a template file
    #[error("Template I/O error: {0}")]
    Io(#[from] std::io::Error),
}

/// Renders a template file and writes the result to the output path.
pub fn render_file(
    template_path: &Path,
    output_path: &Path,
    context: &TemplateContext,
) -> Result<(), TemplateError> {
    let template_content = fs::read_to_string(template_path).map_err(TemplateError::Io)?;
    let mut engine = TemplateEngine::new();
    let rendered = engine.render_string(&template_content, context)?;
    fs::write(output_path, rendered).map_err(TemplateError::Io)?;
    Ok(())
}

/// Renders a template string directly.
pub fn render_string(template: &str, context: &TemplateContext) -> Result<String, TemplateError> {
    let mut engine = TemplateEngine::new();
    engine.render_string(template, context)
}

/// Processes all template files in a directory, rendering them with the given context.
///
/// Template files are expected to have a `.tera` extension which will be removed
/// in the output filename.
pub fn render_directory(
    template_dir: &Path,
    output_dir: &Path,
    context: &TemplateContext,
) -> Result<(), TemplateError> {
    let mut engine = TemplateEngine::new();

    for entry in fs::read_dir(template_dir).map_err(TemplateError::Io)? {
        let entry = entry.map_err(TemplateError::Io)?;
        let path = entry.path();

        if path.is_file() {
            let filename = path
                .file_name()
                .ok_or_else(|| TemplateError::Io(std::io::Error::other("Invalid file name")))?
                .to_string_lossy()
                .to_string();

            // Check if it's a template file
            let output_filename = if filename.ends_with(".tera") {
                filename.trim_end_matches(".tera").to_string()
            } else {
                filename.to_string()
            };

            let template_content = fs::read_to_string(&path).map_err(TemplateError::Io)?;
            let rendered = engine.render_string(&template_content, context)?;

            let output_path = output_dir.join(output_filename);
            fs::write(output_path, rendered).map_err(TemplateError::Io)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_string_substitution() {
        let template = "hostname = \"{{ hostname }}\";";
        let mut context = TemplateContext::new();
        context.insert_str("hostname", "my-macbook");

        let result = render_string(template, &context).unwrap();
        assert_eq!(result, "hostname = \"my-macbook\";");
    }

    #[test]
    fn test_conditional_rendering() {
        let template = r#"{% if enable_homebrew %}homebrew.enable = true;{% endif %}"#;

        let mut context = TemplateContext::new();
        context.insert_bool("enable_homebrew", true);
        let result = render_string(template, &context).unwrap();
        assert_eq!(result, "homebrew.enable = true;");

        let mut context = TemplateContext::new();
        context.insert_bool("enable_homebrew", false);
        let result = render_string(template, &context).unwrap();
        assert_eq!(result, "");
    }

    #[test]
    fn test_list_iteration() {
        let template = r#"packages = [{% for pkg in packages %}
  "{{ pkg }}"{% endfor %}
];"#;

        let mut context = TemplateContext::new();
        context.insert_string_list("packages", vec!["git".into(), "vim".into(), "curl".into()]);

        let result = render_string(template, &context).unwrap();
        assert!(result.contains("\"git\""));
        assert!(result.contains("\"vim\""));
        assert!(result.contains("\"curl\""));
    }

    #[test]
    fn test_nix_flake_template() {
        let template = r#"{
  description = "{{ description }}";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    darwin.url = "github:LnL7/nix-darwin/master";
  };

  outputs = { self, nixpkgs, darwin }: {
    darwinConfigurations."{{ hostname }}" = darwin.lib.darwinSystem {
      system = "{{ platform }}";
      modules = [ ./configuration.nix ];
    };
  };
}"#;

        let mut context = TemplateContext::new();
        context
            .insert_str("description", "My nix-darwin configuration")
            .insert_str("hostname", "macbook-pro")
            .insert_str("platform", "aarch64-darwin");

        let result = render_string(template, &context).unwrap();
        assert!(result.contains("\"My nix-darwin configuration\""));
        assert!(result.contains("darwinConfigurations.\"macbook-pro\""));
        assert!(result.contains("system = \"aarch64-darwin\""));
    }
}
