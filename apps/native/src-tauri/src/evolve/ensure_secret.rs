use crate::evolve::age::ensure_age_key;
use crate::evolve::edit_nix_file::{
    apply_semantic_edit, nix_builtins_path_meta_value, nix_expr_meta_value,
};
use crate::evolve::file_ops::join_in_dir;
use crate::evolve::sops::{
    edit_secret_blocking, encrypt_in_place, ensure_secret_file, ensure_sops_config,
};
use crate::evolve::types::{FileEditAction, SemanticFileEdit};

use anyhow::{anyhow, Result};
use ignore::gitignore::Gitignore;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureSecretArgs {
    pub name: String,
    pub inject: Option<SecretInject>,
    pub scaffold: Option<SecretScaffold>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretScaffold {
    #[serde(rename = "type")]
    pub scaffold_type: Option<SecretScaffoldType>,
    pub keys: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub enum SecretScaffoldType {
    #[serde(rename = "raw", alias = "raw_yaml", alias = "raw-yaml")]
    Raw,
    #[serde(rename = "envFile", alias = "env_file", alias = "env-file")]
    EnvFile,
    #[serde(rename = "yamlMap", alias = "yaml_map", alias = "yaml-map")]
    YamlMap,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretInject {
    #[serde(rename = "type")]
    pub inject_type: SecretInjectType,
    pub file: String,
    pub target: String,
}

#[derive(Debug, Deserialize)]
pub enum SecretInjectType {
    #[serde(rename = "nixEnv", alias = "nix_env", alias = "nix-env")]
    NixEnv,
    #[serde(rename = "nixFile", alias = "nix_file", alias = "nix-file")]
    NixFile,
    #[serde(
        rename = "serviceBinding",
        alias = "service_binding",
        alias = "service-binding"
    )]
    ServiceBinding,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureSecretResult {
    pub name: String,
    pub path: String,
    pub runtime_path: String,
    pub status: String,
}

/// Main entry point for `ensure_secret` tool.
/// This ensures we have an age key, SOPS config, and encrypted secret file in place, then opens a blocking SOPS edit session for the user to input the secret value.
/// If `inject` config is provided, will also handle injecting the secret reference into the target file/attribute as specified by `inject.target`.
/// Hopefully by bundling these things together we can make the most common case more reliable as well as save
/// agent turns/tokens.
pub fn execute_ensure_secret(
    base: &Path,
    args: &serde_json::Value,
    gitignore_matcher: Option<&Gitignore>,
) -> Result<EnsureSecretResult> {
    let parsed: EnsureSecretArgs = serde_json::from_value(args.clone()).map_err(|error| {
        anyhow!(
            "ensure_secret: invalid arguments. Expected {{ name, inject?: {{ type, file, target }}, scaffold?: {{ type?, keys? }} }} where inject.type is one of nixEnv|nix_env|nix-env|nixFile|nix_file|nix-file|serviceBinding|service_binding|service-binding and scaffold.type is one of raw|envFile|env_file|env-file|yamlMap|yaml_map|yaml-map. {}",
            error
        )
    })?;

    validate_secret_name(&parsed.name)?;

    let age = ensure_age_key()?;
    let _ = ensure_sops_config(base, &age.public_key)?;

    let secret_path = format!("secrets/{}.yaml", parsed.name);
    let initial_content = render_initial_secret_content(parsed.scaffold.as_ref());
    let _ = ensure_secret_file(base, &secret_path, Some(&initial_content))?;

    // Handle a possible sops error message.
    if let Err(error) = encrypt_in_place(base, &secret_path, &age.key_path) {
        let message = error.to_string();
        let already_encrypted = message.contains("already being encrypted")
            || message.contains("already contain such an entry called 'sops'");

        if !already_encrypted {
            return Err(error);
        }
    }

    // Blocking step: SOPS owns local decrypt/edit/re-encrypt lifecycle.
    edit_secret_blocking(base, &secret_path, &age.key_path)?;

    if let Some(inject) = parsed.inject {
        inject_secret(base, &parsed.name, &secret_path, &inject, gitignore_matcher)?;
    }

    let runtime_path = runtime_secret_path(&parsed.name);

    Ok(EnsureSecretResult {
        name: parsed.name,
        path: secret_path,
        runtime_path,
        status: "ready".to_string(),
    })
}

fn validate_secret_name(name: &str) -> Result<()> {
    if name.is_empty() {
        return Err(anyhow!("ensure_secret: name must not be empty"));
    }

    let valid = name
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'));

    if !valid {
        return Err(anyhow!(
            "ensure_secret: invalid name '{}'. Allowed characters: A-Z a-z 0-9 - _ .",
            name
        ));
    }

    Ok(())
}

/// Handle injecting the secret reference into the target file/attribute as specified by inject.target.
/// Leverages the existing semantic edit machinery from `edit_nix_file` to ensure edits are applied in a consistent way.
fn inject_secret(
    base: &Path,
    name: &str,
    secret_path: &str,
    inject: &SecretInject,
    gitignore_matcher: Option<&Gitignore>,
) -> Result<()> {
    if inject.file.trim().is_empty() {
        return Err(anyhow!(
            "ensure_secret: inject.file must not be empty when inject is provided"
        ));
    }

    if inject.target.trim().is_empty() {
        return Err(anyhow!(
            "ensure_secret: inject.target must not be empty when inject is provided"
        ));
    }

    let runtime_path = runtime_secret_path(name);
    let (target_file, target_attr) = resolve_target_file_and_attr(base, inject)?;

    let sops_file_path = secret_path_relative_to_target_file(base, &target_file, secret_path)?;

    let mut attrs = serde_json::Map::new();
    attrs.insert(
        "sopsFile".to_string(),
        nix_builtins_path_meta_value(&sops_file_path),
    );
    attrs.insert(
        "path".to_string(),
        serde_json::Value::String(runtime_path.clone()),
    );

    let quoted_name = format!("\"{}\"", name);
    let secret_attr_path = format!("sops.secrets.{}", quoted_name);

    apply_semantic_edit(
        base,
        &SemanticFileEdit {
            path: target_file.clone(),
            action: FileEditAction::SetAttrs {
                path: secret_attr_path,
                attrs,
            },
        },
        gitignore_matcher,
    )?;

    // Normalize user/model-provided targets into a safe consumer binding location.
    // This keeps secret declarations under `sops.secrets.*` and prevents accidental clobbering.
    // We are imposing our opinion here because the agent struggles to make the correct edit on
    // its own and this is a common enough operation that it's worth optimizing for.
    let binding_attr = normalize_binding_target(name, &inject.inject_type, &target_attr);

    apply_semantic_edit(
        base,
        &SemanticFileEdit {
            path: target_file,
            action: FileEditAction::Set {
                path: binding_attr,
                value: nix_expr_meta_value(&format!("config.sops.secrets.\"{}\".path", name)),
            },
        },
        gitignore_matcher,
    )?;

    Ok(())
}

fn resolve_target_file_and_attr(base: &Path, inject: &SecretInject) -> Result<(String, String)> {
    let file = inject.file.trim();
    let attr = inject.target.trim();

    // Explicit by design: caller provides both file and attr path separately.
    // This avoids magic string parsing and matches other explicit edit tools.
    let resolved = join_in_dir(base, file)?;
    if !resolved.exists() {
        return Err(anyhow!(
            "ensure_secret: target file '{}' does not exist",
            file
        ));
    }

    Ok((file.to_string(), attr.to_string()))
}

fn runtime_secret_path(name: &str) -> String {
    format!("/run/secrets/{}", name)
}

/// Resolve the final attribute path where we bind the runtime secret path.
///
/// Rules:
/// - If target points to `sops.secrets.*`, rewrite to a safe env-var fallback.
/// - For `nixEnv`, allow shorthand like `MY_SECRET_FILE` and expand to
///   `environment.variables.MY_SECRET_FILE`.
/// - Otherwise, preserve the explicit target path.
fn normalize_binding_target(
    name: &str,
    inject_type: &SecretInjectType,
    target_attr: &str,
) -> String {
    let trimmed = target_attr.trim();
    if is_sops_secret_path(trimmed) {
        return fallback_binding_target(name);
    }

    match inject_type {
        SecretInjectType::NixEnv if !trimmed.contains('.') => {
            format!("environment.variables.{}", trimmed)
        }
        SecretInjectType::NixEnv | SecretInjectType::NixFile | SecretInjectType::ServiceBinding => {
            trimmed.to_string()
        }
    }
}

/// Returns true when caller tries to bind under secret declaration namespace.
/// We treat this as a likely model mistake and route to fallback target instead.
fn is_sops_secret_path(target_attr: &str) -> bool {
    let normalized: String = target_attr
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect();
    normalized.starts_with("sops.secrets.")
}

/// Build a deterministic env var binding target from the secret name.
/// Example: `myapp-env` -> `environment.variables.MYAPP_ENV_FILE`.
fn fallback_binding_target(name: &str) -> String {
    let mut env_name = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            env_name.push(ch.to_ascii_uppercase());
        } else {
            env_name.push('_');
        }
    }

    while env_name.contains("__") {
        env_name = env_name.replace("__", "_");
    }

    let env_name = env_name.trim_matches('_');
    format!("environment.variables.{}_FILE", env_name)
}

