//! `edit_nix_file` tool: semantic Add/Remove/Set/SetAttrs edits to Nix files.

use anyhow::{anyhow, Context, Result};

use crate::evolve::edit_nix_file::{apply_semantic_edit, infer_single_list_attrpath};
use crate::evolve::file_ops::resolve_existing_path_in_dir;
use crate::evolve::gitignore::is_ignored_by_matcher;
use crate::evolve::messages::Tool;
use crate::evolve::types::{FileEditAction, SemanticFileEdit};
use crate::evolve::utils::normalize_relative_path;

use std::path::Path;

use super::{ensure_nixmac_edit_allowed, quote_homebrew_list_values, ToolCtx, ToolResult};

pub(crate) fn definition() -> Tool {
    Tool {
        name: "edit_nix_file".to_string(),
        description: r#"Edit a Nix file with semantic operations using attribute-path Add/Remove/Set/SetAttrs actions.
Use this tool whenever you need the agent to make structured edits to Nix config. `add` and `remove` operate on list-valued attributes such as `home.packages` or `environment.systemPackages`. For Homebrew list attributes (`homebrew.brews`, `homebrew.casks`, and `homebrew.taps`), pass raw package/token strings such as `"bat"`; the tool writes them as Nix string literals. `set` assigns a scalar value such as a boolean, string, number, or `null` to an attribute path like `services.tailscale.enable`. `set_attrs` creates or updates a Nix attribute set (object) at a given path and sets key-value pairs inside it, including nested JSON objects/arrays that map to nested Nix attrsets/lists. Use this for options like `system.defaults.dock` that take an attrset value. The tool understands Nix syntax and will modify existing assignments when possible, or insert a new assignment into the module body if missing.
Prefer: provide an `action` object with exactly one of `add`, `remove`, `set`, or `set_attrs`. A shorthand string action such as `"add"` is also accepted with sibling payload fields (for example `values`) and, when possible, the tool infers the only list attribute path in the target file. After calling this tool, run `build_check` to verify changes.
IMPORTANT: Do not use this tool for files under .nixmac. Nix implementation files there are reserved for Nixmac; only exact .nixmac/<module>/data.json files may be edited with edit_file.
IMPORTANT: The generated Nix code is syntax-validated before writing. Edits with syntax errors (unmatched braces/brackets, unclosed strings, etc) will be rejected. Ensure all generated code is syntactically complete and correct."#.to_string(),            parameters: serde_json::json!({
            "type": "object",
            "$defs": {
                "jsonValue": {
                    "oneOf": [
                        { "type": "boolean" },
                        { "type": "string" },
                        { "type": "number" },
                        { "type": "integer" },
                        { "type": "null" },
                        {
                            "type": "array",
                            "items": { "$ref": "#/$defs/jsonValue" }
                        },
                        {
                            "type": "object",
                            "additionalProperties": { "$ref": "#/$defs/jsonValue" }
                        }
                    ]
                }
            },
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path to the nix file to edit"
                },
                "action": {
                    "oneOf": [
                        {
                            "type": "object",
                            "oneOf": [
                                {
                                    "type": "object",
                                    "properties": {
                                        "add": {
                                            "type": "object",
                                            "properties": {
                                                "path": { "type": "string", "description": "Dot-separated attribute path (e.g. environment.systemPackages, home.packages, or homebrew.brews)" },
                                                "values": {
                                                    "type": "array",
                                                    "items": { "type": "string" },
                                                    "description": "Values to add to the list. Use a one-element array for a single package. For homebrew.brews/casks/taps, pass raw package or token names; the tool quotes them as Nix strings."
                                                }
                                            },
                                            "required": ["path", "values"],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": ["add"],
                                    "additionalProperties": false
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "remove": {
                                            "type": "object",
                                            "properties": {
                                                "path": { "type": "string", "description": "Dot-separated attribute path to remove from" },
                                                "values": {
                                                    "type": "array",
                                                    "items": { "type": "string" },
                                                    "description": "Values to remove from the list. Use a one-element array for a single package. For homebrew.brews/casks/taps, pass raw package or token names; the tool matches their Nix string literal form."
                                                }
                                            },
                                            "required": ["path", "values"],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": ["remove"],
                                    "additionalProperties": false
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "set": {
                                            "type": "object",
                                            "properties": {
                                                "path": { "type": "string", "description": "Dot-separated attribute path to set (e.g. services.tailscale.enable)" },
                                                "value": {
                                                    "description": "Scalar JSON value to assign. Supports booleans, strings, numbers, and null.",
                                                    "oneOf": [
                                                        { "type": "boolean" },
                                                        { "type": "string" },
                                                        { "type": "number" },
                                                        { "type": "integer" },
                                                        { "type": "null" }
                                                    ]
                                                }
                                            },
                                            "required": ["path", "value"],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": ["set"],
                                    "additionalProperties": false
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "set_attrs": {
                                            "type": "object",
                                            "properties": {
                                                "path": { "type": "string", "description": "Dot-separated attribute path of the attrset to create or update (e.g. system.defaults.dock)" },
                                                "attrs": {
                                                    "type": "object",
                                                    "description": "Key-value pairs to set inside the attrset. Values may be scalars, arrays, or nested objects.",
                                                    "additionalProperties": {
                                                        "$ref": "#/$defs/jsonValue"
                                                    }
                                                }
                                            },
                                            "required": ["path", "attrs"],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": ["set_attrs"],
                                    "additionalProperties": false
                                }
                            ]
                        },
                        {
                            "type": "string",
                            "enum": ["add", "remove", "set", "set_attrs"],
                            "description": "Shorthand action name. Payload fields such as values/value/attrs may be supplied as siblings; add/remove infer the list path when the target file has exactly one list assignment."
                        }
                    ],
                    "description": "The specific edit action to perform on the nix file (object with one of `add`, `remove`, `set`, or `set_attrs`)",
                }
            },
            "required": ["path", "action"]
        }),
    }
}

/// Determines if the given string presumably from "path" looks like an actual
/// file path or if it looks like an attribute path that was mistakenly put in the
/// file path field, which is a common agent mistake.
/// This is a heuristic check to provide a helpful error message, but it's not a guarantee.
fn looks_like_attr_path(path: &str) -> bool {
    path.contains('.') && !path.contains('/') && !path.ends_with(".nix")
}

fn action_name(value: &serde_json::Value) -> Option<&str> {
    if let Some(name) = value.as_str() {
        return matches!(name, "add" | "remove" | "set" | "set_attrs").then_some(name);
    }

    let obj = value.as_object()?;
    for key in ["add", "remove", "set", "set_attrs"] {
        if obj.contains_key(key) {
            return Some(key);
        }
    }

    None
}

/// Build a compact example call that shows where the file path and action path belong.
fn corrective_action_shape(action: &str, attr_path: &str) -> String {
    let payload = match action {
        "add" | "remove" => format!(r#""path": "{}", "values": [...]"#, attr_path),
        "set" => format!(r#""path": "{}", "value": ..."#, attr_path),
        "set_attrs" => format!(r#""path": "{}", "attrs": {{...}}"#, attr_path),
        _ => format!(r#""path": "{}""#, attr_path),
    };

    format!(
        r#"{{ "path": "modules/darwin/services.nix", "action": {{ "{}": {{ {} }} }} }}"#,
        action, payload
    )
}

/// Explain the common mistake of putting a Nix option path in the top-level file path field.
fn explain_attr_path_used_as_file_path(args: &serde_json::Value, path: &str) -> anyhow::Error {
    let action = action_name(&args["action"]);
    let correction = action
        .map(|name| corrective_action_shape(name, path))
        .unwrap_or_else(|| {
            format!(
                r#"{{ "path": "modules/darwin/services.nix", "action": {{ "set_attrs": {{ "path": "{}", "attrs": {{...}} }} }} }}"#,
                path
            )
        });

    anyhow!(
        "edit_nix_file: top-level 'path' must be the relative .nix file to edit, but got attribute path '{}'. Put '{}' inside the action object as the action path, choose a file path for top-level 'path', and call the tool like: {}",
        path,
        path,
        correction
    )
}

/// Explain the shorthand action shape without executing it, so the agent can retry correctly.
fn explain_string_action(args: &serde_json::Value, action: &str) -> anyhow::Error {
    let payload_fields = match action {
        "add" | "remove" => "path and values",
        "set" => "path and value",
        "set_attrs" => "path and attrs",
        _ => "the required payload fields",
    };
    let likely_attr_path = args["path"]
        .as_str()
        .filter(|path| looks_like_attr_path(path));
    let attr_path = likely_attr_path.unwrap_or("<attribute.path>");
    let correction = corrective_action_shape(action, attr_path);

    anyhow!(
        "edit_nix_file: action must be an object, not string '{}'. Wrap sibling payload fields under action.{} with {}. Top-level 'path' must remain the .nix file path. Correct shape: {}",
        action,
        action,
        payload_fields,
        correction
    )
}

/// Ensure the selected action contains the expected object payload before reading fields from it.
fn ensure_action_payload_is_object<'a>(
    action_val: &'a serde_json::Value,
    action_name: &str,
) -> Result<&'a serde_json::Value> {
    let payload = action_val
        .get(action_name)
        .ok_or_else(|| anyhow!("edit_nix_file.{}: missing action payload", action_name))?;
    if !payload.is_object() {
        return Err(anyhow!(
            "edit_nix_file.{}: action payload must be an object. Correct shape: {{ \"action\": {{ \"{}\": {{ \"path\": \"<attribute.path>\", ... }} }}, \"path\": \"modules/darwin/services.nix\" }}",
            action_name,
            action_name
        ));
    }
    Ok(payload)
}

fn parse_values(value: &serde_json::Value, context: &str) -> Result<Vec<String>> {
    let values = value
        .as_array()
        .ok_or_else(|| anyhow!("{}: missing values array", context))?;

    if values.is_empty() {
        return Err(anyhow!("{}: values array must not be empty", context));
    }

    values
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::to_string)
                .ok_or_else(|| anyhow!("{}: values must be strings", context))
        })
        .collect()
}

