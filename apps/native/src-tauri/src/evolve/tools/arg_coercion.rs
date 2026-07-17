//! Repair double-encoded tool-call arguments using the tool's parameter schema.
//!
//! Some models serialize a nested object or array argument into a JSON string
//! (for example `"action": "{\"set\": {...}}"` instead of
//! `"action": {"set": {...}}`), typically when the parameter schema is a union
//! that also admits strings. [`coerce_stringified_args`] walks the arguments
//! alongside the tool's JSON schema and replaces a string value with its parsed
//! JSON form only when the schema rejects that string as-is but accepts the
//! parsed value, so legitimately string-typed arguments (including strings that
//! happen to contain JSON) always pass through untouched.

use serde_json::Value;

use crate::evolve::messages::Tool;

/// Guard against pathological `$ref`/`oneOf` cycles when expanding schema
/// branches. Real tool schemas here are at most a few levels deep.
const MAX_BRANCH_DEPTH: usize = 8;

/// Coerce double-encoded string arguments for `tool_name` back into structured
/// values. Arguments for unknown tools pass through unchanged.
pub(crate) fn coerce_stringified_args(tools: &[Tool], tool_name: &str, mut args: Value) -> Value {
    if let Some(tool) = tools.iter().find(|tool| tool.name == tool_name) {
        coerce_value(&tool.parameters, &tool.parameters, &mut args);
    }
    args
}

fn coerce_value(schema: &Value, root: &Value, value: &mut Value) {
    let Some(schema) = resolve_ref(schema, root) else {
        return;
    };

    match value {
        Value::String(_) => {
            if schema_accepts(schema, root, value) {
                return;
            }
            let Some(text) = value.as_str() else {
                return;
            };
            let Ok(parsed) = serde_json::from_str::<Value>(text.trim()) else {
                return;
            };
            if !parsed.is_string() && schema_accepts(schema, root, &parsed) {
                *value = parsed;
            }
        }
        Value::Object(map) => {
            for branch in schema_branches(schema, root) {
                if let Some(props) = branch.get("properties").and_then(Value::as_object) {
                    for (key, item) in map.iter_mut() {
                        if let Some(prop_schema) = props.get(key) {
                            coerce_value(prop_schema, root, item);
                        }
                    }
                }
                if let Some(additional) = branch.get("additionalProperties") {
                    if additional.is_object() {
                        for item in map.values_mut() {
                            coerce_value(additional, root, item);
                        }
                    }
                }
            }
        }
        Value::Array(items) => {
            for branch in schema_branches(schema, root) {
                if let Some(item_schema) = branch.get("items") {
                    for item in items.iter_mut() {
                        coerce_value(item_schema, root, item);
                    }
                }
            }
        }
        _ => {}
    }
}

/// Resolve a local `$ref` (`#/$defs/...` or `#/definitions/...`) against the
/// root schema; schemas without `$ref` resolve to themselves.
fn resolve_ref<'a>(schema: &'a Value, root: &'a Value) -> Option<&'a Value> {
    let Some(reference) = schema.get("$ref").and_then(Value::as_str) else {
        return Some(schema);
    };
    let path = reference.strip_prefix("#/")?;
    path.split('/')
        .try_fold(root, |node, segment| node.get(segment))
}

/// Flatten a schema and its `oneOf`/`anyOf` alternatives (recursively, with
/// `$ref`s resolved) into the list of branches a value may match.
fn schema_branches<'a>(schema: &'a Value, root: &'a Value) -> Vec<&'a Value> {
    let mut branches = Vec::new();
    collect_branches(schema, root, &mut branches, 0);
    branches
}

fn collect_branches<'a>(
    schema: &'a Value,
    root: &'a Value,
    branches: &mut Vec<&'a Value>,
    depth: usize,
) {
    if depth > MAX_BRANCH_DEPTH {
        return;
    }
    branches.push(schema);
    for key in ["oneOf", "anyOf"] {
        if let Some(list) = schema.get(key).and_then(Value::as_array) {
            for branch in list {
                if let Some(resolved) = resolve_ref(branch, root) {
                    collect_branches(resolved, root, branches, depth + 1);
                }
            }
        }
    }
}