fn secret_path_relative_to_target_file(
    base: &Path,
    target_file: &str,
    secret_path: &str,
) -> Result<String> {
    let target_abs = join_in_dir(base, target_file)?;
    let target_dir = target_abs.parent().ok_or_else(|| {
        anyhow!(
            "ensure_secret: cannot resolve parent directory for target file '{}'",
            target_file
        )
    })?;
    let secret_abs = join_in_dir(base, secret_path)?;

    let from = target_dir.strip_prefix(base).map_err(|_| {
        anyhow!(
            "ensure_secret: target file '{}' resolved outside config root",
            target_file
        )
    })?;
    let to = secret_abs.strip_prefix(base).map_err(|_| {
        anyhow!(
            "ensure_secret: secret path '{}' resolved outside config root",
            secret_path
        )
    })?;

    let relative = relative_path(from, to);
    let rendered = relative.to_string_lossy().replace('\\', "/");

    if rendered.starts_with("../") || rendered.starts_with("./") {
        Ok(rendered)
    } else {
        Ok(format!("./{}", rendered))
    }
}

fn relative_path(from: &Path, to: &Path) -> PathBuf {
    let from_components: Vec<Component<'_>> = from.components().collect();
    let to_components: Vec<Component<'_>> = to.components().collect();

    let mut common_len = 0usize;
    while common_len < from_components.len()
        && common_len < to_components.len()
        && from_components[common_len] == to_components[common_len]
    {
        common_len += 1;
    }

    let mut relative = PathBuf::new();

    for _ in common_len..from_components.len() {
        relative.push("..");
    }

    for component in &to_components[common_len..] {
        relative.push(component.as_os_str());
    }

    if relative.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        relative
    }
}