fn resolve_shorthand_attr_path(
    ctx: &ToolCtx,
    file_path: &str,
    action_name: &str,
) -> Result<String> {
    if let Some(attr_path) = ctx.args["attr_path"]
        .as_str()
        .filter(|p| !p.trim().is_empty())
    {
        return Ok(attr_path.to_string());
    }

    let relative_path = normalize_relative_path(Path::new(file_path))?;
    if is_ignored_by_matcher(ctx.gitignore_matcher, &relative_path, false) {
        return Err(anyhow!("Cannot edit gitignored file: {}", file_path));
    }

    let target = resolve_existing_path_in_dir(ctx.repo_root, file_path)?;
    let content = std::fs::read_to_string(&target)
        .with_context(|| format!("Failed to read {}", target.display()))?;

    infer_single_list_attrpath(&content)?.ok_or_else(|| {
        anyhow!(
            "edit_nix_file.{}: missing path. Provide action.{}.path or attr_path when the file has zero or multiple list assignments",
            action_name,
            action_name
        )
    })
}

pub(crate) fn execute(ctx: &ToolCtx) -> Result<ToolResult> {
    let args = ctx.args;
    let path = args["path"]
        .as_str()
        .ok_or_else(|| anyhow!("edit_nix_file: missing path"))?;
    if looks_like_attr_path(path) {
        return Err(explain_attr_path_used_as_file_path(args, path));
    }
    ensure_nixmac_edit_allowed("edit_nix_file", path)?;

    // Expect `action` to be an object like { "add": { "path": "a.b", "values": ["v"] } }.
    // Also keep the legacy add/remove shorthand accepted by existing tool tests.
    let action_val = &args["action"];
    let action = if let Some(shorthand) = action_val.as_str() {
        match shorthand {
            "add" => {
                let attr_path = resolve_shorthand_attr_path(ctx, path, "add")?;
                let values = quote_homebrew_list_values(
                    &attr_path,
                    parse_values(&args["values"], "edit_nix_file.add")?,
                );
                FileEditAction::Add {
                    path: attr_path,
                    values,
                }
            }
            "remove" => {
                let attr_path = resolve_shorthand_attr_path(ctx, path, "remove")?;
                let values = quote_homebrew_list_values(
                    &attr_path,
                    parse_values(&args["values"], "edit_nix_file.remove")?,
                );
                FileEditAction::Remove {
                    path: attr_path,
                    values,
                }
            }
            action => return Err(explain_string_action(args, action)),
        }
    } else {
        if !action_val.is_object() {
            return Err(anyhow!("edit_nix_file: action must be an object"));
        }

        // Require exactly one discriminant to avoid ambiguous ordering (e.g. simultaneous add+remove).
        // TODO: Allow multiple actions per call once ordering semantics are defined.
        let has_add = action_val.get("add").is_some();
        let has_remove = action_val.get("remove").is_some();
        let has_set = action_val.get("set").is_some();
        let has_set_attrs = action_val.get("set_attrs").is_some();

        let present_count =
            (has_add as u8) + (has_remove as u8) + (has_set as u8) + (has_set_attrs as u8);
        if present_count != 1 {
            return Err(anyhow!(
                "edit_nix_file: action must contain exactly one of 'add', 'remove', 'set', or 'set_attrs'"
            ));
        }

        if has_add {
            let add_obj = ensure_action_payload_is_object(action_val, "add")?;
            let attr_path = add_obj["path"]
            .as_str()
            .ok_or_else(|| {
                anyhow!(
                    "edit_nix_file.add: missing action path. Put the list attribute path inside action.add.path, e.g. {{ \"action\": {{ \"add\": {{ \"path\": \"environment.systemPackages\", \"values\": [...] }} }}, \"path\": \"modules/darwin/packages.nix\" }}"
                )
            })?;
            let values = quote_homebrew_list_values(
                attr_path,
                parse_values(&add_obj["values"], "edit_nix_file.add")?,
            );
            FileEditAction::Add {
                path: attr_path.to_string(),
                values,
            }
        } else if action_val.get("remove").is_some() {
            let rem_obj = ensure_action_payload_is_object(action_val, "remove")?;
            let attr_path = rem_obj["path"]
            .as_str()
            .ok_or_else(|| {
                anyhow!(
                    "edit_nix_file.remove: missing action path. Put the list attribute path inside action.remove.path, e.g. {{ \"action\": {{ \"remove\": {{ \"path\": \"environment.systemPackages\", \"values\": [...] }} }}, \"path\": \"modules/darwin/packages.nix\" }}"
                )
            })?;
            let values = quote_homebrew_list_values(
                attr_path,
                parse_values(&rem_obj["values"], "edit_nix_file.remove")?,
            );
            FileEditAction::Remove {
                path: attr_path.to_string(),
                values,
            }
        } else if action_val.get("set").is_some() {
            let set_obj = ensure_action_payload_is_object(action_val, "set")?;
            let attr_path = set_obj["path"]
            .as_str()
            .ok_or_else(|| {
                anyhow!(
                    "edit_nix_file.set: missing action path. Put the scalar option path inside action.set.path, e.g. {{ \"action\": {{ \"set\": {{ \"path\": \"services.tailscale.enable\", \"value\": true }} }}, \"path\": \"modules/darwin/services.nix\" }}"
                )
            })?;
            let value = set_obj
                .get("value")
                .ok_or_else(|| anyhow!("edit_nix_file.set: missing value"))?
                .clone();

            match value {
                serde_json::Value::Bool(_)
                | serde_json::Value::String(_)
                | serde_json::Value::Number(_)
                | serde_json::Value::Null => {}
                _ => {
                    return Err(anyhow!(
                        "edit_nix_file.set: value must be a scalar JSON value"
                    ));
                }
            }

            FileEditAction::Set {
                path: attr_path.to_string(),
                value,
            }
        } else if has_set_attrs {
            let set_attrs_obj = ensure_action_payload_is_object(action_val, "set_attrs")?;
            let attr_path = set_attrs_obj["path"]
            .as_str()
            .ok_or_else(|| {
                anyhow!(
                    "edit_nix_file.set_attrs: missing action path. Put the attrset option path inside action.set_attrs.path, e.g. {{ \"action\": {{ \"set_attrs\": {{ \"path\": \"launchd.user.agents\", \"attrs\": {{...}} }} }}, \"path\": \"modules/darwin/services.nix\" }}"
                )
            })?;
            let attrs_val = set_attrs_obj
                .get("attrs")
                .ok_or_else(|| anyhow!("edit_nix_file.set_attrs: missing attrs"))?;
            let attrs_map = attrs_val
                .as_object()
                .ok_or_else(|| anyhow!("edit_nix_file.set_attrs: attrs must be an object"))?;
            FileEditAction::SetAttrs {
                path: attr_path.to_string(),
                attrs: attrs_map.clone(),
            }
        } else {
            return Err(anyhow!("Unsupported edit_nix_file action object"));
        }
    };

    apply_semantic_edit(
        ctx.repo_root,
        &SemanticFileEdit {
            path: path.to_string(),
            action: action.clone(),
        },
        ctx.gitignore_matcher,
    )?;

    Ok(ToolResult::EditSemantic(SemanticFileEdit {
        path: path.to_string(),
        action,
    }))
}