/// Whether any branch of the schema accepts the value, judged by `enum`
/// membership and the `type` keyword only. Branches that merely wrap
/// alternatives (they carry `oneOf`/`anyOf` but no own constraints) never
/// accept directly; a branch with no constraints at all accepts everything.
fn schema_accepts(schema: &Value, root: &Value, value: &Value) -> bool {
    schema_branches(schema, root).iter().any(|branch| {
        if let Some(allowed) = branch.get("enum").and_then(Value::as_array) {
            return allowed.contains(value);
        }
        if let Some(type_spec) = branch.get("type") {
            return type_spec_matches(type_spec, value);
        }
        branch.get("oneOf").is_none() && branch.get("anyOf").is_none()
    })
}

fn type_spec_matches(type_spec: &Value, value: &Value) -> bool {
    match type_spec {
        Value::String(name) => type_name_matches(name, value),
        Value::Array(names) => names
            .iter()
            .filter_map(Value::as_str)
            .any(|name| type_name_matches(name, value)),
        _ => true,
    }
}

fn type_name_matches(name: &str, value: &Value) -> bool {
    match name {
        "string" => value.is_string(),
        "object" => value.is_object(),
        "array" => value.is_array(),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        "number" => value.is_number(),
        "integer" => value.is_i64() || value.is_u64(),
        // Unknown type keyword: stay permissive so we never block a
        // legitimate value on a schema we don't fully understand.
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::{edit_file, edit_nix_file};
    use super::coerce_stringified_args;

    fn tools() -> Vec<crate::evolve::messages::Tool> {
        vec![edit_file::definition(), edit_nix_file::definition()]
    }

    #[test]
    fn coerces_double_encoded_action_into_object() {
        let args = json!({
            "path": "system.nix",
            "action": "{\"set\": {\"path\": \"system.defaults.NSGlobalDomain._HIHideMenuBar\", \"value\": false}}"
        });

        let coerced = coerce_stringified_args(&tools(), "edit_nix_file", args);

        assert_eq!(
            coerced["action"]["set"]["path"],
            "system.defaults.NSGlobalDomain._HIHideMenuBar"
        );
        assert_eq!(coerced["action"]["set"]["value"], json!(false));
    }

    #[test]
    fn keeps_shorthand_action_enum_string() {
        let args = json!({ "path": "packages.nix", "action": "add", "values": ["bat"] });

        let coerced = coerce_stringified_args(&tools(), "edit_nix_file", args);

        assert_eq!(coerced["action"], "add");
    }

    #[test]
    fn keeps_json_looking_content_in_string_typed_properties() {
        let args = json!({
            "path": "config.json",
            "search": "",
            "replace": "{\"set\": {\"key\": \"value\"}}"
        });

        let coerced = coerce_stringified_args(&tools(), "edit_file", args.clone());

        assert_eq!(coerced, args);
    }

    #[test]
    fn keeps_unparseable_action_strings() {
        let args = json!({ "path": "system.nix", "action": "definitely not json" });

        let coerced = coerce_stringified_args(&tools(), "edit_nix_file", args.clone());

        assert_eq!(coerced, args);
    }

    #[test]
    fn coerces_stringified_payload_nested_inside_action_object() {
        let args = json!({
            "path": "system.nix",
            "action": {
                "set": "{\"path\": \"services.tailscale.enable\", \"value\": true}"
            }
        });

        let coerced = coerce_stringified_args(&tools(), "edit_nix_file", args);

        assert_eq!(
            coerced["action"]["set"]["path"],
            "services.tailscale.enable"
        );
        assert_eq!(coerced["action"]["set"]["value"], json!(true));
    }

    #[test]
    fn passes_unknown_tools_through_unchanged() {
        let args = json!({ "anything": "{\"looks\": \"like json\"}" });

        let coerced = coerce_stringified_args(&tools(), "no_such_tool", args.clone());

        assert_eq!(coerced, args);
    }
}