fn render_initial_secret_content(scaffold: Option<&SecretScaffold>) -> String {
    let default = || "value: \"\"\n".to_string();
    let Some(scaffold) = scaffold else {
        return default();
    };

    let keys: Vec<String> = scaffold
        .keys
        .as_ref()
        .map(|values| {
            values
                .iter()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if keys.is_empty() {
        return default();
    }

    match scaffold.scaffold_type {
        Some(SecretScaffoldType::EnvFile) => {
            let mut rendered = String::from("value: |\n");
            for key in keys {
                rendered.push_str(&format!("  {}=\n", key));
            }
            rendered
        }
        Some(SecretScaffoldType::YamlMap) | Some(SecretScaffoldType::Raw) | None => {
            let mut rendered = String::new();
            for key in keys {
                rendered.push_str(&format!("{}: \"\"\n", key));
            }
            rendered
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        execute_ensure_secret, fallback_binding_target, is_sops_secret_path,
        normalize_binding_target, secret_path_relative_to_target_file,
    };
    use crate::evolve::edit_nix_file::{builtins_path_expression, nix_expr_meta_value};
    use serde_json::json;
    use std::process::Command;

    fn command_exists(name: &str) -> bool {
        Command::new("which")
            .arg(name)
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    #[test]
    #[ignore = "Manual interactive test: launches `sops` editor"]
    fn execute_ensure_secret_full_flow_interactive() {
        if !command_exists("age-keygen") {
            eprintln!("Skipping test: age-keygen is not installed");
            return;
        }

        if !command_exists("sops") {
            eprintln!("Skipping test: sops is not installed");
            return;
        }

        let temp = tempfile::tempdir().expect("create temp directory");
        let base = temp.path().join("config");
        std::fs::create_dir_all(&base).expect("create base config dir");

        // Isolate age key creation from the developer machine's real HOME.
        let fake_home = temp.path().join("home");
        std::fs::create_dir_all(&fake_home).expect("create fake HOME");

        let original_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &fake_home);

        // Point sops at the explicit key path for deterministic test behavior.
        let age_key_file = fake_home.join(".config/sops/age/keys.txt");
        let original_sops_age_key_file = std::env::var_os("SOPS_AGE_KEY_FILE");
        std::env::set_var("SOPS_AGE_KEY_FILE", &age_key_file);

        let secret_name = "manual-interactive-secret";
        let args = json!({
            "name": secret_name,
        });

        let result = execute_ensure_secret(&base, &args, None)
            .expect("execute_ensure_secret should succeed after interactive edit is completed");

        if let Some(previous_home) = original_home {
            std::env::set_var("HOME", previous_home);
        } else {
            std::env::remove_var("HOME");
        }

        if let Some(previous_sops_age_key_file) = original_sops_age_key_file {
            std::env::set_var("SOPS_AGE_KEY_FILE", previous_sops_age_key_file);
        } else {
            std::env::remove_var("SOPS_AGE_KEY_FILE");
        }

        assert_eq!(result.name, secret_name);
        assert_eq!(result.path, format!("secrets/{}.yaml", secret_name));
        assert_eq!(result.runtime_path, format!("/run/secrets/{}", secret_name));
        assert_eq!(result.status, "ready");

        let sops_config = base.join(".sops.yaml");
        assert!(sops_config.exists(), "expected .sops.yaml to be created");

        let encrypted_secret = base.join(format!("secrets/{}.yaml", secret_name));
        assert!(
            encrypted_secret.exists(),
            "expected encrypted secret file to exist"
        );

        let secret_content =
            std::fs::read_to_string(&encrypted_secret).expect("read encrypted secret file");
        assert!(
            secret_content.contains("sops:"),
            "expected secret file to remain encrypted and contain sops metadata"
        );

        println!("\n===== ensure_secret debug =====");
        println!("base dir: {}", base.display());
        println!("fake HOME: {}", fake_home.display());
        println!("age key file: {}", age_key_file.display());

        let public_key_output = Command::new("age-keygen")
            .arg("-y")
            .arg(&age_key_file)
            .output()
            .expect("derive age public key from generated private key");
        assert!(
            public_key_output.status.success(),
            "age-keygen -y failed while deriving debug public key"
        );
        let public_key = String::from_utf8_lossy(&public_key_output.stdout)
            .trim()
            .to_string();
        println!("public key: {}", public_key);

        let sops_config_content =
            std::fs::read_to_string(&sops_config).expect("read generated .sops.yaml");
        println!("\n--- .sops.yaml ---\n{}", sops_config_content);

        println!(
            "\n--- encrypted secret ({}) ---\n{}",
            encrypted_secret.display(),
            secret_content
        );

        let decrypted_output = Command::new("sops")
            .arg("--decrypt")
            .arg(&encrypted_secret)
            .env("SOPS_AGE_KEY_FILE", &age_key_file)
            .output()
            .expect("run sops --decrypt for debug output");
        assert!(
            decrypted_output.status.success(),
            "sops --decrypt failed for debug output: {}",
            String::from_utf8_lossy(&decrypted_output.stderr).trim()
        );
        let decrypted_content = String::from_utf8_lossy(&decrypted_output.stdout).to_string();
        println!("\n--- decrypted secret ---\n{}", decrypted_content);
        println!("===== end ensure_secret debug =====\n");
    }

    #[test]
    fn deserialize_args_accepts_snake_case_inject_type() {
        let args = json!({
            "name": "github-token",
            "inject": {
                "type": "nix_env",
                "file": "modules/darwin/environment.nix",
                "target": "environment.variables.GITHUB_TOKEN_FILE"
            }
        });

        let parsed: super::EnsureSecretArgs =
            serde_json::from_value(args).expect("deserialize ensure_secret args");

        assert_eq!(parsed.name, "github-token");
        let inject = parsed.inject.expect("inject should be present");
        assert_eq!(inject.file, "modules/darwin/environment.nix");
        assert_eq!(inject.target, "environment.variables.GITHUB_TOKEN_FILE");
        assert!(matches!(
            inject.inject_type,
            super::SecretInjectType::NixEnv
        ));
    }

    #[test]
    fn render_initial_secret_content_renders_env_file_scaffold() {
        let scaffold = super::SecretScaffold {
            scaffold_type: Some(super::SecretScaffoldType::EnvFile),
            keys: Some(vec![
                "DATABASE_URL".to_string(),
                "REDIS_URL".to_string(),
                "JWT_SECRET".to_string(),
            ]),
        };

        let rendered = super::render_initial_secret_content(Some(&scaffold));
        assert_eq!(
            rendered,
            "value: |\n  DATABASE_URL=\n  REDIS_URL=\n  JWT_SECRET=\n"
        );
    }

    #[test]
    fn render_initial_secret_content_renders_yaml_map_scaffold() {
        let scaffold = super::SecretScaffold {
            scaffold_type: Some(super::SecretScaffoldType::YamlMap),
            keys: Some(vec!["DATABASE_URL".to_string(), "REDIS_URL".to_string()]),
        };

        let rendered = super::render_initial_secret_content(Some(&scaffold));
        assert_eq!(rendered, "DATABASE_URL: \"\"\nREDIS_URL: \"\"\n");
    }

    #[test]
    fn deserialize_args_ignores_scaffold_content_field() {
        let args = json!({
            "name": "db-creds",
            "scaffold": {
                "type": "yaml_map",
                "keys": ["DATABASE_URL"],
                "content": "DATABASE_URL: \"should-not-be-used\""
            }
        });

        let parsed: super::EnsureSecretArgs =
            serde_json::from_value(args).expect("deserialize ensure_secret args");

        let rendered = super::render_initial_secret_content(parsed.scaffold.as_ref());
        assert_eq!(rendered, "DATABASE_URL: \"\"\n");
    }

    #[test]
    fn secret_path_relative_to_target_file_uses_module_relative_path() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let base = temp.path();

        std::fs::create_dir_all(base.join("modules/darwin")).expect("create modules dir");
        std::fs::create_dir_all(base.join("secrets")).expect("create secrets dir");
        std::fs::write(base.join("modules/darwin/sops-secrets.nix"), "{}")
            .expect("write target file");
        std::fs::write(base.join("secrets/ssh-private-key.yaml"), "value: \"\"\n")
            .expect("write secret file");

        let rendered = secret_path_relative_to_target_file(
            base,
            "modules/darwin/sops-secrets.nix",
            "secrets/ssh-private-key.yaml",
        )
        .expect("render relative secret path");

        assert_eq!(rendered, "../../secrets/ssh-private-key.yaml");
    }

    #[test]
    fn sops_file_expression_emits_builtins_path() {
        let value = builtins_path_expression("../../secrets/github-token.yaml");
        assert_eq!(
            value,
            "builtins.path { path = ../../secrets/github-token.yaml; }"
        );
    }

    #[test]
    fn nix_expr_meta_value_emits_expected_shape() {
        let value = nix_expr_meta_value("config.sops.secrets.\"myapp-env\".path");
        assert_eq!(
            value,
            json!({ "__nixExpr": "config.sops.secrets.\"myapp-env\".path" })
        );
    }

    #[test]
    fn detects_sops_secret_target_for_binding() {
        assert!(is_sops_secret_path("sops.secrets.\"myapp-env\""));
    }

    #[test]
    fn fallback_binding_target_uses_secret_name() {
        assert_eq!(
            fallback_binding_target("myapp-env"),
            "environment.variables.MYAPP_ENV_FILE"
        );
    }

    #[test]
    fn normalize_binding_target_uses_fallback_for_sops_secret_paths() {
        let normalized = normalize_binding_target(
            "myapp-env",
            &super::SecretInjectType::NixFile,
            "sops.secrets.myapp-env",
        );
        assert_eq!(normalized, "environment.variables.MYAPP_ENV_FILE");
    }

    #[test]
    fn normalize_binding_target_keeps_explicit_env_path() {
        let normalized = normalize_binding_target(
            "myapp-env",
            &super::SecretInjectType::NixEnv,
            "environment.variables.MYAPP_ENV_FILE",
        );
        assert_eq!(normalized, "environment.variables.MYAPP_ENV_FILE");
    }
}
