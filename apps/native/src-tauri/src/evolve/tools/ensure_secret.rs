//! `ensure_secret` tool: create/wire a SOPS-managed secret end-to-end.

use anyhow::Result;

use crate::evolve::ensure_secret::execute_ensure_secret;
use crate::evolve::messages::Tool;

use super::{ToolCtx, ToolResult, ensure_nixmac_edit_allowed};

pub(crate) fn definition() -> Tool {
    Tool {
        name: "ensure_secret".to_string(),
        description: "Create and wire a SOPS-managed secret end-to-end without exposing plaintext to the agent. \
                     This tool ensures an age key exists, maintains SOPS config, creates/initializes an encrypted \
                     secret file under secrets/<name>.yaml, launches a blocking `sops <file>` editor session for \
                     user input, then optionally injects secret path wiring into Nix config. \
                     You can optionally provide a `scaffold` to prefill non-sensitive placeholder structure \
                     (for example env-file keys or YAML map keys) before the editor opens. \
                     IMPORTANT: Injection targets under .nixmac are rejected; agents may only edit exact .nixmac/<module>/data.json files via edit_file.".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Secret name used for both secrets/<name>.yaml and /run/secrets/<name>"
                },
                "inject": {
                    "type": "object",
                    "description": "Optional Nix injection mapping with explicit file path and attribute path.",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["nix_env", "nix_file", "service_binding"]
                        },
                        "file": {
                            "type": "string",
                            "description": "Relative path to the nix file to edit. Example: modules/darwin/services.nix"
                        },
                        "target": {
                            "type": "string",
                            "description": "Dot-separated target attribute path in the selected file. Example: services.github.tokenFile"
                        }
                    },
                    "required": ["type", "file", "target"],
                    "additionalProperties": false
                },
                "scaffold": {
                    "type": "object",
                    "description": "Optional skeleton for first-time secret file initialization. If the file already exists, it is left unchanged.",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["raw", "raw_yaml", "raw-yaml", "envFile", "env_file", "env-file", "yamlMap", "yaml_map", "yaml-map"],
                            "description": "Skeleton strategy. `env_file` renders value: | with KEY= lines. `yaml_map` renders KEY: \"\" entries. `raw` creates an empty placeholder."
                        },
                        "keys": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Optional key names used by env_file/yaml_map scaffold types"
                        }
                    },
                    "additionalProperties": false
                }
            },
            "required": ["name"],
            "additionalProperties": false
        }),
    }
}

pub(crate) fn execute(ctx: &ToolCtx) -> Result<ToolResult> {
    // Only Nix injection targets need the .nixmac guard; secret files are written under secrets/.
    if let Some(inject_file) = ctx
        .args
        .get("inject")
        .and_then(|inject| inject.get("file"))
        .and_then(|file| file.as_str())
    {
        ensure_nixmac_edit_allowed("ensure_secret", inject_file)?;
    }

    let result = execute_ensure_secret(
        ctx.repo_root,
        ctx.args,
        ctx.auto_format,
        ctx.gitignore_matcher,
    )?;
    Ok(ToolResult::EnsureSecret(result))
}
